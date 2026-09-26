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
  MonsterForm,
  MonsterMultiattack,
  MonsterMultiattackBranch,
  MonsterMultiattackEntry,
  MonsterMultiattackGate,
  MonsterRecharge,
  MonsterSave,
  MonsterTrait,
} from '@ie/srd';
import type { StatedLegendaryAction } from './character.js';
// The two readers of the branch shape, from the subpath that is schemas and no
// data: a value imported from the barrel loads the whole parsed SRD into every
// process that imports the engine, which `srd-barrel.test.ts` is the guard for.
import {
  CREATURE_SIZES,
  DECLARED_DAMAGE_TYPE,
  entriesOfBranch,
  gateOfBranch,
} from '@ie/srd/schemas';
import { STATED_BONUS_ACTION_LEDGER } from './combat.js';
import { saveModifier, skillModifier } from './character.js';
import type { GameState } from './state.js';
import type { ShapeShiftRow } from './progression.js';
import { isCreatureType } from './spell-definitions.js';
import type { HazardName } from './hazards.js';
import type { TurnAnchor, TurnMoment } from './time.js';
import type { HitRiderAnchor, StandingEffect, StandingRequirement } from './standing.js';
import type { RollFamily } from './roll-modifiers.js';
import type { DamageDefenses } from './attack.js';
import type {
  CharacterSheet,
  OtherSpeeds,
  StatedAction,
  StatedAttack,
  StatedBonusAction,
  StatedTrait,
  StatedValues,
} from './character.js';
import { vitals, type Vitals } from './vitals.js';
import { declaredCasting, type GrantedSpell, type SpellcastingState } from './spellcasting.js';
import type { CastingTime } from './spells.js';
import type { PoolDeclaration } from './resources.js';
import type { ReactionFeature } from './reactions.js';
import type { D20TestKind } from './checks.js';

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
  /** "Lawful Evil" — what the block prints beside the type; SRD Heart Sight reads it. */
  readonly alignment: string;
  readonly size: CreatureSize;
  readonly speed: Monster['speed'];
  /** The stat block's Initiative modifier, for rolling or for a passive score. */
  readonly initiativeModifier: number;
  readonly cr: number;
  readonly xp: number;
  /**
   * What the block's Spellcasting line declares, or null where it prints none.
   *
   * **Beside the sheet rather than on it**, because that is where the engine
   * already keeps it: a creature's spellcasting is `CreatureState`, written by
   * `character-created` for a character and by `spellcasting-declared` for
   * everything else. A stat block is the second kind, so the adapter's job is
   * to hand `addCreature` the value the declaration carries.
   */
  readonly spellcasting: SpellcastingState | null;
  /**
   * The pools the block's per-day uses come out of, in key order.
   *
   * Declared rather than derived, because a pool is: SRD writes "2/Day" and
   * `PoolDeclaration` is what the engine has for a count somebody has to state
   * the size of. The tag is `dawn` — the clock the block's other per-day lines
   * are already on, which `declareDawn` empties and no rest touches.
   *
   * **`spellPools` until a second kind of use needed one.** The Spellcasting
   * line's per-day castings were the first and are still most of them; a
   * printed Reaction's "(2/Day)" is the other, and it is a pool for the reason
   * `printedLinePoolKey` gives. One list rather than two, because what they
   * have in common is the whole of what `addCreature` does with them.
   *
   * Empty for a block that rations nothing, which has nothing to run out of.
   */
  readonly pools: readonly PoolDeclaration[];
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
            // And the forms the **heading** names, carried the same way and
            // for the same reason: "Bite (Wolf or Hybrid Form Only)" is a
            // gate on the swing, and a gate dropped here is a werewolf biting
            // in a shape the book gave it no teeth in.
            ...(line.onlyInForms === undefined ? {} : { onlyInForms: [...line.onlyInForms] }),
          },
        ],
  );
}

/** The trait shapes the parser read, in printed order. */
const printedTraits = (monster: Monster): readonly MonsterTrait[] =>
  monster.traits.flatMap((line) => (line.trait === undefined ? [] : [line.trait]));

/**
 * The trait lines that force a save, in printed order.
 *
 * A Magmin's Death Burst, a Ghast's Stench. The heading and the sentence come
 * with the save for the reason every carried line's do: the engine hands the
 * words back at the moment of use, and a hand-over with no sentence in it is a
 * creature doing something nobody can act on.
 */
const printedTraitSaves = (monster: Monster): readonly StatedTrait[] =>
  monster.traits.flatMap((line) =>
    line.save === undefined ? [] : [{ name: line.name, text: line.text, save: line.save }],
  );

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
 * The source a printed line's clauses are hung on: the creature and the
 * heading.
 *
 * **Here rather than beside the executor that writes it**, and the import
 * direction is what decides it: `fold/turns.ts` has to read the same string
 * when it asks whether a creature already holds a day's grace from an aura,
 * and a fold module reaching into `commands/` would be a cycle through
 * `events.ts`. It is a fact about a stat block's line, which is this module's
 * vocabulary, and it names nothing — the heading comes out of the block.
 */
export const printedLineSource = (who: CharacterId, line: string): string =>
  `printed:${who}:${line}`;

/**
 * The mark a wound's own arrangements are filed under, beneath the line's
 * source.
 *
 * SRD Bearded Devil's Infernal Glaive: "The target receives an infernal
 * wound." Its own key beneath the line's, like the `…:speed` a printed Speed
 * cut uses, because one line may hang more than one thing under a span and a
 * shared key would be one deadline for two sentences.
 *
 * **And it is recognisable**, which no other sub-key needs to be: the book
 * gates the wound on the target not already having one — "doesn't already have
 * an infernal wound" — and *any* wound counts, not merely this devil's. So the
 * question is asked of the suffix rather than of a source anybody has to know
 * in advance. Here rather than beside the executor for {@link
 * printedLineSource}'s reason exactly: two readers, one of them a fold.
 */
const WOUND_MARK = ':wound';

/** The source a printed wound's payout and deadline are filed under. */
export const woundSource = (lineSource: string): string => `${lineSource}${WOUND_MARK}`;

/** Whether a source is a wound's — see {@link woundSource}. */
export const isWoundSource = (source: string): boolean => source.endsWith(WOUND_MARK);

/**
 * Whether one printed line is **still holding something** on a creature.
 *
 * SRD Gold Dragon Wyrmling's Weakening Breath: "each creature that isn't
 * currently affected by this breath". A fact the engine holds rather than a
 * question for the table, because everything a line hangs is filed under its
 * own source: a condition's instance carries it, and every grant the line hung
 * under a span or a repeat save has a `grants` timer over it whose source is
 * the line's own or a key beneath it (`…:lasting`, `…:speed`). So the question
 * is answered off the two records the fold already keeps, and opens no family
 * list of its own — the grants are found through the timer that will end
 * them, which is the one thing every lasting grant of a line has.
 *
 * A line whose only effect was damage, a push or a death holds nothing
 * afterwards and reads as not affecting anybody, which is the book's reading:
 * a creature the breath merely hurt may be breathed on again.
 */
export function affectedByPrintedLine(
  state: GameState,
  who: CharacterId,
  lineSource: string,
): boolean {
  const creature = state.creatures[who];
  if (creature === undefined) return false;
  const ofTheLine = (source: string): boolean =>
    source === lineSource || source.startsWith(`${lineSource}:`);
  if (creature.conditions.instances.some((instance) => ofTheLine(instance.source))) return true;
  return Object.values(state.timers).some(
    (timer) =>
      timer.target.kind === 'grants' && timer.target.on === who && ofTheLine(timer.target.source),
  );
}

/** One printed line that forces a save, under the heading the block prints. */
export interface PrintedSaveLine {
  readonly line: string;
  readonly save: MonsterSave;
}

/**
 * Every line on this sheet whose save a **moment** forces, in printed order.
 *
 * The raisers' whole view of a stat block: a death asks for the `dies` ones
 * and a turn beginning asks for the `starts-turn-within` ones, and neither
 * knows what a Death Burst or a Stench is. Three shelves are searched because
 * a heading says what a line *costs* and a triggered line costs nothing — the
 * SRD prints all ten under Traits, and a homebrew block that printed one
 * elsewhere would be saying the same thing.
 *
 * Empty for every character and for every block with no such line, which is
 * the overwhelming majority — and the walk is over three short arrays that are
 * usually absent, which is what makes it cheap enough for the fold to ask of
 * every creature at every boundary.
 */
export function triggeredSavesOf(sheet: CharacterSheet): readonly PrintedSaveLine[] {
  const stated = sheet.stated;
  if (stated === undefined) return [];
  const lines: PrintedSaveLine[] = [];
  for (const line of [
    ...(stated.traitSaves ?? []),
    ...(stated.unreadActions ?? []),
    ...(stated.bonusActions ?? []),
  ]) {
    if (line.save?.trigger !== undefined) lines.push({ line: line.name, save: line.save });
  }
  return lines;
}

/**
 * The save one named printed line forces, off whichever shelf it was pinned
 * to.
 *
 * What a raised debt reads back: a {@link PendingSave} carries the creature and
 * the heading, and the numbers stay where they were pinned — the rule
 * `conditionEndedBy` follows about a repeat save, which is that a debt says
 * what is *owed* and the thing it is about holds the answer. Copying the whole
 * record onto the debt would be a second copy of the block, free to disagree
 * with the sheet a reload restores.
 *
 * Case-insensitive on the heading, like every other lookup here.
 */
export function printedSaveOf(sheet: CharacterSheet, name: string): MonsterSave | null {
  const wanted = name.trim().toLowerCase();
  const stated = sheet.stated;
  if (stated === undefined) return null;
  for (const line of [
    ...(stated.traitSaves ?? []),
    ...(stated.unreadActions ?? []),
    ...(stated.bonusActions ?? []),
  ]) {
    if (line.name.toLowerCase() === wanted && line.save !== undefined) return line.save;
  }
  return null;
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
  // And a legendary line, whose recharge is the sentence's own rather than a
  // heading's — SRD Unicorn's Shimmering Shield.
  const legendary = sheet.stated?.legendaryActions?.find((one) => one.name.toLowerCase() === wanted);
  if (legendary !== undefined) return legendary.recharge ?? null;
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
    : recharge.kind === 'turn'
      ? 'the start of its next turn brings it back'
      : 'finishing a Short or Long Rest brings it back';

/**
 * The pool a block's legendary action uses come out of.
 *
 * SRD *Monsters*: "Legendary Action Uses: 3 … regains all expended uses at the
 * start of each of its turns." One key for every legendary block, because a
 * creature holds one such pool: the block prints one number, and
 * `settleStartOfTurnLegendary` refills it whole at the holder's own turn.
 */
export const LEGENDARY_POOL = 'legendary-actions';

/**
 * The key a legendary use is written down against in the holder's own turn
 * ledger, so the moment it was spent at is consumed.
 *
 * SRD *Monsters*: "Only one of these actions can be taken at a time and only
 * after another creature's turn ends." A use is spent at a boundary the holder
 * does not own, so the holder's budget is the record that outlives it — every
 * combatant holds one from the fight's start — and `feature-used` keyed here
 * against `turnsTaken` says "this boundary has had its one", which the next
 * boundary's count makes false again.
 */
export const LEGENDARY_MOMENT = 'legendary-action';

/** One legendary line by its heading, off the sheet the block was pinned to. */
export function legendaryLineOf(sheet: CharacterSheet, name: string): StatedLegendaryAction | null {
  const wanted = name.trim().toLowerCase();
  return sheet.stated?.legendaryActions?.find((line) => line.name.toLowerCase() === wanted) ?? null;
}

/**
 * The legendary actions the block prints that the parser read, compiled for
 * `takeLegendaryAction`.
 *
 * **The recharge is set here and not read off a heading**, because the book
 * prints it in the sentence: SRD Unicorn's Shimmering Shield ends "The
 * unicorn can't take this action again until the start of its next turn", and
 * the parser reads that as `oncePerRound`. The economy the line is spent from
 * is the block's pool, declared beside it in `adaptMonster`.
 */
function printedLegendaryActions(monster: Monster): readonly StatedLegendaryAction[] {
  return monster.legendaryActions.flatMap((line) =>
    line.legendary === undefined
      ? []
      : [
          {
            name: line.name,
            text: line.text,
            legendary: line.legendary,
            ...(line.legendary.kind === 'shield' && line.legendary.oncePerRound === true
              ? { recharge: { kind: 'turn' as const } }
              : {}),
          },
        ],
  );
}

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
 * The name SRD Undead Fortitude's save and its floor are recorded under.
 *
 * A constant rather than a string at each site, so the roll a player reads and
 * the `damage-taken.floor` a replay reads cannot come to disagree — and
 * exported so that a test can ask for the rule by the same name the log gives
 * it. It is the *rule's* name and not a catalogue id: nothing looks a creature
 * up by it, and the sweep is about ids.
 */
export const UNDEAD_FORTITUDE = 'Undead Fortitude';

/**
 * SRD Undead Fortitude's saving throw, or null where the sentence does not
 * fire.
 *
 * > "If damage reduces the zombie to 0 Hit Points, it makes a Constitution
 * > saving throw (DC 5 plus the damage taken) unless the damage is Radiant or
 * > from a Critical Hit."
 *
 * Four clauses and every one of them is asked here: the block prints the
 * sentence, the blow takes the creature to 0, the damage is not from a
 * Critical Hit, and none of it is Radiant.
 *
 * **A sheet fact rather than a standing effect**, and the reason is the
 * vocabulary rather than convenience: `hit-point-floor` is an *unconditional*
 * floor with a use to spend, and this is a conditional floor with no use and a
 * die in front of it. Expressing it as a grant would be a new `FeatureGrant`
 * kind — a decision about what content may say, which this is not the place to
 * take. The trait is parsed onto `CharacterSheet.stated.traits` already, and
 * `hasPrintedTrait` is how every other printed sentence is asked for.
 *
 * **The types are the ones the blow actually carried.** `undefined` is a
 * caller that never had any — a DM's improvised amount, which has no type for
 * a defence to meet either — and the save is raised, because the engine cannot
 * see a Radiant it was never told about and refusing the save on that ground
 * would be inventing the exception rather than applying it. What it cannot
 * check, it hands over; see `resolveDamage`.
 */
export function undeadFortitudeSave(
  sheet: CharacterSheet,
  outcome: { readonly droppedToZero: boolean },
  amount: number,
  blow: { readonly critical?: boolean; readonly types?: readonly string[] },
): { readonly dc: number; readonly feature: string } | null {
  if (!hasPrintedTrait(sheet, 'undead-fortitude')) return null;
  if (!outcome.droppedToZero) return null;
  if (blow.critical === true) return null;
  if ((blow.types ?? []).some((type) => type.toLowerCase() === 'radiant')) return null;
  return { dc: 5 + amount, feature: UNDEAD_FORTITUDE };
}

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
 * SRD Running Leap: the distance a block's own running jump covers, or null.
 *
 * "With a 10-foot running start, the lion can Long Jump up to 25 feet."
 * {@link printedLeap}'s opposite number and read separately for that reason:
 * SRD Standing Leap *removes* the running start and replaces both distances,
 * while this one keeps the running start and states one distance the jump may
 * reach.
 *
 * **A second bound rather than a replacement**, which is what "can Long Jump
 * up to 25 feet" says: a creature whose Strength already carried it further
 * does not get a shorter jump for having the trait. `checkJump` takes the
 * longer of the two, exactly as it does with a jump a spell bought.
 *
 * The running start is carried rather than assumed, because the number is the
 * line's: every SRD block prints ten, and a homebrew line may print any.
 */
export const printedRunningLeap = (
  sheet: CharacterSheet,
): { readonly runningStartFeet: number; readonly longJumpFeet: number } | null => {
  for (const trait of sheet.stated?.traits ?? []) {
    if (trait.kind === 'long-jump-with-a-running-start') {
      return { runningStartFeet: trait.runningStartFeet, longJumpFeet: trait.longJumpFeet };
    }
  }
  return null;
};

/**
 * SRD Lightning Absorption: the type a block turns into Hit Points, or null.
 *
 * "Whenever the golem is subjected to Lightning damage, it regains a number of
 * Hit Points equal to the Lightning damage dealt."
 *
 * **"Subjected to" and not "takes", and the difference is the whole trait.**
 * Both blocks that print this are immune to the type they absorb, so an amount
 * read after Immunity is always nought and the sentence would be dead text.
 * The amount is therefore what was rolled at the creature before its own
 * defences, which is the ruling this repository records here and applies in
 * `dealSpellDamage`.
 */
export const printedAbsorption = (sheet: CharacterSheet): string | null => {
  for (const trait of sheet.stated?.traits ?? []) {
    if (trait.kind === 'absorbs-a-damage-type') return trait.damageType;
  }
  return null;
};

/**
 * SRD Aversion to Fire: the type that costs a block its rolls, and which.
 *
 * "If the golem takes Fire damage, it has Disadvantage on attack rolls and
 * ability checks until the end of its next turn."
 *
 * **"Takes", which is the other word and the other reading**: the penalty
 * follows damage the creature actually lost Hit Points to, so a defence that
 * turned the whole blow aside turns the clause aside with it.
 * {@link printedAbsorption} is the same trigger read the other way, and the
 * book's own two verbs are what tell them apart.
 */
export const printedTypeAversion = (
  sheet: CharacterSheet,
): { readonly damageType: string; readonly rolls: readonly RollFamily[] } | null => {
  for (const trait of sheet.stated?.traits ?? []) {
    if (trait.kind === 'penalised-after-taking-a-damage-type') {
      return { damageType: trait.damageType, rolls: trait.rolls.map((roll) => SUNLIT_ROLL[roll]) };
    }
  }
  return null;
};

/**
 * SRD Freeze: the Speed a damage type costs a block, and which type.
 *
 * "If the elemental takes Cold damage, its Speed decreases by 20 feet until
 * the end of its next turn." {@link printedTypeAversion}'s sibling — the same
 * trigger and the same span with a Speed on the end of it — so "takes" is read
 * the same way: the cut follows damage that landed.
 */
export const printedTypeSlow = (
  sheet: CharacterSheet,
): { readonly damageType: string; readonly feet: number } | null => {
  for (const trait of sheet.stated?.traits ?? []) {
    if (trait.kind === 'speed-cut-after-taking-a-damage-type') {
      return { damageType: trait.damageType, feet: trait.feet };
    }
  }
  return null;
};

/** One printed sentence that hurts somebody when a turn begins or ends. */
export interface PrintedBoundaryDamage {
  readonly moment: TurnMoment;
  readonly dice: string;
  readonly damageType: string;
  /**
   * Who it catches: a radius round the holder, or whoever the hold reaches.
   *
   * Two shapes rather than an optional radius, because they are two questions
   * and the boundary asks a different thing of each — `distanceBetween` for
   * the first and `grapplesOn` for the second.
   */
  readonly catches:
    | { readonly kind: 'emanation'; readonly feet: number; readonly chosen: boolean }
    | { readonly kind: 'held' };
  /** SRD Fire Aura's "unless the azer has the Incapacitated condition". */
  readonly unlessIncapacitated: boolean;
}

/**
 * SRD Fire Aura and SRD Barbed Hide: what a block's own turn boundary owes.
 *
 * Both sentences are the same moment — "at the end of each of the azer's
 * turns", "at the start of each of its turns" — and differ in whom they catch,
 * so they are one reader over two shapes rather than two readers that would
 * have to agree about the moment.
 *
 * **In printed order, and all of them**, because a block may print two: the
 * list is what the boundary walks, and returning the first would be a rule
 * silently dropped by a stat block that happened to print a second.
 */
export const printedBoundaryDamage = (
  sheet: CharacterSheet,
): readonly PrintedBoundaryDamage[] => {
  const found: PrintedBoundaryDamage[] = [];
  for (const trait of sheet.stated?.traits ?? []) {
    if (trait.kind === 'damages-creatures-in-an-emanation') {
      found.push({
        moment: trait.moment === 'start' ? 'start-of-turn' : 'end-of-turn',
        dice: trait.dice,
        damageType: trait.damageType,
        catches: { kind: 'emanation', feet: trait.feet, chosen: trait.chosen },
        unlessIncapacitated: trait.unlessIncapacitated,
      });
    }
    if (trait.kind === 'damages-creatures-it-is-holding') {
      found.push({
        moment: trait.moment === 'start' ? 'start-of-turn' : 'end-of-turn',
        dice: trait.dice,
        damageType: trait.damageType,
        catches: { kind: 'held' },
        unlessIncapacitated: false,
      });
    }
  }
  return found;
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

/**
 * A sheet with one **form's** printed Speeds on it, or the block's own back.
 *
 * {@link withPrintedSpeeds}'s sibling, here for the same reason and differing
 * in the one way that matters: it **replaces** rather than joins. SRD Imp's
 * rat is "Speed 20 ft." and nothing else, so a join with the imp's own Fly 40
 * would have given the rat wings the book did not print — where a spell's
 * Speeds are written *over* a block that keeps whatever the spell is silent
 * about.
 *
 * A form that prints no Speeds leaves the sheet exactly as it was handed in,
 * which is what returning to a true form means: the caller hands in the sheet
 * the creature had before it took any form.
 */
export function withFormSpeeds(sheet: CharacterSheet, form: MonsterForm): CharacterSheet {
  const printed = form.speed;
  if (printed === null) return sheet;
  const some = (feet: number | null): number | undefined =>
    feet === null || feet <= 0 ? undefined : feet;
  const modes: OtherSpeeds = {
    ...(some(printed.burrow) === undefined ? {} : { burrow: printed.burrow as number }),
    ...(some(printed.climb) === undefined ? {} : { climb: printed.climb as number }),
    ...(some(printed.fly) === undefined ? {} : { fly: printed.fly as number }),
    ...(some(printed.swim) === undefined ? {} : { swim: printed.swim as number }),
  };
  // The block's other Speeds are **dropped** rather than merged, which is the
  // whole difference from `withPrintedSpeeds`: a rat that kept the imp's Fly
  // Speed would be a creature the book did not print.
  const rest: Record<string, unknown> = { ...sheet };
  delete rest['speeds'];
  return {
    ...(rest as Omit<CharacterSheet, 'speeds'>),
    baseSpeed: printed.walk,
    ...(Object.keys(modes).length === 0 ? {} : { speeds: modes }),
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
 * SRD Magic Resistance, onto the sheet as the standing effect it is.
 *
 * "The devil has Advantage on saving throws against spells and other magical
 * effects." One mode, one family, one narrowing — `againstMagic`, the axis
 * `RollSelector` gained for this sentence, because a save selected by its
 * ability alone would have given a devil Advantage on every save it ever made,
 * a Grapple's escape included.
 *
 * `printedSunlight`'s shape with the gate on the *roll* rather than on the
 * holder: nothing about the devil has to be true for this to apply, and
 * everything about the save does.
 */
function printedMagicResistance(
  line: MonsterLine,
  key: string,
): readonly StandingEffect[] {
  if (line.trait?.kind !== 'magic-resistance') return [];
  return [
    {
      feature: key,
      // The block's own heading, so a roll reports the rule the book printed.
      name: line.name,
      reach: { kind: 'self' },
      grant: {
        kind: 'roll-mode',
        modifier: {
          mode: 'advantage',
          selector: { roll: 'saving-throw', relation: 'roller', againstMagic: true },
        },
      },
    },
  ];
}

/**
 * SRD Aura of Authority, onto the sheet as the aura it is.
 *
 * "While in a 10-foot Emanation originating from the hobgoblin, the hobgoblin
 * and its allies have Advantage on attack rolls and saving throws, provided
 * the hobgoblin doesn't have the Incapacitated condition."
 *
 * **SRD Aura of Protection's shape with a roll mode inside it**, and nothing
 * here is new: `reach: { kind: 'aura', feet }` has meant "the holder and the
 * allies within" since the Paladin's aura landed, `standingFor` walks it for
 * every grant kind rather than for the one it was built for, and
 * `not-incapacitated` is the sentence's last clause word for word. So a
 * printed aura is the same three fields a class feature fills in.
 *
 * **One effect per roll the sentence names**, for `printedSunlight`'s reason:
 * a `roll-mode` grant carries one selector and the line names a list.
 *
 * Read from **Traits**, which is where the book prints it — though nothing
 * here depends on that, because {@link printedStanding} dispatches on the
 * shape the parser read and a heading says what a line costs.
 */
function printedAllyAura(
  line: MonsterLine,
  key: string,
): readonly StandingEffect[] {
  if (line.trait?.kind !== 'allies-in-emanation-have-advantage') return [];
  const feet = line.trait.feet;
  return line.trait.rolls.map(
    (roll): StandingEffect => ({
      feature: key,
      // The block's own heading, so a roll reports the rule the book printed.
      name: line.name,
      reach: { kind: 'aura', feet },
      grant: {
        kind: 'roll-mode',
        modifier: {
          mode: 'advantage',
          selector: { roll: SUNLIT_ROLL[roll], relation: 'roller' },
        },
      },
      requires: [{ kind: 'not-incapacitated' }],
    }),
  );
}

/**
 * SRD Blood Frenzy, onto the sheet as the roll mode it is.
 *
 * "The sahuagin has Advantage on attack rolls against any creature that
 * doesn't have all its Hit Points."
 *
 * `printedBloodiedAdvantage`'s mirror image across the blow: that sentence
 * reads the holder's own Hit Points and this one reads the Hit Points of
 * whoever is being swung at, which is a narrowing on the *roll* rather than a
 * requirement on the holder — so it sits on the selector beside
 * `againstMagic`, and `not-incapacitated` and its siblings have nothing to say
 * about it.
 */
function printedFrenzy(
  line: MonsterLine,
  key: string,
): readonly StandingEffect[] {
  if (line.trait?.kind !== 'advantage-against-a-wounded-target') return [];
  return [
    {
      feature: key,
      name: line.name,
      reach: { kind: 'self' },
      grant: {
        kind: 'roll-mode',
        modifier: {
          mode: 'advantage',
          selector: { roll: 'attack', relation: 'roller', targetMissingHitPoints: true },
        },
      },
    },
  ];
}

/**
 * SRD Blurred Form, onto the sheet as the standing effect it is.
 *
 * "Attack rolls against the mephit are made with Disadvantage unless the
 * mephit has the Incapacitated condition."
 *
 * `printedSunlight`'s shape from the other end of the blow: the first printed
 * trait whose mode sits on the rolls made **against** its holder, which is
 * what `relation: 'against-holder'` has meant since Dodge and Blur. The gate
 * is on the holder and is the sentence's last clause word for word.
 */
function printedBlur(line: MonsterLine, key: string): readonly StandingEffect[] {
  if (line.trait?.kind !== 'disadvantage-on-attacks-against-it') return [];
  return [
    {
      feature: key,
      name: line.name,
      reach: { kind: 'self' },
      grant: {
        kind: 'roll-mode',
        modifier: {
          mode: 'disadvantage',
          selector: { roll: 'attack', relation: 'against-holder' },
        },
      },
      requires: [{ kind: 'not-incapacitated' }],
    },
  ];
}

/**
 * SRD Beast of Burden, onto the sheet as the grant SRD Powerful Build already
 * is.
 *
 * "The mule counts as one size larger for the purpose of determining its
 * carrying capacity." One sentence, one grant, and `capacitySizeOf` has read
 * that grant since the Goliath's own line landed — so this is the stat block
 * saying the same thing and nothing else changes.
 */
function printedCarryingCapacity(
  line: MonsterLine,
  key: string,
): readonly StandingEffect[] {
  if (line.trait?.kind !== 'carries-as-a-larger-creature') return [];
  return [
    {
      feature: key,
      name: line.name,
      reach: { kind: 'self' },
      grant: { kind: 'carrying-capacity', sizesLarger: line.trait.sizesLarger },
    },
  ];
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
        ...printedMagicResistance(line, key),
        ...printedAllyAura(line, key),
        ...printedFrenzy(line, key),
        ...printedBlur(line, key),
        ...printedCarryingCapacity(line, key),
        ...printedBonusActionAllowance(line, key, costsABonusAction),
      ];
    }),
  );

  return standing.length === 0 ? {} : { standing };
}

/**
 * The prefix one printed spell's per-day castings are pooled under.
 *
 * `PER_DAY_TALLY`'s sibling and deliberately a **pool** rather than a tally: a
 * printed line's per-day limit is a count whoever spends the line reads, and
 * this is a count the casting pipeline spends *itself* — `choosePayment`
 * returns a pool key and `resolveSpell` refuses when it is empty, which is the
 * refusal a pool exists for and a tally cannot make.
 *
 * The prefix is a constant and the id in the key is the block's own, so
 * nothing here names a spell. It is spelled to make a collision with a class
 * feature's key something somebody would have to go looking for.
 */
const PRINTED_SPELL_PER_DAY = 'printed-spell-per-day:';

/** The pool one printed spell's per-day castings come out of. */
export const printedSpellPoolKey = (spellId: string): string =>
  `${PRINTED_SPELL_PER_DAY}${spellId}`;

/**
 * The prefix one printed **line**'s per-day uses are pooled under.
 *
 * `PRINTED_SPELL_PER_DAY`'s sibling one level up: that one is per spell,
 * because the Spellcasting line prices each entry; this one is per heading,
 * because a heading's single use buys whatever the heading does.
 *
 * **A pool rather than the `dawn` tally every other per-day line uses**, and
 * the reason is what spends it. `takeStatedAction` reads a count and compares
 * it against the ceiling on the sheet itself, which a tally is exactly right
 * for; a Reaction is offered or withheld by `canAfford`, which asks a **pool**
 * whether a use is left — and a window that opened on a Reaction with nothing
 * behind it would be an offer the command layer then had to refuse. The two
 * keys cannot collide and the two doors never meet: a Reaction is not printed
 * under Actions or Bonus Actions, so nothing spends one line both ways.
 */
const PRINTED_LINE_PER_DAY = 'printed-line-per-day:';

/** The pool one printed line's per-day uses come out of. */
export const printedLinePoolKey = (line: string): string => `${PRINTED_LINE_PER_DAY}${line}`;

/**
 * The D20 Tests a printed trigger names, where the engine holds a window for
 * every one of them.
 *
 * `D20TestKind` is two members and the parser reads three rolls, because the
 * glossary lists three: the `test-rolled` window is the instant a check or a
 * save has landed, and an attack roll is not one of them — it has its own two
 * windows and its own answers. So a line whose trigger names an attack roll is
 * refused **whole** rather than read down to the part that fits, which is the
 * discipline every reader in this adapter keeps.
 */
function triggeringTests(
  rolls: readonly ('ability-check' | 'attack-roll' | 'saving-throw')[],
): readonly D20TestKind[] | null {
  const tests: D20TestKind[] = [];
  for (const roll of rolls) {
    if (roll === 'attack-roll') return null;
    tests.push(roll);
  }
  return tests.length === 0 ? null : tests;
}

/**
 * SRD Sphinx of Wonder's Burst of Ingenuity, onto the sheet as the Reaction it
 * is.
 *
 * "_Trigger:_ The sphinx or another creature within 30 feet makes an ability
 * check or a saving throw. _Response:_ The sphinx adds 2 to the roll." Every
 * part of that is a rule the engine already had: `test-rolled` is the window
 * Dark One's Own Luck answers, `intervene` is the push with a sign,
 * `self-or-within` is the reach, and the flat addend is the one thing a stat
 * block writes that no class table could.
 *
 * **The heading is load-bearing here, as it is for `printedBonusActionAllowance`
 * and for nothing else.** What the sentence does not say is what it *costs*: a
 * line answering a trigger costs a Reaction because it is printed under
 * **Reactions**, and the same sentence printed elsewhere would be a Reaction
 * nobody paid for. So this compiles from that section alone.
 *
 * **A per-day heading declares the pool its uses come out of** — see
 * {@link printedLinePoolKey}. A line with no limit has none, which is what a
 * `null` pool has always meant.
 */
function printedRollAddendReaction(
  monster: Monster,
  line: MonsterLine,
): ReactionFeature | null {
  const addend = line.addsToRoll;
  if (addend === undefined) return null;

  const tests = triggeringTests(addend.tests);
  if (tests === null) return null;

  return {
    feature: printedTraitKey(monster.id, line.name),
    // The block's own heading, so a log names the rule the book printed.
    name: line.name,
    window: 'test-rolled',
    // SRD *Monsters*: a line under this heading costs the creature's Reaction.
    costsReaction: true,
    pool: line.perDay === undefined ? null : printedLinePoolKey(line.name),
    reach: addend.includesSelf
      ? { kind: 'self-or-within', feet: addend.withinFeet }
      : { kind: 'within', feet: addend.withinFeet },
    does: {
      kind: 'intervene',
      amount: { plus: [{ kind: 'flat', amount: addend.addend, label: line.name }] },
      // "adds 2 to the roll" — the sign the sentence prints.
      direction: 'bonus',
      tests,
      // The trigger says when the Reaction may be taken and says nothing about
      // whether the roll beat its DC, so it answers either. A narrowing the
      // sentence does not print is a rule nobody wrote.
      outcome: 'either',
    },
  };
}

/**
 * SRD Parry, onto the sheet as the Reaction it is.
 *
 * "_Trigger:_ The knight is hit by a melee attack roll while holding a weapon.
 * _Response:_ The knight adds 2 to its AC against that attack, possibly
 * causing it to miss."
 *
 * The same argument {@link printedRollAddendReaction} makes one function up,
 * about a different window: `hit-by-attack` is the instant SRD *Shield*
 * answers, `raise-ac` is the rise that belongs to one attack, and the reach is
 * `self` because every clause of the sentence is about the creature that was
 * hit. The heading is what says a Reaction is spent on it.
 */
function printedAcAddendReaction(monster: Monster, line: MonsterLine): ReactionFeature | null {
  const addend = line.addsToAc;
  if (addend === undefined) return null;

  return {
    feature: printedTraitKey(monster.id, line.name),
    name: line.name,
    window: 'hit-by-attack',
    costsReaction: true,
    pool: line.perDay === undefined ? null : printedLinePoolKey(line.name),
    reach: { kind: 'self' },
    does: {
      kind: 'raise-ac',
      amount: addend.addend,
      // Both clauses the trigger prints, carried rather than assumed: the
      // parser reads them as literals for the reason a homebrew line that
      // omitted one must not be read as though it had said it.
      ...(addend.meleeOnly ? { meleeOnly: true as const } : {}),
      ...(addend.requiresWeapon ? { requiresWeapon: true as const } : {}),
    },
  };
}

/**
 * SRD Reflexive Antennae, onto the sheet as the Reaction it is.
 *
 * "_Trigger:_ An attack roll hits the rust monster. _Response:_ The rust
 * monster uses Antennae." The trigger is the window above and the response is
 * the **name** of another line of this same block — carried as a name for
 * `AttackCommand.action`'s reason, so what the response is stays that line's
 * business and a line nothing reads is handed to the table rather than half
 * performed.
 */
function printedLineUseReaction(monster: Monster, line: MonsterLine): ReactionFeature | null {
  if (line.usesLine === undefined) return null;

  return {
    feature: printedTraitKey(monster.id, line.name),
    name: line.name,
    window: 'hit-by-attack',
    costsReaction: true,
    pool: line.perDay === undefined ? null : printedLinePoolKey(line.name),
    reach: { kind: 'self' },
    does: { kind: 'use-printed-line', line: line.usesLine },
  };
}

/**
 * Every Reaction the block prints that this adapter can compile, and the pools
 * they come out of.
 *
 * **Three shapes of the Reactions section reach the sheet.** The SRD writes
 * twenty-four lines under that heading: one adds to a D20 Test (the Sphinx of
 * Wonder), seven add to an **Armour Class** against the attack that triggered
 * them (Parry), and one answers a hit by using another line of its own block
 * (Reflexive Antennae). Of the rest, three are sentences the parser reads as
 * *kinds* and nothing spends — the two Splits and the Goblin Boss's Redirect
 * Attack — and the others are each a different sentence, from an octopus's ink
 * to the Stone Giant's deflection. Those stay prose and stay on the ledger,
 * named there rather than argued about here.
 */
function printedReactions(monster: Monster): {
  readonly reactions: readonly ReactionFeature[];
  readonly pools: readonly PoolDeclaration[];
} {
  const reactions: ReactionFeature[] = [];
  const pools: PoolDeclaration[] = [];

  for (const line of monster.reactions) {
    const reaction =
      printedRollAddendReaction(monster, line) ??
      printedAcAddendReaction(monster, line) ??
      printedLineUseReaction(monster, line);
    if (reaction === null) continue;
    reactions.push(reaction);
    if (reaction.pool !== null) {
      pools.push({
        key: reaction.pool,
        // The block's own words, so a report names the rule the book printed.
        label: line.name,
        max: line.perDay!,
        // The clock every printed per-day limit is on, and the one a rest
        // deliberately does not touch.
        recovers: 'dawn',
      });
    }
  }

  return { reactions, pools };
}

/**
 * SRD's Spellcasting line, onto the creature as the declaration it is.
 *
 * "The cultist casts one of the following spells, using Wisdom as the
 * spellcasting ability (spell save DC 12, +4 to hit with spell attacks): **At
 * Will:** _Light_, _Thaumaturgy_ **2/Day:** _Command_ **1/Day:** _Hold
 * Person_" — an ability, two numbers, and a list with a price against each
 * entry. `declaredCasting` was written for exactly this creature and had
 * nothing to declare until the parser could read the line.
 *
 * **Every spell is a `GrantedSpell` and none is "prepared".** The three prices
 * the line prints are a grant's to carry: At Will is `atWill`, N/Day is a
 * `freeCastPool`, and neither may be cast with a slot, because the creature
 * has none and the line offers none. A cantrip in the list is a grant too —
 * the sentence that offers it is the same sentence — and costs nothing on any
 * route, as every cantrip does.
 *
 * **The numbers ride every grant as well as the source entry.** They are the
 * *line's*, so a casting reads them whichever route it took, and `numbersFor`
 * is the one reader of both.
 *
 * Read from every section, because what a line says is not a property of the
 * heading it is printed under — and refused whole where two lines would
 * declare two sources, which is not a thing the SRD prints and which
 * `SpellcastingState` could hold only by picking one.
 */
function printedSpellcasting(monster: Monster): {
  readonly spellcasting: SpellcastingState | null;
  readonly spellPools: readonly PoolDeclaration[];
} {
  const lines = [
    ...monster.traits,
    ...monster.actions,
    ...monster.bonusActions,
    ...monster.reactions,
    ...monster.legendaryActions,
  ].filter((line) => line.spellcasting !== undefined);

  // One declaration per creature is what `SpellcastingState` holds and what
  // the SRD prints; a block with two read lines would have to be resolved by
  // picking one, which is a decision nobody made.
  const line = lines.length === 1 ? lines[0] : undefined;
  const printed = line?.spellcasting;
  if (line === undefined || printed === undefined) {
    return { spellcasting: null, spellPools: [] };
  }

  // **And refused where one spell is offered at two prices.** A grant list
  // holding the same spell twice is two routes to it, and `chooseRoute` picks
  // the first of them without being asked — so a homebrew block printing
  // "_Light_" under both At Will and 1/Day would silently get whichever
  // category the parser read first. The SRD prints no such block.
  const ids = printed.spells.map((spell) => spell.spellId);
  if (new Set(ids).size !== ids.length) return { spellcasting: null, spellPools: [] };

  const source = printedTraitKey(monster.id, line.name);
  const numbers = {
    ...(printed.saveDc === undefined ? {} : { saveDc: printed.saveDc }),
    ...(printed.attackBonus === undefined ? {} : { attackBonus: printed.attackBonus }),
  };

  const granted: GrantedSpell[] = printed.spells.map((spell) => ({
    spellId: spell.spellId,
    source,
    ability: printed.ability,
    freeCastPool:
      spell.usesPerDay === undefined ? null : printedSpellPoolKey(spell.spellId),
    // SRD offers no slot for any of these, and the creature holds none.
    slotCasting: false,
    ...(spell.usesPerDay === undefined ? { atWill: true as const } : {}),
    ...numbers,
    ...(spell.handOver === undefined ? {} : { handOver: spell.handOver }),
  }));

  const spellPools = printed.spells
    .filter((spell) => spell.usesPerDay !== undefined)
    .map(
      (spell): PoolDeclaration => ({
        key: printedSpellPoolKey(spell.spellId),
        // The block's own words, so a report names the rule the book printed.
        label: `${spell.name} (${spell.usesPerDay!}/Day)`,
        max: spell.usesPerDay!,
        // The clock every other printed per-day limit is on, and the one a
        // rest deliberately does not touch. See `PER_DAY_TALLY`.
        recovers: 'dawn',
      }),
    )
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  return {
    spellcasting: declaredCasting({ ability: printed.ability, granted, ...numbers }),
    spellPools,
  };
}

/**
 * The book's cast lines, onto the creature as the **routes** they are.
 *
 * SRD Priest, Divine Aid (3/Day), under **Bonus Actions**: "The priest casts
 * _Bless, Dispel Magic, Healing Word,_ or _Lesser Restoration,_ using the same
 * spellcasting ability as Spellcasting." Every part of that is already
 * something a `GrantedSpell` carries — a menu of spells, whose ability, whose
 * printed DC — so the line is a route rather than a pipeline of its own, and
 * one grant per spell is what makes the menu a menu.
 *
 * **What the heading says is what the use costs, and it is the one thing a
 * route could not carry until now.** `GrantedSpell.castingTime` is read by
 * `castingOf` and by nothing else, so a Divine Aid printed under Bonus Actions
 * spends the Bonus Action even though *Bless* prints an Action.
 *
 * **The grant pays nothing and the door pays everything.** A cast line's
 * economy is the *heading's* — a recharge, or a count between dawns — and
 * `takeStatedAction` has spent both correctly since printed lines landed. So
 * the grant is `atWill` and holds no pool: two ledgers for one heading is how
 * a creature comes to cast four Blesses out of a 3/Day line, and the price is
 * paid once, at the door, in the ledger the hand-over door already reads.
 *
 * **Actions and Bonus Actions only**, which is where the book prints all
 * fourteen and is the same pair `forcePrintedSave` and `takePrintedTeleport`
 * search: what a heading changes is what the line costs, and a trait costs
 * nothing while a legendary action's economy is one the engine does not hold.
 *
 * **"The same spellcasting ability as Spellcasting" is a reference and is
 * resolved rather than assumed.** A block that prints no Spellcasting line has
 * not said which ability, so the line is refused whole and the reason goes on
 * the sheet's caveats — the engine picking Charisma for it would be the engine
 * inventing a number the book declined to print. The SRD prints no such block;
 * a homebrew one may.
 *
 * And a spell already granted by another line is refused the same way, for
 * `printedSpellcasting`'s reason: two routes to one spell is a choice
 * `chooseRoute` makes without being asked.
 */
function printedCastLines(
  monster: Monster,
  declared: SpellcastingState | null,
): {
  readonly granted: readonly GrantedSpell[];
  readonly caveats: readonly string[];
} {
  const granted: GrantedSpell[] = [];
  const caveats: string[] = [];
  /** Every spell the block already offers, so no two routes reach one spell. */
  const taken = new Set<string>(
    (declared?.granted ?? []).map((grant) => grant.spellId),
  );
  /** The Spellcasting line's own ability and numbers, which a reference names. */
  const reference = declared?.classes[0] ?? null;

  const sections: readonly (readonly [readonly MonsterLine[], CastingTime])[] = [
    [monster.actions, 'action'],
    [monster.bonusActions, 'bonus-action'],
  ];

  for (const [lines, castingTime] of sections) {
    for (const line of lines) {
      const printed = line.casts;
      if (printed === undefined) continue;

      if (printed.ability === 'spellcasting' && reference === null) {
        caveats.push(
          `${line.name} casts "using the same spellcasting ability as Spellcasting" and this block prints no Spellcasting line, so the ability it means is not stated anywhere`,
        );
        continue;
      }
      const clash = printed.spells.filter((spellId) => taken.has(spellId));
      if (clash.length > 0) {
        caveats.push(
          `${line.name} offers ${clash.join(', ')}, which this block already casts by another route`,
        );
        continue;
      }

      const ability = printed.ability === 'spellcasting' ? reference!.ability : printed.ability;
      // **The line's own DC where it prints one, and the Spellcasting line's
      // where the line points at it.** A reference names that line, and the
      // number that line prints is the number the referenced ability produces
      // — so a Priest's Bless is settled at the Priest's printed DC rather
      // than at one derived from a stat block's abilities, which SRD Adult
      // Bronze Dragon shows are not the same thing. A line that states an
      // ability and no DC derives one, as it always would.
      const numbers =
        printed.saveDc !== undefined
          ? { saveDc: printed.saveDc }
          : printed.ability === 'spellcasting'
            ? {
                ...(reference!.saveDc === undefined ? {} : { saveDc: reference!.saveDc }),
                ...(reference!.attackBonus === undefined
                  ? {}
                  : { attackBonus: reference!.attackBonus }),
              }
            : {};

      for (const spellId of printed.spells) {
        taken.add(spellId);
        granted.push({
          spellId,
          source: printedTraitKey(monster.id, line.name),
          ability,
          // The heading's price, and the only thing about this route that is
          // not the spell's own.
          castingTime,
          // **And the heading this route is taken through, which is the only
          // road to it.** The price is the heading's, so a casting that
          // reached this route any other way would pay nothing at all:
          // `routesFor` leaves it out of what a casting searches, and
          // `chooseRoute` refuses a caller that names its source without the
          // printed line's own licence. See `GrantedSpell.throughLine`.
          throughLine: line.name,
          // Paid at the door, out of the heading's recharge or its day's
          // count — see the note above.
          freeCastPool: null,
          // SRD offers no slot for any of these, and the creature holds none.
          slotCasting: false,
          atWill: true,
          ...numbers,
        });
      }
    }
  }

  return { granted, caveats };
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

  const { spellcasting: declared, spellPools } = printedSpellcasting(monster);
  // **The cast lines are grants beside that declaration, not a second one.**
  // A creature holds one `SpellcastingState`, and a block that prints both a
  // Spellcasting line and a Divine Aid prints one creature's magic two ways.
  // A block that prints only cast lines has grants and no class at all, which
  // is a shape `routesFor` has always read.
  const castLines = printedCastLines(monster, declared);
  const spellcasting =
    castLines.granted.length === 0
      ? declared
      : declared === null
        ? { classes: [], granted: castLines.granted }
        : { ...declared, granted: [...declared.granted, ...castLines.granted] };
  const { reactions, pools: reactionPools } = printedReactions(monster);
  const attacks = printedAttacks(monster);
  // **The legendary economy**, where the block prints one: the lines the
  // parser read, and the pool their uses come out of — sized off the block's
  // own number and recovering on nothing a rest or a dawn names, because the
  // book gives it back at the start of the holder's turn and
  // `settleStartOfTurnLegendary` is what does.
  const legendaryActions = printedLegendaryActions(monster);
  const legendaryPools: readonly PoolDeclaration[] =
    monster.legendaryActionUses === undefined
      ? []
      : [
          {
            key: LEGENDARY_POOL,
            label: 'Legendary Action Uses',
            max: monster.legendaryActionUses,
            recovers: 'special',
          },
        ];
  const traits = printedTraits(monster);
  const traitSaves = printedTraitSaves(monster);
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
      // And where it teleports, where the sentence is the book's teleport
      // template. It arrives for the same reason the save did: the line is one
      // no attack could be read out of, and what the structure buys is a door
      // that executes it rather than quotes it.
      //
      ...(line.teleports === undefined ? {} : { teleports: line.teleports }),
      // **And the spells it casts, which arrive with the door that reads
      // them.** The field was deliberately absent for a batch because nothing
      // spent one, and the note that stood here said a field nothing reads is
      // the failure this repository finds most often. `castPrintedLine` is the
      // reader: it takes the menu off this field, checks the spell against it,
      // and hands the casting to the pipeline through the route the adapter
      // compiled above.
      ...(line.casts === undefined ? {} : { casts: line.casts }),
      // And the forms it offers, which the Imp and the Quasit print under this
      // heading and eleven other blocks print under Bonus Actions. It arrives
      // for the reason the teleport did: the line is one no attack could be
      // read out of, and what the structure buys is a door that executes it
      // rather than quotes it.
      ...(line.forms === undefined ? {} : { forms: line.forms }),
      // And what it pulls, which the Roper prints and no other block does.
      ...(line.pulls === undefined ? {} : { pulls: line.pulls }),
      // And whom it swallows and which plane it steps to, the two roads into
      // the second place a stat block prints: SRD Giant Frog's Swallow, SRD
      // Ghost's Etherealness. Each arrives with the door that spends it.
      ...(line.swallows === undefined ? {} : { swallows: line.swallows }),
      ...(line.shiftsPlane === undefined ? {} : { shiftsPlane: line.shiftsPlane }),
      // And the forms the heading gates the line to, where it names any.
      ...(line.onlyInForms === undefined ? {} : { onlyInForms: [...line.onlyInForms] }),
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
    // And where it teleports, which is on both sections for the reason the
    // save is: what a heading changes is what the use costs.
    ...(line.teleports === undefined ? {} : { teleports: line.teleports }),
    // And the spells it casts, on both sections for that same reason — and
    // nine of the book's fourteen cast lines are printed under this heading,
    // which is the whole reason a route may state a casting time.
    ...(line.casts === undefined ? {} : { casts: line.casts }),
    // And the forms it offers — eleven of the book's thirteen Shape-Shift
    // lines are printed here, which is a heading saying what the use costs.
    ...(line.forms === undefined ? {} : { forms: line.forms }),
    // And what it pulls, on both sections because a heading says what a use
    // costs rather than what it does.
    ...(line.pulls === undefined ? {} : { pulls: line.pulls }),
    // And the two roads into the second place, on both sections for the same
    // reason: SRD Phase Spider prints Ethereal Jaunt under this heading.
    ...(line.swallows === undefined ? {} : { swallows: line.swallows }),
    ...(line.shiftsPlane === undefined ? {} : { shiftsPlane: line.shiftsPlane }),
    // And the forms the heading gates it to: SRD Weretiger's Prowl is the one
    // Bonus Action in the book that prints the clause.
    ...(line.onlyInForms === undefined ? {} : { onlyInForms: [...line.onlyInForms] }),
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
    ...(legendaryActions.length === 0 ? {} : { legendaryActions }),
    ...(traits.length === 0 ? {} : { traits }),
    ...(traitSaves.length === 0 ? {} : { traitSaves }),
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
    // **The Reactions section, for the one shape the engine holds a window
    // for.** On the sheet rather than beside it because that is where a
    // Reaction lives — `reactionsOf` reads `sheet.reactions` for a character
    // and for a stat block alike, and nothing about the two roads differs
    // after this point.
    ...(reactions.length === 0 ? {} : { reactions }),
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
    alignment: monster.alignment,
    size: monster.size,
    speed: monster.speed,
    initiativeModifier: monster.initiative,
    cr: monster.cr,
    xp: monster.xp,
    spellcasting,
    // Both kinds of per-day use in one list, sorted by key so two readers of
    // one block agree about the order and a log compares byte for byte.
    pools: [...spellPools, ...reactionPools, ...legendaryPools].sort((a, b) =>
      a.key < b.key ? -1 : a.key > b.key ? 1 : 0,
    ),
    // And the cast lines the adapter refused whole, for the reason it refused
    // them: an ability the block never stated, or a spell it already casts by
    // another route. Reported rather than guessed at, which is the same
    // channel a qualified defence already comes back through.
    caveats: [...caveats, ...castLines.caveats],
  };
}

/** The ceiling and the Fly Speed clause of one row — what a form is judged against. */
export type FormLimits = Pick<ShapeShiftRow, 'maxChallengeRating' | 'flying'>;

/** A Challenge Rating the way the book prints it: 1/8, 1/4, 1/2, then whole. */
const describeChallengeRating = (cr: number): string =>
  cr === 0.125 ? '1/8' : cr === 0.25 ? '1/4' : cr === 0.5 ? '1/2' : String(cr);

/**
 * Why a stat block may not be worn as a form under one row of a shape-shifting
 * table, or null where it may.
 *
 * SRD Wild Shape: "Beast stat blocks that have a maximum Challenge Rating of
 * 1/4 and that lack a Fly Speed", where the row says which ceiling and whether
 * the Fly Speed is allowed yet. Asked at creation of every form a character
 * says it knows, and again at the moment of use, so a list that has gone stale
 * against its book is refused at the door rather than worn.
 */
export function formIneligibility(block: Monster, formType: string, limits: FormLimits): string | null {
  if (!isCreatureType(block.type, formType)) {
    return `a ${block.type} where a ${formType} is wanted`;
  }
  if (block.cr > limits.maxChallengeRating) {
    return `Challenge Rating ${describeChallengeRating(block.cr)} where the ceiling is ${describeChallengeRating(limits.maxChallengeRating)}`;
  }
  if (!limits.flying && (block.speed.fly ?? 0) > 0) {
    return 'a flier, and a form with a Fly Speed may not be taken yet';
  }
  return null;
}

/** A sheet with the named optional fields taken off it. */
function withoutFields<K extends keyof CharacterSheet>(
  sheet: CharacterSheet,
  fields: readonly K[],
): Omit<CharacterSheet, K> {
  const copy: Record<string, unknown> = { ...sheet };
  for (const field of fields) delete copy[field];
  return copy as Omit<CharacterSheet, K>;
}

/**
 * One creature wearing another's statistics — SRD Wild Shape's "Game
 * Statistics", built line by line from the sentence.
 *
 * "Your game statistics are replaced by the Beast's stat block": the block's
 * scores, Armour Class, Speeds, printed attacks, traits and Initiative,
 * through the same {@link adaptMonster} sheet a monster fights from. "But you
 * retain your creature type; Hit Points; Hit Point Dice; Intelligence, Wisdom,
 * and Charisma scores; class features; languages; and feats": the type and
 * the hit points are not on a sheet and stay where they are; the scores the
 * grant names are the holder's; every compiled feature list is the holder's,
 * and the block's own printed rules stand beside them. "You also retain your
 * skill and saving throw proficiencies and use your Proficiency Bonus for
 * them, in addition to gaining the proficiencies of the creature. If a skill
 * or saving throw modifier in the Beast's stat block is higher than yours, use
 * the one in the stat block": the level stays the holder's so the bonus is
 * theirs, and each save and each printed skill is stated as the higher of the
 * block's number and the holder's own, read off the merged scores.
 *
 * **The Armour Class is always the block's** — the owner's ruling of
 * 2026-09-20 — so the worn armour comes off the sheet here and an Unarmored
 * Defense with it; the items stay in the creature's hands, merged and silent,
 * which `itemStandingOf` reads. The Attack action holds the larger count of
 * the two sheets: a block's Multiattack and a class's Extra Attack are the
 * same sentence said twice, and the SRD takes the highest.
 */
export function assumeStatBlock(
  own: CharacterSheet,
  form: AdaptedMonster,
  keeps: readonly Ability[],
): CharacterSheet {
  const block = form.sheet;
  const abilities = { ...block.abilities };
  for (const ability of keeps) abilities[ability] = own.abilities[ability];

  // The holder's own numbers over the merged scores, with the stated values
  // out of the way so nothing is compared against itself.
  const draft: CharacterSheet = {
    ...withoutFields(own, ['stated', 'unarmoredDefense']),
    abilities,
    armor: null,
    shield: null,
  };

  const saves: Partial<Record<Ability, number>> = {};
  for (const ability of ABILITIES_IN_ORDER) {
    const printed = block.stated?.saves?.[ability];
    const mine = saveModifier(draft, ability);
    saves[ability] = printed === undefined ? mine : Math.max(printed, mine);
  }
  const skills: Partial<Record<Skill, number>> = {};
  for (const [skill, printed] of Object.entries(block.stated?.skills ?? {}) as [Skill, number][]) {
    skills[skill] = Math.max(printed, skillModifier(draft, skill));
  }

  // The block's own bonus is not carried: "use your Proficiency Bonus for
  // them" is the holder's, read off the level this sheet keeps, and every
  // printed attack already has the block's baked into its number.
  const stated: StatedValues = { ...withoutStatedBonus(block.stated ?? {}), saves, skills };
  const standing = [...(own.standing ?? []), ...(block.standing ?? [])];
  const attacksPerAction = Math.max(own.attacksPerAction ?? 1, block.attacksPerAction ?? 1);

  return {
    ...withoutFields(own, ['stated', 'unarmoredDefense', 'speeds', 'attacksPerAction']),
    abilities,
    armor: null,
    shield: null,
    baseSpeed: block.baseSpeed,
    ...(block.speeds === undefined ? {} : { speeds: block.speeds }),
    ...(standing.length === 0 ? {} : { standing }),
    ...(attacksPerAction > 1 ? { attacksPerAction } : {}),
    stated,
  };
}

/** The stated values without the block's Proficiency Bonus; see {@link assumeStatBlock}. */
function withoutStatedBonus(stated: StatedValues): StatedValues {
  const copy: Record<string, unknown> = { ...stated };
  delete copy['proficiencyBonus'];
  return copy as StatedValues;
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
export type PrintedRider =
  | PrintedConditionRider
  | PrintedGrappleRider
  | PrintedDamageRider
  | PrintedForcedMoveRider
  | PrintedSpeedCutRider
  | PrintedMaximumRider
  | PrintedModeRider
  | PrintedDroppedToZeroRider
  | PrintedAttachRider
  | PrintedHazardRider
  | PrintedArmorPenaltyRider
  | PrintedAbilityDrainRider;

/**
 * A clause about the **damage roll** rather than about an effect the hit buys.
 *
 * The third member, and the one this reader's own refusals used to name: "an
 * extra damage die — a Bloodied swarm's, a Goblin's when the attack roll had
 * Advantage — belongs to the damage roll rather than to an effect list: it is
 * doubled by a critical hit and meets the target's defences with the blow, and
 * a rider is a leaf that rolls nothing." Every word of that is true of
 * {@link HitOption}, which is what the other two members become; none of it is
 * an argument for leaving the sentence to a DM. So the swing reads this one
 * where it rolls the damage instead of where it builds the effect list, and
 * {@link PrintedConditionRider}'s path never sees it.
 *
 * **Two shapes and the book's own connective tells them apart.** SRD Goblin
 * Warrior writes "**plus** 2 (1d4) Slashing damage if the attack roll had
 * Advantage" — a component beside the line's own, which is `ExtraDamage`. SRD
 * Swarm of Rats writes "**or** 2 (1d4) Piercing damage if the swarm is
 * Bloodied" — the damage the line rolls *instead*, which is a swarm at half
 * strength biting for less rather than for more. Reading the second as an
 * addition would make a dying swarm deadlier than a whole one.
 *
 * **What is read is what the engine already holds the fact for**, which is the
 * rule {@link readPrintedRider} keeps throughout: whether the attack roll had
 * Advantage is a property of the roll it just made, and whether a creature is
 * Bloodied is half its Hit Points. The charge gate — "moved 20+ feet straight
 * toward it immediately before the hit" — used to be refused here because
 * nothing recorded the shape of the move that preceded a swing;
 * `TurnBudget.movementSegments` is that record, so it is a gate like the rest.
 */
export interface PrintedDamageRider {
  readonly kind: 'damage';
  /**
   * The book's own connective: `plus` is a component beside the line's own
   * damage, `or` is the damage it rolls in place of it.
   */
  readonly how: 'extra' | 'instead';
  /** The notation inside the parentheses — SRD's `1d4`. */
  readonly dice: string;
  /** SRD's "(1d4 **+ 1**)", and 0 where the line prints none. */
  readonly flat: number;
  /**
   * The type, or {@link DECLARED_DAMAGE_TYPE} where the block prints none.
   *
   * SRD Half-Dragon's Claw: "7 (2d6) damage of the type chosen for the
   * Draconic Origin trait", and that trait ends "(GM's choice)". The word is
   * not a damage type and the swing does not deal it — it asks for the real
   * one and reports the clause unapplied until a DM has ruled.
   */
  readonly type: DamageType | typeof DECLARED_DAMAGE_TYPE;
  /** SRD's "If the target is a Medium or smaller creature". */
  readonly ifNoLargerThan?: CreatureSize;
  /**
   * What the clause is conditioned on, where it is conditioned on anything.
   *
   * **Optional, and one sentence is why.** SRD Swarm of Venomous Snakes writes
   * "or 6 (1d4 + 4) Piercing damage if the swarm is Bloodied**—plus 10 (3d6)
   * Poison damage**": the gate belongs to the first half and the second half
   * is simply more damage. A gate invented for it would be a rule nobody
   * printed; requiring one would hand a whole line to the DM over a dash.
   *
   * An `instead` clause with no gate is refused rather than read, because
   * "the damage it rolls in place of its own, always" is not a sentence.
   */
  readonly when?: PrintedHitGate;
}

/**
 * What a printed clause is conditioned on.
 *
 * A closed list of what the engine can answer, because a gate it cannot
 * evaluate is a rider read half-way — which is the failure the verbatim string
 * is carried to avoid. A sentence naming any other gate comes back null and is
 * handed to the DM whole.
 *
 * **Shared by the damage clause and the condition clause**, because the book
 * shares it: SRD Boar writes one sentence that is an extra die *and* a Prone,
 * both behind the same charge, and reading the gate onto only one of them
 * would be half a rule.
 */
export type PrintedHitGate =
  /** SRD's "if the swarm is Bloodied", "if the target is Bloodied". */
  | { readonly kind: 'bloodied'; readonly who: HitRiderAnchor }
  /** SRD Goblin Warrior's "if the attack roll had Advantage". */
  | { readonly kind: 'attack-had-advantage' }
  | PrintedChargeGate
  /**
   * SRD Mimic's Bite: "if the target is Grappled by the mimic".
   *
   * A fact the engine holds outright — `grapplesOn` finds every grapple by the
   * `grapple:<who>` source its instance is filed under — so it is a gate and
   * not a handover.
   */
  | { readonly kind: 'grappled-by-attacker' };

/**
 * SRD Boar: "the boar moved 20+ feet straight toward it immediately before the
 * hit".
 *
 * The feet the line prints, which is 10 for the Minotaur of Baphomet, 20 for
 * most of the bestiary and 30 for the Allosaurus — so it is a number rather
 * than a flag. What answers it is the mover's own turn budget: see
 * `TurnBudget.movementSegments`.
 *
 * **Its own type because it is the only gate a condition clause can carry.**
 * The other three are facts about the blow — the roll's mode, half a
 * creature's Hit Points, a hold — and the book prints them on the damage; the
 * charge is a fact about the turn, knowable before the die. What a hit *buys*
 * is settled before the d20 so a hold can pin it, so a condition clause gated
 * on the roll could not be answered at the moment it is built, and a type that
 * could say it would be a clause that quietly never fired.
 */
export interface PrintedChargeGate {
  readonly kind: 'charged';
  readonly feet: number;
}

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
  /**
   * What the clause is conditioned on — SRD Gorgon's charge, and nothing else.
   *
   * One printed sentence can be an extra die and a condition behind one "if",
   * which is why the gate is on both riders; it is narrowed to the charge here
   * for the reason {@link PrintedChargeGate} gives.
   */
  readonly when?: PrintedChargeGate;
  /**
   * SRD Bearded Devil's Beard: "Until this poison ends, the target can't
   * regain Hit Points."
   *
   * A second sentence about the **same** condition and the same span, so it is
   * a field on the condition rather than a rider of its own: what it would
   * otherwise need is a deadline of its own that always equalled this one.
   */
  readonly preventsHealing?: true;
}

/**
 * A shove the hit itself delivers — SRD Satyr: "the satyr pushes the target up
 * to 10 feet straight away from itself"; SRD Merrow: "the merrow pulls the
 * target up to 15 feet straight toward itself".
 *
 * Its own member rather than an effect, for {@link PrintedGrappleRider}'s
 * reason: forced movement is lattice arithmetic between two creatures and not
 * something hung on one of them. `shoveAwayFrom` and `pullToward` perform it.
 *
 * "Up to" is read as the whole distance. The book leaves the amount to the
 * creature doing the shoving, and the engine has no creature to ask; the
 * printed number is the only one on the page, and a shorter one would be
 * invented.
 */
export interface PrintedForcedMoveRider {
  readonly kind: 'forced-move';
  readonly direction: 'push' | 'pull';
  readonly feet: number;
  /** SRD's "If the target is a Large or smaller creature". */
  readonly ifNoLargerThan?: CreatureSize;
}

/**
 * SRD Merfolk Skirmisher: "its Speed decreases by 10 feet until the end of its
 * next turn."
 *
 * The span is required rather than optional, and that is the sentence rather
 * than a convenience: every printed Speed cut on a hit names a moment, and one
 * that did not would be a Speed nothing could ever give back.
 */
export interface PrintedSpeedCutRider {
  readonly kind: 'speed-cut';
  readonly feet: number;
  readonly lasts: TurnAnchor;
  readonly lastsOn: HitRiderAnchor;
}

/**
 * SRD Specter and SRD Wraith: "its Hit Point maximum decreases by an amount
 * equal to the damage taken."
 *
 * It carries no number, because the number is the blow's: the amount is read
 * off the damage after the target's own defences, at the moment it settles.
 */
export interface PrintedMaximumRider {
  readonly kind: 'hit-point-maximum';
}

/**
 * A **hazard** the hit leaves the target standing in — SRD Fire Elemental's
 * Burn: "If the target is a creature or a flammable object, it starts
 * burning"; SRD Magmin's Touch, the same with the object qualified.
 *
 * It carries no number and no span, and neither is an omission. The 1d4 and
 * the boundary it falls due at are the **glossary's** — every line that prints
 * this sentence prints "it starts burning" and nothing else — so a copy here
 * would be one of three transcriptions of one rule, free to disagree. And a
 * fire has no deadline: it burns until somebody rolls on the ground or the
 * table douses it, which is why this is not a {@link PrintedConditionRider}
 * whose span the reader would then have had to invent.
 *
 * **Only the creature half is read.** The same sentence catches "a flammable
 * object", and the engine holds no flammability — a declared object is a
 * substance and a size, and whether the oak door in this room takes light is
 * the table's. So the swing applies it to a creature and hands the object half
 * back where the target is one; and SRD Barbed Devil's Hurl Flame, which
 * catches **only** an object, is not read at all.
 */
export interface PrintedHazardRider {
  readonly kind: 'hazard';
  readonly hazard: HazardName;
}

/**
 * Armour the hit **wears down** — SRD Black Pudding's Dissolving Pseudopod and
 * SRD Gray Ooze's Pseudopod: "Nonmagical armor worn by the target takes a −1
 * penalty to the AC it offers."
 *
 * The points are the sentence's own number and the destruction is not a field:
 * "The armor is destroyed if the penalty reduces its AC to 10" is a second
 * sentence stating the rule the swing then applies, so it is read and consumed
 * rather than carried — the reading {@link ATTACH_DETACH_ACTION} already gets.
 * A line printing some *other* ceiling would not match and would go back to
 * the table, which is the right answer: nothing here could apply it.
 *
 * "Nonmagical" is carried by nothing, and that is honest rather than a gap: no
 * armour in the SRD catalogue is magical, so there is no record to narrow on
 * and a flag nothing could ever read would be the speculative member the
 * sweeps refuse. The day a +1 Breastplate exists, the swing asks the record.
 */
export interface PrintedArmorPenaltyRider {
  readonly kind: 'armor-penalty';
  /** SRD's "a −1 penalty", as a positive number of points eaten. */
  readonly points: number;
}

/**
 * An ability score the hit **drains** — SRD Shadow's Draining Swipe: "the
 * target's Strength score decreases by 1d4. The target dies if this reduces
 * that score to 0."
 *
 * The die is the sentence's own and is thrown at the settlement, never here;
 * the death is not a field, because "dies if this reduces that score to 0" is
 * arithmetic over the score as it then stands and `applyHitRider` does it —
 * the reading {@link PrintedArmorPenaltyRider}'s destruction sentence already
 * gets. A line printing some other floor would not match and would go back to
 * the table.
 *
 * What the sentence after it says — "If a Humanoid is slain by this attack, a
 * Shadow rises from the corpse 1d4 hours later" — is a stat block created
 * hours later from a corpse, which is the table's, and is carried.
 */
export interface PrintedAbilityDrainRider {
  readonly kind: 'ability-score-decrease';
  readonly ability: Ability;
  /** SRD's "1d4". */
  readonly dice: string;
}

/**
 * What the blow leaves behind **only if it was the blow that emptied them** —
 * SRD Phase Spider: "If this damage reduces the target to 0 Hit Points, the
 * target becomes Stable, and it has the Poisoned condition for 1 hour"; SRD
 * Gibbering Mouther: "The target dies if it is reduced to 0 Hit Points by this
 * attack."
 *
 * **A gate on the outcome rather than a gate on the swing**, which is what
 * makes it its own member and not a {@link PrintedHitGate}. Every gate in that
 * union is answerable before the damage is dealt — a size, a creature type, a
 * roll's mode, half a creature's Hit Points — and this one is answerable only
 * after: the fact it reads is *this* blow having taken the last hit point, and
 * nothing before the blow can know it.
 *
 * **"Reduces to 0" is not "is at 0".** A creature already on the floor that is
 * hit again takes a Death Saving Throw failure, which is the rule the damage
 * path already writes; it does not land this rider a second time. So the swing
 * hands in whether the drop happened rather than reading a nought off the
 * state, because the two are indistinguishable afterwards.
 *
 * The three clauses are the three the book writes, and they are independent:
 * SRD prints the Stable with a condition, and the Mouther prints the death
 * alone. A line that printed both would be a sentence nobody wrote, and
 * nothing here needs to rule on it — {@link applyHitRider}'s order does.
 */
export interface PrintedDroppedToZeroRider {
  readonly kind: 'on-dropping-to-zero';
  /** SRD's "the target becomes Stable". */
  readonly stable?: true;
  /** SRD Gibbering Mouther's "The target dies". */
  readonly dies?: true;
  /** SRD's "it has the Poisoned condition for 1 hour", in printed order. */
  readonly conditions?: readonly PrintedDroppedCondition[];
}

/** One condition a drop to 0 leaves, for the span the line prints on it. */
export interface PrintedDroppedCondition {
  readonly condition: ConditionName;
  /**
   * SRD Phase Spider: "While Poisoned, the target **also** has the Paralyzed
   * condition."
   *
   * {@link PrintedGrappleRider.whileHeld} one clause along and for its exact
   * reason: a condition that lasts as long as another is
   * `ConditionInstance.impliedBy`, so it lifts with the one that carried it
   * through the doors that already exist. Here the carrier is the hour rather
   * than a hold.
   */
  readonly implies?: readonly ConditionName[];
  /**
   * SRD's "for 1 hour", as the clock's own unit.
   *
   * Required rather than optional, and that is the sentence: every printed
   * drop-to-0 condition names a span, and one that did not would be a
   * Paralyzed nothing could ever lift — the rule
   * {@link PrintedSpeedCutRider.lasts} already states about a Speed.
   */
  readonly lastsSeconds: number;
}

/**
 * A mode on **one** later roll — SRD Ettin: "the target has Disadvantage on the
 * next attack roll it makes before the end of its next turn"; SRD Worg: "the
 * next attack roll made against the target before the start of the worg's next
 * turn has Advantage."
 *
 * `RollModifier.oneShot` is the half that says "the next", and the span is the
 * half that says "before"; both endings stand and the first to arrive wins.
 * The relation is which end of the roll the target stands at, which is the
 * difference between the two sentences and not a wording.
 */
export interface PrintedModeRider {
  readonly kind: 'roll-mode';
  readonly mode: 'advantage' | 'disadvantage';
  /** `roller` is a roll the target makes; `against-holder` is one made at it. */
  readonly relation: 'roller' | 'against-holder';
  readonly lasts: TurnAnchor;
  readonly lastsOn: HitRiderAnchor;
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
  /**
   * SRD Crocodile: "While Grappled, the target has the Restrained condition."
   *
   * A condition that lasts exactly as long as the hold — which is a lifetime
   * the engine does have, and had all along: `ConditionInstance.impliedBy` is
   * how Unconscious carries Prone, and `removeConditionInstance` takes an
   * implied instance off with the one that carried it. So the escape, the two
   * automatic lapses and a grappler's release each lift both, through the door
   * they already went through.
   *
   * **Read here and refused at the plain-condition door**, which is not a
   * contradiction: {@link NOT_A_PLAIN_CONDITION} refuses a Restrained filed
   * under a *rider's own* source, because that would be a Restrained nothing
   * could end. One filed under the grapple ends with the grapple.
   */
  readonly whileHeld?: readonly ConditionName[];
  /**
   * SRD Animated Rug of Smothering: "the rug can give it the Grappled
   * condition (escape DC 13) **instead of dealing damage**."
   *
   * An offer the line makes to whoever is swinging, which is why it is a flag
   * rather than a behaviour: the book writes "can", and the engine has nobody
   * to ask. So the swing names the choice, a swing that names none deals the
   * damage the line prints, and a swing that names one on a line that does not
   * offer it is refused.
   */
  readonly insteadOfDamage?: true;
  /**
   * What the hold costs the creature it is on at each of somebody's turn
   * boundaries — SRD's "takes 10 (2d6 + 3) Bludgeoning damage at the start of
   * each of its turns".
   *
   * {@link PrintedAttachRider.payout}'s twin on the other kind of hold, and
   * the same record: the book writes the same sentence under both, and the
   * only thing that differs is whose turn the boundary belongs to.
   */
  readonly payout?: PrintedHoldPayout;
}

/**
 * A creature that **fixes itself to the target** — SRD Stirge: "the stirge
 * attaches to the target"; SRD Darkmantle: "the darkmantle attaches to the
 * target."
 *
 * **Not a grapple, and the difference is which end is held.** A grapple gives
 * the *target* the Grappled condition and ends on facts about the grappler; an
 * attach leaves the target free to walk off with the attacker on them, and
 * comes off either by the attacker spending five feet of its movement or by
 * somebody spending an Action on it. So it is filed on the creature that
 * attached, and `grapplesOn` correctly finds nothing.
 *
 * **Everything below is optional because the two blocks that print one share
 * only the first sentence.** A stirge attaches and drinks; a darkmantle
 * attaches, blinds and pins its own Speed. Each clause after the first is read
 * as a detail of the attach it follows, for the reason "While Grappled" is
 * read as a detail of the grapple before it: standing alone it names a hold
 * that is not there.
 */
export interface PrintedAttachRider {
  readonly kind: 'attach';
  /**
   * SRD Darkmantle: "a successful DC 13 Strength (Athletics) check".
   *
   * Absent where the line asks for none, which is SRD Stirge — and that
   * absence is the rule rather than a default: "The target or a creature
   * within 5 feet of it can detach the stirge as an action" is an action and
   * no roll, and inventing a DC for it would be a check nobody printed.
   */
  readonly detachDc?: number;
  /** SRD Darkmantle: "Its Speed becomes 0" — the *attacher's* own. */
  readonly holderSpeedBecomesZero?: true;
  /** SRD Darkmantle's cover, where the line prints one. */
  readonly covers?: PrintedAttachCover;
  /** SRD Stirge's 2 (2d4) Necrotic at the start of each of its own turns. */
  readonly payout?: PrintedHoldPayout;
}

/**
 * SRD Darkmantle: "If the target is a Medium or smaller creature **and the
 * darkmantle had Advantage on the attack roll**, it covers the target, which
 * has the Blinded condition."
 *
 * Two gates, and the second is a fact about the roll — which is why it is
 * *carried* rather than answered here and rather than being a
 * {@link PrintedHitGate}: what a hit buys is settled before the d20 so a hold
 * can pin it, and this clause alone has to be narrowed afterwards. See
 * `PrintedChargeGate`, which makes the same argument the other way round.
 */
export interface PrintedAttachCover {
  /** In printed order — SRD's "the Blinded condition". */
  readonly conditions: readonly ConditionName[];
  readonly ifNoLargerThan?: CreatureSize;
  readonly ifAttackHadAdvantage?: true;
}

/**
 * What a hold hands over at every one of somebody's turn boundaries — SRD
 * Stirge: "the target takes 5 (2d4) Necrotic damage at the start of each of
 * the stirge's turns."
 *
 * `GrantedPayout` as a printed line states it, and every field is one the book
 * writes. **`onTurnOf` is the load-bearing one**: the Stirge names its own
 * turns and the Rug writes "its", which by this reader's own convention is the
 * creature that was struck — and they are a round apart, exactly as a deadline
 * anchored on the wrong creature is.
 *
 * The dice are a notation rather than a total, as everywhere else here: a
 * payment that repeats throws a new die at each boundary.
 */
export interface PrintedHoldPayout {
  readonly dice: string;
  readonly flat: number;
  readonly type: DamageType;
  readonly at: TurnMoment;
  readonly onTurnOf: HitRiderAnchor;
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
const NEXT_TURN_MOMENT = `the (end|start) of (?:(its)|the (.+?)${APOSTROPHE}s) next turn`;

const UNTIL_NEXT_TURN = `until ${NEXT_TURN_MOMENT}`;

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
 * SRD Animated Rug of Smothering: "If the target is a Medium or smaller
 * creature, the rug can give it the Grappled condition (escape DC 13)
 * **instead of dealing damage**."
 *
 * Its own pattern rather than an optional tail on the one above, because the
 * whole sentence is written differently: "the rug can give it" is an offer and
 * "it has" is a consequence, and a reader that read the offer as the
 * consequence would grapple on every hit the line ever landed.
 */
const PRINTED_GRAPPLE_OFFERED = new RegExp(
  `^If the target is a ${SIZE_WORDS} or smaller creature, the .+? can give it the Grappled condition \\(escape DC (\\d+)\\) instead of dealing damage\\.$`,
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

/**
 * SRD Goblin Warrior: "plus 2 (1d4) Slashing damage if the attack roll had
 * Advantage." SRD Swarm of Insects: "or 3 (1d4 + 1) Poison damage if the swarm
 * is Bloodied."
 *
 * The average before the parentheses is the book's own arithmetic over the
 * notation beside it, so it is matched and dropped rather than read: two
 * numbers for one amount is a place for them to disagree, and the dice are the
 * half the engine can actually throw.
 *
 * **The `$` no longer refuses a second clause, because a second clause is now
 * a second reading rather than a failure.** The Swarm of Venomous Snakes
 * appends "—plus 10 (3d6) Poison damage" and the Swarm of Crawling Claws a
 * second sentence about Prone; {@link readPrintedRiders} splits both and hands
 * each half here on its own, so the anchor still says "this clause and nothing
 * after it" and the line is no longer refused whole.
 *
 * The gate is optional for the sentence the dash produces — "plus 10 (3d6)
 * Poison damage" is conditioned on nothing — and {@link readClause} refuses an
 * ungated `or`, which would be a sentence nobody printed.
 */
/**
 * The type slot of a printed rider's amount, which the book writes two ways.
 *
 * `Poison damage` is the ordinary one and is captured. `damage of the type
 * chosen for the Draconic Origin trait` is SRD Half-Dragon's Claw, and it
 * captures **nothing** — there is no word there to capture, and the table is
 * what supplies it. The same slot `printed-save.ts` reads on the other half of
 * the sheet, and for the same reason.
 */
const RIDER_TYPE_SLOT = `(?:([A-Za-z]+) damage|damage of the type chosen for the [A-Za-z][A-Za-z' -]* trait)`;

const PRINTED_DAMAGE = new RegExp(
  `^(?:(plus|or) )?\\d+ \\((\\d+d\\d+)(?: \\+ (\\d+))?\\) ${RIDER_TYPE_SLOT}(?: if (.+))?\\.$`,
);

/** SRD's "the swarm is Bloodied", "the target is Bloodied". */
const BLOODIED_GATE = /^the (.+?) is Bloodied$/;

/** SRD Goblin Warrior's gate, which is a fact about the roll just made. */
const ADVANTAGE_GATE = 'the attack roll had Advantage';

/**
 * SRD Goat: "the goat moved 20+ feet straight toward the target immediately
 * before the hit" — the charge, where the book writes it as a gate on the
 * damage rather than as the whole sentence.
 */
const CHARGE_GATE = /^the .+ moved (\d+)\+ feet straight toward the target immediately before the hit$/;

/**
 * SRD Mimic's Bite: "the target is Grappled by the mimic".
 *
 * The em dash is excluded because the very line that prints this gate appends
 * one — "…Grappled by the mimic**—plus 4 (1d8) Acid damage**" — and a capture
 * that ran past it would swallow the second clause into the creature's name
 * and drop a damage component without even handing it back. The other two
 * gates are anchored on their own last words and cannot.
 */
const GRAPPLED_BY_GATE = /^the target is Grappled by the [^—]+$/;

/**
 * SRD Boar: "If the target is a Medium or smaller creature and the boar moved
 * 20+ feet straight toward it immediately before the hit, the target takes an
 * extra 3 (1d6) Piercing damage and has the Prone condition."
 *
 * **One sentence and up to three readings**, which is why it is its own
 * pattern rather than a gate bolted onto {@link GATED_CONDITION}: a size, a
 * charge, an optional extra die, a condition, and — the Allosaurus alone — a
 * free attack after a comma that nothing in the engine grants and that is
 * handed straight back.
 *
 * The articles are loose because the book's are: SRD Rhinoceros writes "If
 * target is a Large or smaller creature" with no article and SRD Triceratops
 * writes "If the target is Huge or smaller" with no noun. Both are the same
 * rule, and a reader that refused either would hand a charge to the DM over a
 * transcription.
 */
const CHARGED_HIT = new RegExp(
  `^If (?:the )?target is (?:an? )?${SIZE_WORDS} or smaller(?: creature)? and the .+? moved (\\d+)\\+ feet straight toward it immediately before the hit, the target (?:takes an extra \\d+ \\((\\d+d\\d+)(?: \\+ (\\d+))?\\) ([A-Za-z]+) damage and )?has the ([A-Za-z]+) condition(?:, and (.+?))?\\.$`,
);

/**
 * SRD Satyr: "If the target is a Medium or smaller creature, the satyr pushes
 * the target up to 10 feet straight away from itself." SRD Merrow pulls
 * instead, and SRD Shambling Mound pulls a flat five feet with no "up to".
 *
 * The direction is read off the **preposition** rather than off the verb,
 * because the preposition is what the arithmetic needs and the two always
 * agree; a line whose verb and preposition disagreed would be a sentence
 * nobody printed, and it would come back as a push toward nothing.
 */
const PRINTED_SHOVE = new RegExp(
  `^If the target is a ${SIZE_WORDS} or smaller creature, the .+? (?:pushes|pulls) the target (?:up to )?(\\d+) feet straight (away from|toward) itself\\.$`,
);

/** SRD Merfolk Skirmisher: "its Speed decreases by 10 feet until the end of its next turn." */
const PRINTED_SPEED_CUT = new RegExp(
  `^If the target is a creature, its Speed decreases by (\\d+) feet ${UNTIL_NEXT_TURN}\\.$`,
);

/** SRD Specter and SRD Wraith, word for word. */
const PRINTED_MAXIMUM =
  /^If the target is a creature, its Hit Point maximum decreases by an amount equal to the damage taken\.$/;

/**
 * SRD Fire Elemental's Burn: "If the target is a creature or a flammable
 * object, it starts burning." SRD Magmin's Touch qualifies the object — "that
 * isn't being worn or carried" — and says the same thing about the creature.
 *
 * **"a creature" is required and the object half is optional**, which is what
 * refuses SRD Barbed Devil's Hurl Flame: "If the target is a flammable object
 * that isn't being worn or carried, it starts burning" catches no creature at
 * all, and a reader that matched it would set fire to everybody the devil hit.
 * The two sentences differ by four words and by the whole of the rule.
 */
const STARTS_BURNING = new RegExp(
  `^If the target is a creature(?: or a flammable object)?(?: that isn${APOSTROPHE}t being worn or carried)?, it starts burning\\.$`,
);

/**
 * SRD Black Pudding's Dissolving Pseudopod and SRD Gray Ooze's Pseudopod:
 * "Nonmagical armor worn by the target takes a −1 penalty to the AC it
 * offers."
 *
 * Both the hyphen-minus and the book's own minus sign, because a transcription
 * may carry either and they are the same number.
 */
const PRINTED_ARMOR_PENALTY =
  /^Nonmagical armor worn by the target takes a [-−](\d+) penalty to the AC it offers\.$/;

/**
 * SRD's second sentence: "The armor is destroyed if the penalty reduces its AC
 * to 10."
 *
 * **Read and consumed rather than stored**, exactly as SRD Stirge's five-foot
 * detach is: it states the rule the swing already applies to every armour
 * penalty, so a field for it would be a second copy of one number free to
 * disagree.
 *
 * **The ceiling is the engine's, and the consumed sentence does not carry
 * it.** Both lines in the book print the same 10, so reading the number off
 * the page and reading it off `corrodeArmor` come to the same answer today —
 * and a homebrew line that printed a *different* ceiling would have this
 * sentence handed back while its penalty went on being destroyed at 10. That
 * is a wrong rule rather than a refusal, and it is the one this shape has:
 * the day a second ceiling is printed, the number joins
 * {@link PrintedArmorPenaltyRider} and `HitOption.penalisesArmor` becomes a
 * pair.
 */
const ARMOR_DESTROYED_AT_TEN = /^The armor is destroyed if the penalty reduces its AC to 10\.$/;

/**
 * SRD Shadow's Draining Swipe: "and the target's Strength score decreases by
 * 1d4."
 *
 * The book's ability word, because `abilityWord` keys it; the notation whole,
 * because the die is thrown where the blow settles.
 */
const PRINTED_ABILITY_DRAIN = new RegExp(
  `^and the target${APOSTROPHE}s (Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) score decreases by (\\d+d\\d+)\\.$`,
);

/**
 * SRD's second sentence: "The target dies if this reduces that score to 0."
 *
 * **Read and consumed rather than stored**, for {@link ARMOR_DESTROYED_AT_TEN}'s
 * reason: it states the rule the swing applies to every drain — a score at 0
 * is a death — so a field for it would be a second copy of one number free to
 * disagree. The floor is the engine's, and a homebrew line that printed a
 * different one would have this sentence handed back while its drain went on
 * killing at 0, which is the same wrong rule the armour sentence records.
 */
const DIES_AT_ZERO_SCORE = /^The target dies if this reduces that score to 0\.$/;

/** SRD Ettin: a mode on the roll the creature that was hit makes next. */
const PRINTED_MODE_ON_TARGET = new RegExp(
  `^and the target has (Advantage|Disadvantage) on the next attack roll it makes before ${NEXT_TURN_MOMENT}\\.$`,
);

/** SRD Worg: the same mechanic from the other end of the relation. */
const PRINTED_MODE_AGAINST_TARGET = new RegExp(
  `^and the next attack roll made against the target before ${NEXT_TURN_MOMENT} has (Advantage|Disadvantage)\\.$`,
);

/**
 * SRD Crocodile: "While Grappled, the target has the Restrained condition."
 *
 * A sentence **about the sentence before it**, which is why what it reads to
 * is folded into the grapple rather than standing on its own: there is nothing
 * for it to mean without one. SRD Giant Crocodile appends "and can't be
 * targeted by the crocodile's Tail", which is handed back.
 */
const WHILE_GRAPPLED = /^While Grappled, the target has the ([A-Za-z]+) condition(?: and (.+?))?\.$/;

/**
 * SRD Stirge and SRD Darkmantle: "and the stirge attaches to the target."
 *
 * The whole of the first sentence, and every clause after it is read as a
 * detail of this one — see {@link PrintedAttachRider}.
 */
const PRINTED_ATTACH = /^and the .+? attaches to the target\.$/;

/**
 * The boundary half of a hold's payment: "at the start of each of its turns",
 * "at the start of each of the stirge's turns".
 *
 * Both possessives, routed through {@link anchorOf} exactly as a deadline's
 * is: the Stirge writes its own noun and the Rug writes "its", and they are a
 * round apart.
 */
const EACH_TURN = `at the (start|end) of each of (?:(its)|the (.+?)${APOSTROPHE}s) turns`;

/** The amount half, as the book prints it: an average, a notation, a type. */
const PAID_AMOUNT = `\\d+ \\((\\d+d\\d+)(?: \\+ (\\d+))?\\) ([A-Za-z]+) damage`;

/**
 * SRD Stirge: "While attached, the stirge can't make Proboscis attacks, and
 * the target takes 5 (2d4) Necrotic damage at the start of each of the
 * stirge's turns."
 *
 * The clause between the comma and the payment is a rule about which of its
 * own printed lines a creature may take, which nothing here keeps — so it is
 * captured and handed back rather than swallowed, the reading the limb phrase
 * on a grapple already gets.
 */
const WHILE_ATTACHED_PAYS = new RegExp(
  `^While attached, (?:(.+?), and )?the target takes ${PAID_AMOUNT} ${EACH_TURN}\\.$`,
);

/**
 * SRD Animated Rug of Smothering: "Until the grapple ends, the target has the
 * Blinded and Restrained conditions, is suffocating, and takes 10 (2d6 + 3)
 * Bludgeoning damage at the start of each of its turns."
 *
 * {@link WHILE_GRAPPLED}'s longer form: the same borrowed lifetime, plus what
 * the hold costs each turn, plus whatever the sentence says in between — which
 * here is a suffocation nothing in the engine drowns, handed back.
 */
const UNTIL_THE_GRAPPLE_ENDS = new RegExp(
  `^Until the grapple ends, the target has the ([A-Za-z]+)(?: and (?:the )?([A-Za-z]+))? conditions?(?:, (.+?))?, and takes ${PAID_AMOUNT} ${EACH_TURN}\\.$`,
);

/**
 * SRD Darkmantle: "If the target is a Medium or smaller creature and the
 * darkmantle had Advantage on the attack roll, it covers the target, which has
 * the Blinded condition and is suffocating while the darkmantle is attached in
 * this way."
 */
const ATTACH_COVERS = new RegExp(
  `^If the target is a ${SIZE_WORDS} or smaller creature and the .+? had Advantage on the attack roll, it covers the target, which has the ([A-Za-z]+) condition(?: and (.+?))? while the .+? is attached in this way\\.$`,
);

/** SRD Darkmantle: "Its Speed becomes 0, it can't benefit from any bonus to its Speed, …" */
const ATTACHED_SPEED_ZERO = /^Its Speed becomes 0(?:, (.+?))?\.$/;

/**
 * SRD Darkmantle: "…doing so with a successful DC 13 **Strength (Athletics)**
 * check."
 *
 * **The pair is matched literally and only the DC is captured**, which is the
 * rule this reader keeps everywhere: what is read is what the engine holds the
 * fact for. Nothing on an attach records which ability a detach is rolled
 * with, so a line printing any other pair would be read, accepted and then
 * rolled as Strength — a rule nobody printed. Anchored on the printed words,
 * it is handed back instead, and the day the record carries the pair is the
 * day this widens.
 */
const ATTACH_DETACH_CHECK =
  /^A creature can take an action to try to detach the .+? from itself, doing so with a successful DC (\d+) Strength \(Athletics\) check\.$/;

/** SRD Stirge: "The target or a creature within 5 feet of it can detach the stirge as an action." */
const ATTACH_DETACH_ACTION =
  /^The target or a creature within 5 feet of it can detach the .+? as an action\.$/;

/**
 * SRD Stirge: "The stirge can detach itself by spending 5 feet of its
 * movement." SRD Darkmantle writes "On its turn, … by using 5 feet of
 * movement."
 *
 * Read and consumed rather than stored, because it states the rule the engine
 * already applies to every attach: the creature that attached lets go for five
 * feet of its own movement. A line printing a different number would not match
 * and would be handed back, which is the right answer — nothing here could
 * charge it.
 */
const ATTACH_SELF_DETACH =
  /^(?:On its turn, )?[Tt]he .+? can detach itself by (?:spending|using) 5 feet of (?:its )?movement\.$/;

/**
 * The two ways the book writes "this blow took their last hit point".
 *
 * SRD Phase Spider writes it about the damage and SRD Vampire Familiar about
 * the attack; they are one rule, and a reader that took only one of them would
 * hand a whole line to the DM over a preposition.
 */
const REDUCED_TO_ZERO =
  '(?:this damage reduces the target to 0 Hit Points|the target is reduced to 0 Hit Points by this attack)';

/**
 * SRD Phase Spider: "If this damage reduces the target to 0 Hit Points, the
 * target becomes Stable, and it has the Poisoned condition for 1 hour." SRD
 * Vampire Familiar writes "but has" for "and it has" and means the same thing.
 *
 * The condition half is optional because nothing says it has to be there, and
 * the span inside it is not: a condition with no ending is the one shape this
 * reader refuses everywhere else.
 */
const DROPPED_TO_ZERO_STABLE = new RegExp(
  `^If ${REDUCED_TO_ZERO}, the target becomes Stable(?:,? (?:and|but) (?:it )?has the ([A-Za-z]+) condition for (\\d+) (hours?|minutes?))?\\.$`,
);

/** SRD Gibbering Mouther: "The target dies if it is reduced to 0 Hit Points by this attack." */
const DIES_AT_ZERO = /^The target dies if it is reduced to 0 Hit Points by this attack\.$/;

/**
 * SRD Phase Spider: "While Poisoned, the target also has the Paralyzed
 * condition." SRD Vampire Familiar: "While it has the Poisoned condition, the
 * target has the Paralyzed condition."
 *
 * {@link WHILE_GRAPPLED}'s twin, and it is read **after** it rather than in
 * place of it: a grapple is a relation and its implication is filed under the
 * hold, and this one is filed under the condition the clause before it named.
 * The two spellings are the book's; the "also" is not, and it is optional for
 * that reason.
 */
const WHILE_CONDITION =
  /^While (?:it has the )?([A-Za-z]+)(?: condition)?, the target (?:also )?has the ([A-Za-z]+) condition\.$/;

/** The book's two units for a span a hit leaves behind, as the clock counts. */
const SECONDS_IN: Readonly<Record<string, number>> = { hour: 3600, minute: 60 };

/** SRD Bearded Devil's Beard: "Until this poison ends, the target can't regain Hit Points." */
const NO_HEALING_WHILE_IT_LASTS = new RegExp(
  `^Until this [a-z]+ ends, the target can${APOSTROPHE}t regain Hit Points\\.$`,
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

/**
 * What a hold pays out each turn, read off the six captures the two sentences
 * that print one share: the dice, the flat addend, the type, the moment, and
 * the two spellings of whose turn it is.
 *
 * Null where any of them is not something the engine holds — an unknown damage
 * type, or a possessive naming somebody this reader cannot identify. The
 * anchor goes through {@link anchorOf}, which is the same routing a deadline's
 * takes and for the same reason: the Stirge writes its own noun and the Rug
 * writes "its", and a payment collected on the wrong creature's turn is a rule
 * nobody printed.
 */
function payoutOf(parts: readonly (string | undefined)[]): PrintedHoldPayout | null {
  const [dice, flat, word, moment, its, possessive] = parts;
  if (dice === undefined || word === undefined || moment === undefined) return null;
  const type = damageTypeWord(word);
  const onTurnOf = anchorOf(its, possessive);
  if (type === null || onTurnOf === null) return null;
  return {
    dice,
    flat: flat === undefined ? 0 : Number(flat),
    type,
    at: moment === 'start' ? 'start-of-turn' : 'end-of-turn',
    onTurnOf,
  };
}

/**
 * The gate a printed damage clause states, or null where it is not one the
 * engine can answer.
 *
 * The Bloodied half routes its possessive through {@link anchorOf}, which is
 * the same routing a deadline's does and for the same reason: "the target" is
 * the creature that was struck and the block's own noun is the attacker, and a
 * gate read off the wrong creature is a rule nobody printed. A noun that names
 * somebody this reader cannot identify comes back null, exactly as it does for
 * a span.
 */
function damageGateOf(phrase: string): PrintedHitGate | null {
  if (phrase === ADVANTAGE_GATE) return { kind: 'attack-had-advantage' };
  const charged = CHARGE_GATE.exec(phrase);
  if (charged !== null) return { kind: 'charged', feet: Number(charged[1]) };
  if (GRAPPLED_BY_GATE.test(phrase)) return { kind: 'grappled-by-attacker' };
  const bloodied = BLOODIED_GATE.exec(phrase);
  if (bloodied === null) return null;
  // `undefined` for the `its` capture the possessive router takes first: this
  // sentence always writes a noun, and there is no pronoun form of it.
  const who = anchorOf(undefined, bloodied[1]!);
  return who === null ? null : { kind: 'bloodied', who };
}

/** A printed damage-type word, or null where the engine holds no such type. */
function damageTypeWord(word: string): DamageType | null {
  const lowered = word.toLowerCase();
  return DAMAGE_TYPES.find((type) => type === lowered) ?? null;
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
 * - **A damage clause whose gate is not one of the two the engine holds the
 *   fact for.** A Bloodied swarm's and a Goblin's Advantage are read now, as
 *   {@link PrintedDamageRider} — they belong to the damage roll rather than to
 *   an effect list, and the swing reads them where it throws the dice. Every
 *   other gate a line prints is still refused whole.
 * - **A second sentence on a grapple** — the Crocodile's Restrained "until the
 *   grapple ends", the Mimic's Disadvantage on the escape — is one effect
 *   ending with another, which is a lifetime the engine has not got.
 * - **A failure that is not a condition** — the werecreatures' curse, the
 *   Mummy's — has a readable DC and nothing to impose with it. The Bearded
 *   Devil's infernal wound was on this list and is not: its three sentences
 *   are read by `parseRiderSave` into a `wound` clause the printed-save
 *   executor lands, which is the door a rider's save goes through and not
 *   this one's.
 * - **A possessive that names neither creature in the hit** — see
 *   {@link NAMES_NOBODY_IN_THE_HIT}.
 *
 * Every one of those is still carried verbatim and still reported at the hit.
 */
export function readPrintedRider(text: string): PrintedRider | null {
  const read = readClause(text);
  if (read === null || read.kind !== 'riders') return null;
  // Exactly one shape and nothing left over, which is what this reader has
  // always promised. A clause that reads to two riders or leaves a residue is
  // {@link readPrintedRiders}' answer and not this one's.
  return read.handedOver === undefined && read.riders.length === 1 ? read.riders[0]! : null;
}

/**
 * What one clause reads to: riders, or one of the two sentences that are about
 * the sentence before them.
 *
 * The last two are not {@link PrintedRider}s and must not become ones. "While
 * Grappled, the target has the Restrained condition" and "Until this poison
 * ends, the target can't regain Hit Points" each name a lifetime borrowed from
 * a clause that has already been read; standing alone they say nothing, and a
 * rider that had to be looked up to be understood is a rider the swing could
 * apply to nobody.
 */
type ClauseRead =
  | {
      readonly kind: 'riders';
      readonly riders: readonly PrintedRider[];
      /** The part of this clause the engine read nothing out of. */
      readonly handedOver?: string;
    }
  | {
      readonly kind: 'while-held';
      readonly conditions: readonly ConditionName[];
      /** SRD's "and takes 10 (2d6 + 3) Bludgeoning damage at the start of each of its turns". */
      readonly payout?: PrintedHoldPayout;
      readonly handedOver?: string;
    }
  /**
   * "While Poisoned, the target also has the Paralyzed condition" — the same
   * borrowed lifetime one clause along, and it borrows it from a *condition*
   * rather than from a hold. It names which condition, because the clause
   * before it may have imposed more than one and a reader that guessed would
   * file the Paralyzed under whichever happened to be first.
   */
  | {
      readonly kind: 'while-condition';
      readonly condition: ConditionName;
      readonly implies: ConditionName;
    }
  /**
   * One more sentence about the attach before it — the cover, the Speed, the
   * check, the action, the payment. Every block that prints an attach prints
   * four or five of these, and none of them means anything without the first:
   * an attach detail standing alone names a hold that is not there.
   */
  | {
      readonly kind: 'attach-detail';
      readonly detail: Partial<Omit<PrintedAttachRider, 'kind'>>;
      readonly handedOver?: string;
    }
  /**
   * "The armor is destroyed if the penalty reduces its AC to 10" — a sentence
   * about the sentence before it, and the rule the swing already keeps. Its
   * own member rather than an empty rider list, for `attach-detail`'s reason:
   * standing alone it names a penalty that is not there, and a reader that
   * swallowed it anywhere would consume it off a line that never wrote one.
   */
  | { readonly kind: 'armor-detail' }
  /**
   * "The target dies if this reduces that score to 0" — a sentence about the
   * drain before it, stating the rule the swing keeps, and stored nowhere for
   * the reason `armor-detail` is not: see {@link DIES_AT_ZERO_SCORE}.
   */
  | { readonly kind: 'drain-detail' }
  | { readonly kind: 'no-healing' };

/** One rider and no residue, which is what most clauses read to. */
const one = (rider: PrintedRider): ClauseRead => ({ kind: 'riders', riders: [rider] });

/**
 * The structure **one clause** states, or null for everything else.
 *
 * Null is the guard rather than a gap, and what is left on the list of
 * refusals is worth naming because each is a mechanism rather than a wording:
 *
 * - **A failure that is not a condition** — the werecreatures' curse, the
 *   Mummy's — has a readable DC and nothing to impose with it. The Bearded
 *   Devil's infernal wound was on this list and is not: its three sentences
 *   are read by `parseRiderSave` into a `wound` clause the printed-save
 *   executor lands, which is the door a rider's save goes through and not
 *   this one's.
 * - **A graded save on a hit** — the Cockatrice's second rung of failure, the
 *   Death Dog's repeat every 24 hours — is a vocabulary the spell side is
 *   building first.
 * - **A possessive that names neither creature in the hit** — see
 *   {@link NAMES_NOBODY_IN_THE_HIT}.
 * - **A fact only the GM holds** — SRD Half-Dragon's "damage of the type
 *   chosen for the Draconic Origin trait", where the trait the type is on says
 *   "(GM's choice)" and the parser kept nothing structured of it. There is no
 *   record to read, so the whole clause is the table's.
 *
 * Every one of those is still carried verbatim and still reported at the hit —
 * now clause by clause rather than a line at a time.
 */
function readClause(text: string): ClauseRead | null {
  // First, because it is the one shape that opens with the book's connective
  // rather than with a gate, so no other pattern can claim it.
  const amount = PRINTED_DAMAGE.exec(text);
  if (amount !== null) {
    // **An absent type word is the book declining to name one**: SRD
    // Half-Dragon's Claw deals "7 (2d6) damage of the type chosen for the
    // Draconic Origin trait", and that trait ends "(GM's choice)". The amount
    // is read and the type stays the table's, which is what
    // {@link DECLARED_DAMAGE_TYPE} is a word for — the swing asks for it and
    // will not roll until somebody has answered.
    const declared = amount[4] === undefined;
    const type = declared ? DECLARED_DAMAGE_TYPE : damageTypeWord(amount[4]!);
    if (type === null) return null;
    // **And an absent connective belongs to that same line and no other.** The
    // attack parser's damage chain eats the "plus" that introduced a component
    // and then stops on the type it cannot read, so the clause arrives here
    // without the book's own word in front of it. Every other rider the book
    // prints keeps its connective, and a sentence that lost one would be a
    // clause this reader had no business guessing the polarity of.
    if (amount[1] === undefined && !declared) return null;
    const how = amount[1] === 'or' ? 'instead' : 'extra';
    // "or N damage" with nothing to condition it on would be a line that
    // always rolled its alternative, which is not a sentence the book writes.
    if (amount[5] === undefined && how === 'instead') return null;
    const when = amount[5] === undefined ? undefined : damageGateOf(amount[5]);
    if (when === null) return null;
    return one({
      kind: 'damage',
      how,
      dice: amount[2]!,
      flat: amount[3] === undefined ? 0 : Number(amount[3]),
      type,
      ...(when === undefined ? {} : { when }),
    });
  }

  // The charge, which is the one printed sentence that reads to two riders:
  // an extra die and a condition behind one gate. Before the plain gated
  // condition, because its opening words are that pattern's.
  const charged = CHARGED_HIT.exec(text);
  if (charged !== null) {
    const size = sizeWord(charged[1]!);
    const conditions = conditionsOf(charged[6]!, undefined);
    if (size === null || conditions === null) return null;
    const when = { kind: 'charged', feet: Number(charged[2]) } as const;
    const riders: PrintedRider[] = [];
    if (charged[3] !== undefined) {
      const type = damageTypeWord(charged[5]!);
      if (type === null) return null;
      riders.push({
        kind: 'damage',
        how: 'extra',
        dice: charged[3],
        flat: charged[4] === undefined ? 0 : Number(charged[4]),
        type,
        ifNoLargerThan: size,
        when,
      });
    }
    riders.push({ kind: 'condition', conditions, ifNoLargerThan: size, when });
    return {
      kind: 'riders',
      riders,
      // SRD Allosaurus: "and the allosaurus can make one Bite attack against
      // it." An attack the engine does not grant, handed back rather than
      // dropped along with the charge it rides on.
      ...(charged[7] === undefined ? {} : { handedOver: charged[7] }),
    };
  }

  const shove = PRINTED_SHOVE.exec(text);
  if (shove !== null) {
    const size = sizeWord(shove[1]!);
    if (size === null) return null;
    return one({
      kind: 'forced-move',
      direction: shove[3] === 'toward' ? 'pull' : 'push',
      feet: Number(shove[2]),
      ifNoLargerThan: size,
    });
  }

  const slowed = PRINTED_SPEED_CUT.exec(text);
  if (slowed !== null) {
    const span = spanRead(slowed[2], slowed[3], slowed[4]);
    if (span?.lasts === undefined || span.lastsOn === undefined) return null;
    return one({
      kind: 'speed-cut',
      feet: Number(slowed[1]),
      lasts: span.lasts,
      lastsOn: span.lastsOn,
    });
  }

  if (PRINTED_MAXIMUM.test(text)) return one({ kind: 'hit-point-maximum' });

  if (STARTS_BURNING.test(text)) return one({ kind: 'hazard', hazard: 'burning' });

  const corroded = PRINTED_ARMOR_PENALTY.exec(text);
  if (corroded !== null) return one({ kind: 'armor-penalty', points: Number(corroded[1]) });

  if (ARMOR_DESTROYED_AT_TEN.test(text)) return { kind: 'armor-detail' };

  // SRD Shadow: the drain, and the sentence about it that states the rule the
  // swing keeps.
  const drained = PRINTED_ABILITY_DRAIN.exec(text);
  if (drained !== null) {
    const ability = abilityWord(drained[1]!);
    if (ability === null) return null;
    return one({ kind: 'ability-score-decrease', ability, dice: drained[2]! });
  }
  if (DIES_AT_ZERO_SCORE.test(text)) return { kind: 'drain-detail' };

  const ownRoll = PRINTED_MODE_ON_TARGET.exec(text);
  if (ownRoll !== null) {
    const span = spanRead(ownRoll[2], ownRoll[3], ownRoll[4]);
    if (span?.lasts === undefined || span.lastsOn === undefined) return null;
    return one({
      kind: 'roll-mode',
      mode: ownRoll[1] === 'Advantage' ? 'advantage' : 'disadvantage',
      relation: 'roller',
      lasts: span.lasts,
      lastsOn: span.lastsOn,
    });
  }

  const atThem = PRINTED_MODE_AGAINST_TARGET.exec(text);
  if (atThem !== null) {
    const span = spanRead(atThem[1], atThem[2], atThem[3]);
    if (span?.lasts === undefined || span.lastsOn === undefined) return null;
    return one({
      kind: 'roll-mode',
      mode: atThem[4] === 'Advantage' ? 'advantage' : 'disadvantage',
      relation: 'against-holder',
      lasts: span.lasts,
      lastsOn: span.lastsOn,
    });
  }

  // The attach and its details, before the condition shapes: the first
  // sentence opens with the book's "and the", which nothing else here claims,
  // and each detail is anchored on wording no other pattern matches.
  if (PRINTED_ATTACH.test(text)) return one({ kind: 'attach' });

  const drinks = WHILE_ATTACHED_PAYS.exec(text);
  if (drinks !== null) {
    const payout = payoutOf(drinks.slice(2));
    if (payout === null) return null;
    return {
      kind: 'attach-detail',
      detail: { payout },
      ...(drinks[1] === undefined ? {} : { handedOver: drinks[1] }),
    };
  }

  const covers = ATTACH_COVERS.exec(text);
  if (covers !== null) {
    const size = sizeWord(covers[1]!);
    const conditions = conditionsOf(covers[2]!, undefined);
    if (size === null || conditions === null) return null;
    return {
      kind: 'attach-detail',
      detail: {
        covers: { conditions, ifNoLargerThan: size, ifAttackHadAdvantage: true },
      },
      // SRD's "and is suffocating": a rule about breath, and nothing here
      // drowns. Handed back rather than dropped with the Blinded it rides on.
      ...(covers[3] === undefined ? {} : { handedOver: covers[3] }),
    };
  }

  const pinned = ATTACHED_SPEED_ZERO.exec(text);
  if (pinned !== null) {
    return {
      kind: 'attach-detail',
      detail: { holderSpeedBecomesZero: true },
      // "it can't benefit from any bonus to its Speed, and it moves with the
      // target": a floor under a Speed the engine has no way to state, and a
      // position that follows another creature's. Both the table's.
      ...(pinned[1] === undefined ? {} : { handedOver: pinned[1] }),
    };
  }

  const checked = ATTACH_DETACH_CHECK.exec(text);
  if (checked !== null) {
    return { kind: 'attach-detail', detail: { detachDc: Number(checked[1]) } };
  }

  // The two sentences that state what this engine already does with an attach:
  // somebody spends an Action to pull it off, and the creature that attached
  // lets go for five feet. Read and consumed, so they are not reported as
  // sentences nobody applied.
  if (ATTACH_DETACH_ACTION.test(text) || ATTACH_SELF_DETACH.test(text)) {
    return { kind: 'attach-detail', detail: {} };
  }

  const smothered = UNTIL_THE_GRAPPLE_ENDS.exec(text);
  if (smothered !== null) {
    // Read through a door of its own rather than through `conditionWord`,
    // exactly as `WHILE_GRAPPLED` is and for the same reason: what that guard
    // refuses is a Restrained filed under a rider's own source.
    const named = [smothered[1], smothered[2]]
      .filter((word): word is string => word !== undefined)
      .map((word) => CONDITIONS.find((name) => name === word.toLowerCase()));
    const payout = payoutOf(smothered.slice(4));
    if (payout === null || named.some((name) => name === undefined)) return null;
    return {
      kind: 'while-held',
      conditions: named as readonly ConditionName[],
      payout,
      ...(smothered[3] === undefined ? {} : { handedOver: smothered[3] }),
    };
  }

  const held = WHILE_GRAPPLED.exec(text);
  if (held !== null) {
    // Read through a door of its own rather than through `conditionWord`,
    // which refuses Restrained by name: what that guard refuses is a
    // Restrained filed under a rider's own source, and this one is filed under
    // the grapple and ends with it. See `NOT_A_PLAIN_CONDITION`.
    const lowered = held[1]!.toLowerCase();
    const condition = CONDITIONS.find((name) => name === lowered);
    if (condition === undefined) return null;
    return {
      kind: 'while-held',
      conditions: [condition],
      ...(held[2] === undefined ? {} : { handedOver: held[2] }),
    };
  }

  // After the grapple's own implication, which is a relation's, and before the
  // plain condition shapes, whose openings this cannot be mistaken for.
  const alongside = WHILE_CONDITION.exec(text);
  if (alongside !== null) {
    const host = conditionWord(alongside[1]!);
    const carried = conditionWord(alongside[2]!);
    if (host === null || carried === null) return null;
    return { kind: 'while-condition', condition: host, implies: carried };
  }

  const emptied = DROPPED_TO_ZERO_STABLE.exec(text);
  if (emptied !== null) {
    if (emptied[1] === undefined) return one({ kind: 'on-dropping-to-zero', stable: true });
    const condition = conditionWord(emptied[1]);
    const unit = SECONDS_IN[emptied[3]!.replace(/s$/, '')];
    if (condition === null || unit === undefined) return null;
    return one({
      kind: 'on-dropping-to-zero',
      stable: true,
      conditions: [{ condition, lastsSeconds: Number(emptied[2]) * unit }],
    });
  }

  if (DIES_AT_ZERO.test(text)) return one({ kind: 'on-dropping-to-zero', dies: true });

  if (NO_HEALING_WHILE_IT_LASTS.test(text)) return { kind: 'no-healing' };

  const offered = PRINTED_GRAPPLE_OFFERED.exec(text);
  if (offered !== null) {
    const size = sizeWord(offered[1]!);
    if (size === null) return null;
    return one({
      kind: 'grapple',
      escapeDc: Number(offered[2]),
      ifNoLargerThan: size,
      insteadOfDamage: true,
    });
  }

  const grapple = PRINTED_GRAPPLE.exec(text);
  if (grapple !== null) {
    const size = sizeWord(grapple[1]!);
    if (size === null) return null;
    return one({
      kind: 'grapple',
      escapeDc: Number(grapple[2]),
      ifNoLargerThan: size,
      ...(grapple[3] === undefined ? {} : { withLimbs: grapple[3] }),
    });
  }

  const gated = GATED_CONDITION.exec(text);
  if (gated !== null) {
    const size = sizeWord(gated[1]!);
    const conditions = conditionsOf(gated[2]!, gated[3]);
    if (size === null || conditions === null) return null;
    return one({ kind: 'condition', conditions, ifNoLargerThan: size });
  }

  const anchored = ANCHORED_CONDITION.exec(text);
  if (anchored !== null) {
    const conditions = conditionsOf(anchored[1]!, anchored[2]);
    const span = spanRead(anchored[3], anchored[4], anchored[5]);
    if (conditions === null || span === null) return null;
    return one({ kind: 'condition', conditions, ...span });
  }

  const saved = PRINTED_SAVE.exec(text);
  if (saved !== null) {
    const gate = gateOf(saved[1]!);
    const ability = abilityWord(saved[2]!);
    const conditions = conditionsOf(saved[4]!, saved[5]);
    const span = spanRead(saved[6], saved[7], saved[8]);
    if (gate === null || ability === null || conditions === null || span === null) return null;
    return one({
      kind: 'condition',
      conditions,
      ...gate,
      save: { ability, dc: Number(saved[3]) },
      ...span,
    });
  }

  return null;
}

/** What {@link readPrintedRiders} came to: what it applies, and what it owes. */
export interface PrintedRidersRead {
  readonly riders: readonly PrintedRider[];
  /** The clauses the engine read nothing out of, in the book's own words. */
  readonly handedOver: readonly string[];
}

/**
 * The sentences a printed rider is joined out of, in printed order.
 *
 * A full stop followed by a space, and an **em dash**, which is the book's
 * other joiner: SRD Swarm of Venomous Snakes writes "or 6 (1d4 + 4) Piercing
 * damage if the swarm is Bloodied—plus 10 (3d6) Poison damage." Each fragment
 * is given back the full stop the split took off it — or the one the dash
 * never gave it — so every pattern here can go on anchoring at one.
 */
function clausesOf(text: string): readonly string[] {
  return text
    .split(/(?<=\.)\s+/)
    .flatMap((sentence) => sentence.split('—'))
    // **The em space the book's own paragraphs are separated by**, taken off
    // the front of a clause rather than left on it. It is typography and not a
    // word: the transcription writes `&emsp;` where the page breaks a stat
    // block's line into paragraphs, and a clause carrying one matched no
    // pattern and was handed to the DM over a space — which is how SRD
    // Darkmantle's escape DC and SRD Stirge's five-foot detach were both
    // reported as prose while the sentences either side of them were read.
    .map((clause) => clause.replace(/^(?:&emsp;|\s)+/, ''))
    .map((clause) => clause.trim())
    .filter((clause) => clause.length > 0)
    .map((clause) => (clause.endsWith('.') ? clause : `${clause}.`));
}

/**
 * **Everything a printed rider says**, as what the engine applies and what it
 * hands back.
 *
 * {@link readPrintedRider} reads one shape or nothing, and "or nothing" was
 * doing more work than it should: SRD Swarm of Crawling Claws prints a smaller
 * bite *and* a Prone, SRD Crocodile a grapple *and* the Restrained that goes
 * with it, and each was handed to the DM entire — including the half the
 * engine had been executing for a year on the lines that printed it alone.
 *
 * So the line is read clause by clause, each against the shapes it knows, and
 * the rest is carried back verbatim. That is exactly `parsePrintedSave`'s
 * `handedOver` on the other half of the sheet, and it is read the same way:
 * **a residue means the line is still unpaid.** The ledger counts it under
 * `RIDER_HANDOVER_SHAPE`, beside the lines nothing at all was read from,
 * because learning to recognise three quarters of a sentence must never be
 * able to retire a debt.
 *
 * The whole line is tried as one clause first, because one shape spans three
 * sentences — {@link PRINTED_SAVE}, whose gate, saving throw and failure are a
 * single rule — and splitting it would read its DC as prose.
 *
 * **Two clauses are about the clause before them** and are folded into it
 * rather than standing alone: "While Grappled, the target has the Restrained
 * condition" borrows the grapple's lifetime, and "Until this poison ends, the
 * target can't regain Hit Points" borrows the condition's. Either one arriving
 * with nothing in front of it is handed back, because it then names a lifetime
 * that is not there.
 */
export function readPrintedRiders(text: string): PrintedRidersRead {
  const whole = readClause(text);
  if (whole !== null && whole.kind === 'riders' && whole.handedOver === undefined) {
    return { riders: whole.riders, handedOver: [] };
  }

  const riders: PrintedRider[] = [];
  const handedOver: string[] = [];

  for (const clause of clausesOf(text)) {
    const read = readClause(clause);
    if (read === null) {
      handedOver.push(clause);
      continue;
    }

    if (read.kind === 'while-held') {
      const host = riders.at(-1);
      if (host === undefined || host.kind !== 'grapple') {
        handedOver.push(clause);
        continue;
      }
      riders[riders.length - 1] = {
        ...host,
        whileHeld: read.conditions,
        ...(read.payout === undefined ? {} : { payout: read.payout }),
      };
      if (read.handedOver !== undefined) handedOver.push(read.handedOver);
      continue;
    }

    if (read.kind === 'attach-detail') {
      const host = riders.at(-1);
      // An attach detail with no attach in front of it names a hold that is
      // not there — the rule "While Grappled" keeps one case above.
      if (host === undefined || host.kind !== 'attach') {
        handedOver.push(clause);
        continue;
      }
      riders[riders.length - 1] = { ...host, ...read.detail };
      if (read.handedOver !== undefined) handedOver.push(read.handedOver);
      continue;
    }

    if (read.kind === 'while-condition') {
      const host = riders.at(-1);
      // The condition it names has to be one the clause before it actually
      // imposed. A sentence about some other condition names a lifetime that
      // is not there, which is the same refusal a while-held clause with
      // nothing in front of it gets.
      const carrier =
        host?.kind === 'on-dropping-to-zero'
          ? (host.conditions ?? []).find((one) => one.condition === read.condition)
          : undefined;
      if (host === undefined || host.kind !== 'on-dropping-to-zero' || carrier === undefined) {
        handedOver.push(clause);
        continue;
      }
      riders[riders.length - 1] = {
        ...host,
        conditions: (host.conditions ?? []).map((held) =>
          held === carrier ? { ...held, implies: [...(held.implies ?? []), read.implies] } : held,
        ),
      };
      continue;
    }

    if (read.kind === 'armor-detail') {
      const host = riders.at(-1);
      // The ceiling belongs to the penalty before it, and the swing already
      // keeps it. Nothing is stored; a clause with no penalty in front of it
      // names a rule about nothing, and it goes back to the table.
      if (host === undefined || host.kind !== 'armor-penalty') handedOver.push(clause);
      continue;
    }

    if (read.kind === 'drain-detail') {
      const host = riders.at(-1);
      // The death belongs to the drain before it, and the swing already keeps
      // it — the same reading the armour's ceiling gets one clause up.
      if (host === undefined || host.kind !== 'ability-score-decrease') handedOver.push(clause);
      continue;
    }

    if (read.kind === 'no-healing') {
      const host = riders.at(-1);
      if (host === undefined || host.kind !== 'condition') {
        handedOver.push(clause);
        continue;
      }
      riders[riders.length - 1] = { ...host, preventsHealing: true };
      continue;
    }

    riders.push(...read.riders);
    if (read.handedOver !== undefined) handedOver.push(read.handedOver);
  }

  return { riders, handedOver };
}
