/**
 * The tools a human DM has and a model does not.
 *
 * ## The rule that decided what is here
 *
 * Step one's rule was *"a tool is on this surface only if the caller supplies
 * no mechanically authoritative number through it"*, and it excluded more than
 * it let in. Every exclusion it recorded was of one of two kinds, and only one
 * of them is about the model:
 *
 * | Excluded because | Example | Is it here? |
 * |---|---|---|
 * | it states a **decision the rules leave open**, which is the DM's | a DC, the damage a falling chandelier does, how long a ruling lasts | **yes** — that is this file |
 * | it states an **outcome the rules decide**, which is nobody's | `recordExternalD20`, `recordExternalDamage`, `recordD20Test`, `setExhaustionLevel` | **no**, and `boundary.test.ts` here proves the first two unreachable |
 *
 * The doctrine's division of authority is the whole of that table: the Engine
 * owns "established mechanical truth: rules, deterministic resolution,
 * resources, modifiers, positions, conditions, timing"; the DM owns "DCs and
 * rulings where the rules do not determine an answer, and adjudication of
 * novel actions". A DC is not a roll. An improvised amount is not a die. Ten
 * minutes is not a Deadline — the engine still converts it against its own
 * clock and can still refuse.
 *
 * **What is still not here, and never will be.** No tool takes the number a
 * die showed. A DM with physical dice on the table is a real thing the engine
 * has functions for (`recordExternalD20`, `recordExternalDamage`), and they
 * are not tools: they stamp a roll as the engine's own, and a surface is not
 * the place to hand that authority out. A DM who wants the engine's die asks
 * for it; a DM who wants their own rolls them and adjudicates an *amount*,
 * which is `improvised_damage`.
 *
 * ## What the slice covers
 *
 * The three things step one's digest named as missing, the settlement one of
 * them owes, and the three step one could not build:
 *
 * - `ability_check` — a check against a DC the table decided.
 * - `saving_throw` — the same, for a save the rules did not call for. One
 *   field on `resolveTest` and two tools on this surface; see its own note.
 * - `settle_test` — because either can open a Reaction window, and a window
 *   nobody closes wedges every other command. A missing settlement is worse
 *   than a missing mechanic: the game stops rather than the action being
 *   refused.
 * - `improvised_damage` — the chandelier nobody has statted, at an amount the
 *   DM decided.
 * - `roll_improvised_damage` — the same chandelier with the dice still to
 *   throw, which is the one thing step one **could not** ship: a surface
 *   cannot roll, because a roll id and a `rolls-issued` event are a command's
 *   to issue. `rollImprovisedDamage` is now that command.
 * - `rule_condition` / `end_condition` — a ruled condition, for a span of time
 *   only a DM may state, and the ruling ended when the DM says it is over.
 *
 * And, added since: the two halves of a stat block nothing on either surface
 * could spend.
 *
 * - `take_printed_action` / `take_printed_bonus_action` — the Actions lines
 *   that are not attacks, and the printed Bonus Actions. The engine's two
 *   commands have been finished and barrelled for as long as the recharge
 *   ledger has existed and **neither surface imported either of them**, so
 *   every breath weapon and every printed Bonus Action in the book was a
 *   heading a caller could read and could not take. They are *here* rather
 *   than on the model's door because a successful call applies nothing: the
 *   whole result is the spend and the block's own sentence handed back
 *   unapplied, and adjudicating that sentence is the DM's in the same way the
 *   DC in `saving_throw` is. See {@link TAKE_PRINTED_ACTION}.
 *
 * And `advantage` / `disadvantage` on both of the D20 tools, which is not a
 * tool but is the third thing step one wanted: `TestCommand.modes` existed
 * and nothing offered it. They are fields whose *value is the reason*, so a
 * mode cannot arrive unattributed — see {@link ADVANTAGE_FIELDS}.
 *
 * ## Why this is a directory and not a flag
 *
 * `boundary.test.ts` beside this file walks the imports out of the model's
 * `surface.ts` and asserts that no file under `dm/` is reachable from any of
 * them. That is a claim a directory can carry and a boolean cannot.
 */

import type { ConditionName } from '@ie/shared';
import type { Duration, ModeSource, TestResolution } from '@ie/engine';
import {
  applyConditionTo,
  awardItems,
  changeCoins,
  COPPER_PER,
  declareCreatureHeads,
  liftConditionFrom,
  loseItems,
  resolveDamage,
  resolveTest,
  rollImprovisedDamage,
  settleTest,
  takeStatedAction,
  takeStatedBonusAction,
} from '@ie/engine';
import { z } from 'zod';
import {
  identity,
  ruled,
  senses,
  settle,
  settleEvents,
  type ToolContext,
  type ToolDefinition,
  tool,
  TOOLS,
  who,
} from '../definitions.js';
import {
  abilitySchema,
  conditionDurationSchema,
  conditionSchema,
  creatureId,
  damageTypeSchema,
  printedLineName,
  sensesFields,
  skillSchema,
} from '../schemas.js';

/**
 * A Difficulty Class, which is the DM's to set and nobody else's.
 *
 * An integer and at least 1. There is no upper bound, because the SRD prints
 * none and a DC of 30 is a sentence a DM is allowed to say; the engine
 * validates it as a number and the roll decides the rest.
 */
const difficultyClass = z
  .int()
  .min(1)
  .describe('The Difficulty Class you have set for this attempt. Yours, not the engine’s.');

/** Why, in the DM's own words. Recorded, so the log says it was adjudicated. */
const ruling = (what: string) =>
  z.string().min(1).describe(`Why, in one phrase. Recorded in the log as ${what}.`);

/**
 * Advantage and Disadvantage, as two fields whose *value is the reason*.
 *
 * The engine's D20 pipeline does not carry a flag; it carries a `ModeSource`,
 * which is a mode **and who granted it**, and it keeps sources that cancelled
 * so a roll that came out normal can still say why. Publishing a boolean would
 * throw that half away at the door and record "situational" — the placeholder
 * `checks.ts` invents for a caller who gave no name.
 *
 * So the reason is not a field beside the mode, it *is* the field. There is
 * no way to grant Advantage through this surface without saying why, and no
 * second spelling of it to keep in step. Both may be sent at once: SRD has
 * them cancel rather than stack, the engine does that and records both, and
 * a table that ruled twice should read as a table that ruled twice.
 */
const ADVANTAGE_FIELDS = {
  advantage: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Grant Advantage, and say why in one phrase — "she has the high ground". The words are recorded as the source of it. Omit the field for a roll you have not ruled on.',
    ),
  disadvantage: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Impose Disadvantage, and say why in one phrase — "the footing is treacherous". Recorded the same way. Sending both cancels them, and the log still names each.',
    ),
};

/**
 * The caller's two phrases, in the engine's attributed vocabulary.
 *
 * **The mode is part of the source, and that is load-bearing rather than
 * decorative.** A `ModeSource`'s `source` is an *identity* wherever the
 * engine deduplicates: `savingSupport` keys named modes in a `Map` by it, so
 * that a caller who also knows about Danger Sense cannot apply it twice.
 * Two rulings a DM happened to spell the same way ("the smoke", for both)
 * would otherwise be one identity, and the saving throw would drop one of
 * them. Prefixing the mode makes the two phrases two identities, so both
 * cancel and both are recorded.
 *
 * **The seam beneath has since converged**: `resolveTest`'s two branches
 * both merge through one rule, where the check used to concatenate and only
 * the save merged. So this prefix is no longer the thing standing between a
 * DM and a dropped ruling — it is the reason the two phrases differ at all,
 * which the merge then keeps.
 *
 * Built through {@link ruled} rather than beside it so the prefix a reader
 * looks for has one spelling in this package.
 */
const ruledModes = (args: {
  readonly advantage?: string | undefined;
  readonly disadvantage?: string | undefined;
}): readonly ModeSource[] => [
  ...(args.advantage === undefined
    ? []
    : [{ source: ruled(`Advantage — ${args.advantage}`), mode: 'advantage' as const }]),
  ...(args.disadvantage === undefined
    ? []
    : [{ source: ruled(`Disadvantage — ${args.disadvantage}`), mode: 'disadvantage' as const }]),
];

/**
 * What a D20 Test answers with, for both of the tools that ask for one.
 *
 * `mode`, `modeSources` and `rolls` are the roll's **own record** rather than
 * its result: how many dice were thrown, which way they were read, and who
 * said so. Without them a DM's ruling would be invisible on the wire — the
 * only trace of a granted Advantage would be a total that happened to be
 * higher, which is indistinguishable from a good die.
 *
 * **`roll-recorded` carries them too**, so a ruling is auditable from the
 * log alone rather than only from this answer: the event gained an optional
 * `modes`, filled from the test's own `modeSources` and omitted when nobody
 * ruled. What is still true is that most emitters do not fill it — an attack
 * roll and an Initiative roll can each carry Advantage and neither says so —
 * so the field's absence means two things until they do.
 */
const testResolution = (
  value: TestResolution,
  dc: number,
): Readonly<Record<string, unknown>> => ({
  natural: value.test?.natural ?? null,
  total: value.test?.total ?? null,
  success: value.test?.success ?? null,
  dc,
  mode: value.test?.mode ?? null,
  modeSources: value.test?.modeSources.map((m) => ({ source: m.source, mode: m.mode })) ?? [],
  rolls: value.test?.rolls ?? [],
  ...(value.offers.length === 0 ? {} : { mayAnswer: value.offers.map((o) => o.reactor) }),
  duplicate: value.duplicate,
});

/**
 * Ask a creature to make an ability check against a DC the table set.
 *
 * The engine had `rollAbilityCheck` complete and correct and reachable from
 * no command for a long time, and then `resolveTest`; what it has never had
 * is a *door*, because the door takes a DC. Everything else is derived: the
 * modifier, proficiency, Expertise, the armour penalty, the roller's
 * conditions and the automatic failures they impose, Exhaustion, and every
 * bonus a feature or a running spell has put on this creature.
 *
 * `requiresSight` and `requiresHearing` are facts about the *attempt* rather
 * than about the result — SRD Blinded "automatically fails an ability check
 * that requires sight", and only the table knows whether reading an
 * inscription does and shoving a door does not.
 */
const ABILITY_CHECK = tool({
  name: 'ability_check',
  description:
    'Ask a creature for an ability check against a Difficulty Class you have set. You choose the ability, the skill if one applies, and the DC; the engine supplies the modifier, proficiency, Expertise, conditions and every standing bonus, throws the die and decides the outcome. Give `advantage` or `disadvantage` a phrase to rule one on, and the log records who said so. It does not take a roll — if you rolled physical dice, this is not the tool.',
  mutates: true,
  input: z.strictObject({
    who: creatureId,
    ability: abilitySchema,
    skill: skillSchema.optional().describe('The skill, where one applies. Omit for a raw check.'),
    dc: difficultyClass,
    because: z
      .string()
      .min(1)
      .optional()
      .describe('What the check is for, in one phrase: "swinging from the chandelier".'),
    ...sensesFields,
    ...ADVANTAGE_FIELDS,
  }),
  run: (context, args) => {
    const modes = ruledModes(args);
    return settle(
      context,
      resolveTest(
        context.campaign.state(),
        who(args.who),
        {
          kind: 'ability-check',
          ability: args.ability,
          dc: args.dc,
          ...(args.skill === undefined ? {} : { skill: args.skill }),
          ...(args.because === undefined ? {} : { label: args.because }),
          ...(modes.length === 0 ? {} : { modes }),
          ...senses(args),
          ...identity(context),
        },
        context.campaign.supply(),
      ),
      (value) => value.events,
      (value) => testResolution(value, args.dc),
      (value) => value.unverified,
    );
  },
});

/**
 * Ask a creature for a saving throw against a DC the table set.
 *
 * **Step one's digest said this was one field on `resolveTest`, and on the
 * engine it is.** `TestCommand.kind` is the whole of the difference, and the
 * save branch gathers everything the check branch does — the ability's save
 * modifier, proficiency where the class table grants it, Bless, an Aura of
 * Protection, the conditions that give Disadvantage or fail the save outright.
 *
 * It is a second **tool** rather than a `kind` on the first one, because the
 * other two fields of `ability_check` are not one field's worth of difference:
 * `rollSavingThrow` takes no skill at all, and the senses an attempt leans on
 * are read only by the check branch — SRD writes "automatically fails an
 * **ability check** that requires sight". A single tool would accept both
 * beside `kind: 'saving-throw'` and drop them in silence, which is exactly the
 * failure the fourth outcome exists to prevent: a caller told nothing, acting
 * on a roll that ignored what they said. Two tools, each with the fields its
 * own branch reads.
 *
 * What it is **not** is a door for a save the rules already owe. A spell's
 * save is rolled by the casting, a turn boundary's by `end_turn`, and a
 * Concentration save by the damage that put it at risk. This is the save
 * nothing in the book called for and the table did.
 */
const SAVING_THROW = tool({
  name: 'saving_throw',
  description:
    'Ask a creature for a saving throw against a Difficulty Class you have set — the pit trap, the rockfall, the sickening smell. You choose the ability and the DC; the engine supplies the save modifier, proficiency, conditions and every standing bonus, throws the die and decides the outcome. Give `advantage` or `disadvantage` a phrase to rule one on. A save a spell or a turn boundary already owes is rolled by the command that owes it, not here.',
  mutates: true,
  input: z.strictObject({
    who: creatureId,
    ability: abilitySchema,
    dc: difficultyClass,
    because: z
      .string()
      .min(1)
      .optional()
      .describe('What the save is against, in one phrase: "the pit trap closing".'),
    ...ADVANTAGE_FIELDS,
  }),
  run: (context, args) => {
    const modes = ruledModes(args);
    return settle(
      context,
      resolveTest(
        context.campaign.state(),
        who(args.who),
        {
          kind: 'saving-throw',
          ability: args.ability,
          dc: args.dc,
          ...(args.because === undefined ? {} : { label: args.because }),
          ...(modes.length === 0 ? {} : { modes }),
          ...identity(context),
        },
        context.campaign.supply(),
      ),
      (value) => value.events,
      (value) => testResolution(value, args.dc),
      (value) => value.unverified,
    );
  },
});

/**
 * Close a D20 Test that somebody may push.
 *
 * SRD Dark One's Own Luck names the window in one clause — "after seeing the
 * roll but before any of the roll's effects occur" — and with anybody
 * eligible, `resolveTest` holds the result open and every other command
 * refuses until it is settled. Shipping the check without this would ship the
 * deadlock: a missing settlement stops the game, where a missing mechanic only
 * refuses an action.
 *
 * Settling changes nothing by itself. A standalone test's consequence belongs
 * to whoever asked for it; the engine owns the number.
 */
const SETTLE_TEST = tool({
  name: 'settle_test',
  description:
    'Close a D20 Test that is being held open for a Reaction nobody has taken. `look` reports one under `owed.pendingTest`; until it is settled every other command refuses, so settle it as soon as nobody wants the window.',
  mutates: true,
  input: z.strictObject({}),
  run: (context) =>
    settle(
      context,
      settleTest(context.campaign.state(), identity(context)),
      (value) => value.events,
      (value) => ({ settled: value.test !== null, duplicate: value.duplicate }),
    ),
});

/**
 * Damage from something nobody has statted.
 *
 * The falling chandelier, the collapsing floor, the boiling pitch. There is
 * no creature to attack with and no spell to cast, and the doctrine is
 * explicit that refusing it "protects nothing" — so the DM adjudicates the
 * **amount**, and the engine does everything that follows from it: Temporary
 * Hit Points absorbed first, dropping to 0 and the Unconscious that comes
 * with it, death, and the Concentration save the damage put at risk.
 *
 * **The amount is not a roll**, and it is not a *kind* of damage either. It
 * goes to the hit points as stated: Resistance, Vulnerability and Immunity
 * are all per type, and a number with no type is a number no defence can
 * meet. That is the honest reading of a DM who has already decided how much
 * it hurt — and it is why {@link ROLL_IMPROVISED_DAMAGE} sits beside this
 * one rather than replacing it. A DM who wants the engine to measure says
 * "4d6 Fire" and calls that; a DM who wants ten, flat, says so here.
 */
const IMPROVISED_DAMAGE = tool({
  name: 'improvised_damage',
  description:
    'Deal damage from something the rules do not model — a falling chandelier, a collapsing floor, a trap nobody statted. You adjudicate how much; the engine applies Temporary Hit Points, the drop to 0 and the Unconscious that follows it, death, and the Concentration save the damage puts at risk. This takes an amount you decided, never the number a die showed.',
  mutates: true,
  input: z.strictObject({
    target: creatureId,
    amount: z.int().min(0).describe('How much, as you have adjudicated it.'),
    ruling: ruling('the source of the damage'),
    by: creatureId
      .optional()
      .describe('The creature that dealt it, where one did. A trap has none, and that is an answer.'),
  }),
  run: (context, args) =>
    settle(
      context,
      resolveDamage(
        context.campaign.state(),
        who(args.target),
        {
          amount: args.amount,
          source: ruled(args.ruling),
          ...(args.by === undefined ? {} : { by: who(args.by) }),
          ...identity(context),
        },
        context.campaign.supply(),
      ),
      (value) => value.events,
      (value) => ({
        damaged: args.target,
        amount: args.amount,
        concentration: value.concentration,
        duplicate: value.duplicate,
      }),
    ),
});

/**
 * The same chandelier, with the dice still to throw.
 *
 * "4d6 Fire from the falling brazier" is a different sentence from "17
 * damage", and the difference is not convenience. An amount has already met
 * whatever defences the person saying it remembered; **dice and a type are
 * something the engine can measure** — so Resistance, Vulnerability and
 * Immunity apply, exactly as they do to a Fire Bolt, along with Temporary Hit
 * Points, the drop to 0, death and the Concentration save the damage put at
 * risk.
 *
 * **This is the tool step one could not write, and the reason it could not is
 * the first inviolable rule.** Rolling here would issue a roll id and advance
 * the campaign's generator with no `rolls-issued` event to record either —
 * only a command emits one — so the dice would run ahead of the log and every
 * number after them would differ on replay. `rollAttackDamage` is public and
 * would have worked; `boundary.test.ts` beside this file forbids importing it
 * for precisely that reason. `rollImprovisedDamage` is the door, and the die
 * it throws is the engine's own.
 *
 * The DM still states no number. Notation is not a result: the engine decides
 * what "4d6" comes to, and refuses notation it cannot read without throwing
 * anything.
 */
const ROLL_IMPROVISED_DAMAGE = tool({
  name: 'roll_improvised_damage',
  description:
    'Deal damage from something the rules do not model, and have the engine roll it — "4d6 Fire from the falling brazier". You name the dice and the kind of damage; the engine throws them, applies Resistance, Vulnerability and Immunity to that kind, then Temporary Hit Points, the drop to 0 and the Unconscious that follows it, death, and the Concentration save the damage puts at risk. Use `improvised_damage` instead when you have already decided the number and want it to land as stated.',
  mutates: true,
  input: z.strictObject({
    target: creatureId,
    dice: z
      .string()
      .min(1)
      .describe('Dice notation: "4d6", "2d10". What the engine throws — never what a die showed.'),
    damageType: damageTypeSchema.describe('Which kind, because Resistance is measured per kind.'),
    ruling: ruling('the source of the damage'),
    by: creatureId
      .optional()
      .describe('The creature that dealt it, where one did. A trap has none, and that is an answer.'),
  }),
  run: (context, args) =>
    settle(
      context,
      rollImprovisedDamage(
        context.campaign.state(),
        who(args.target),
        {
          dice: args.dice,
          damageType: args.damageType,
          source: ruled(args.ruling),
          ...(args.by === undefined ? {} : { by: who(args.by) }),
          ...identity(context),
        },
        context.campaign.supply(),
      ),
      (value) => value.events,
      (value) => ({
        damaged: args.target,
        damageType: args.damageType,
        dice: args.dice,
        rolled: value.rolled,
        amount: value.amount,
        // The dice themselves, with the id the engine issued and the
        // provenance it stamped. A DM reading `engine` here is reading the
        // one thing this surface cannot forge.
        rolls: value.components.flatMap((component) =>
          component.roll === null
            ? []
            : [
                {
                  id: component.roll.provenance.id,
                  source: component.roll.provenance.source,
                  dice: component.roll.dice.map((die) => die.value),
                  total: component.roll.total,
                },
              ],
        ),
        concentration: value.concentration,
        duplicate: value.duplicate,
      }),
    ),
});

/**
 * Impose a condition as the consequence of a ruling — the wider half.
 *
 * The model's surface has `apply_condition`, which is this without the last
 * line of its duration: a model may say "until the end of your next turn" and
 * may not say "for ten minutes", because invariant 7 lists durations among the
 * quantities the engine calculates and a *moment in the turn order* is not a
 * number where a span of seconds is. A DM's span is a ruling, and the engine
 * still converts it against its own clock and still refuses one it cannot
 * answer.
 *
 * So this replaces `apply_condition` on the DM's surface rather than sitting
 * beside it: two tools that impose a condition, differing in one field, is a
 * choice a caller should not have to make. `boundary.test.ts` asserts that the
 * swap is exactly one tool wide.
 */
const RULE_CONDITION = tool({
  name: 'rule_condition',
  description:
    'Apply an SRD condition as the consequence of a ruling you have made — Prone after a fall, Frightened at a horror, Poisoned by the fumes. The engine handles what the condition implies, what it interacts with, and whether the creature is immune. Say when it ends with `until`: a moment in the turn order, or a span of time in seconds. The ruling is recorded as the source, and `end_condition` lifts it again by naming the same words.',
  mutates: true,
  input: z.strictObject({
    who: creatureId,
    condition: conditionSchema,
    ruling: ruling('the source of the condition'),
    until: z
      .union([
        conditionDurationSchema,
        z.strictObject({
          kind: z.literal('seconds'),
          seconds: z.int().min(1).describe('How long, in seconds. A minute is 60; an hour is 3600.'),
        }),
      ])
      .optional()
      .describe('When it stops. Omit for a condition that lasts until something in the fiction ends it.'),
  }),
  run: (context, args) => {
    const until: Duration | undefined =
      args.until === undefined
        ? undefined
        : args.until.kind === 'end-of-current-turn'
          ? { kind: 'end-of-current-turn' }
          : args.until.kind === 'seconds'
            ? { kind: 'seconds', seconds: args.until.seconds }
            : { kind: args.until.kind, of: who(args.until.of) };
    return settleEvents(
      context,
      applyConditionTo(
        context.campaign.state(),
        who(args.who),
        args.condition as ConditionName,
        ruled(args.ruling),
        [],
        until,
        undefined,
        identity(context),
      ),
      { applied: args.condition, because: args.ruling, until: args.until ?? null },
    );
  },
});

/**
 * End a ruling that imposed a condition.
 *
 * The half the surface was missing, and the reason the engine grew a command:
 * `endConditionsOn` was a pure event builder with no identity and no stamp, so
 * a surface that called it would append events no command had identified, and
 * a retried "it is over" would be a second removal nothing could tell from the
 * first.
 *
 * **Naming the ruling matters.** Without one, every reason the creature has
 * that condition goes — which is what SRD's own removals mean ("end the
 * Poisoned condition on it") and what a DM saying "he is not frightened any
 * more" means. With one, only that cause goes: a goblin frightened by the
 * shrieking *and* by the dragon is still frightened of the dragon, and a
 * Paralyzed a Hold Person is holding up is not lifted by ending a ruling that
 * never caused it.
 */
const END_CONDITION = tool({
  name: 'end_condition',
  description:
    'End a condition on a creature. Give `ruling` — the same words you applied it with — to end only that cause, leaving any other reason the creature has the condition standing. Omit it to end the condition outright, whatever caused it. Ending a condition the creature does not have is not an error.',
  mutates: true,
  input: z.strictObject({
    who: creatureId,
    condition: conditionSchema,
    ruling: ruling('the one cause to lift').optional(),
  }),
  run: (context, args) =>
    settleEvents(
      context,
      liftConditionFrom(
        context.campaign.state(),
        who(args.who),
        args.condition as ConditionName,
        args.ruling === undefined ? undefined : ruled(args.ruling),
        identity(context),
      ),
      { ended: args.condition, of: args.who, only: args.ruling ?? null },
    ),
});

/**
 * Hand a party what it found.
 *
 * **On this surface and not the model's, by the rule `create_character`
 * already keeps.** That tool refuses a non-empty `dmGrants`: an item and a
 * live magic item are the DM's to give and are not a thing a model writes
 * itself. Handing out treasure is the same decision one call later, so it
 * lives here — and it is what makes `use_item` on the model's surface a door
 * onto an inventory rather than onto an empty one, because until this existed
 * nothing on either surface could put a potion in a character's hands.
 *
 * **The quantity is a count of things, not a mechanical number.** How many
 * potions the chest held is fiction, exactly as how wide the room is. What the
 * *item* is worth is never stated: the dice, the charges and the save DC are
 * the catalogue's, and where a copy's charges are rolled — SRD Necklace of
 * Fireballs' "1d6+3 beads" — the engine rolls them out of the campaign's own
 * generator and pins the number.
 *
 * A pack is opened on the way in, so a Scholar's Pack handed over is nine
 * things handed over.
 */
const AWARD_ITEMS = tool({
  name: 'award_items',
  description:
    'Give a creature what it found, bought or was handed: items by catalogue id, with a quantity where there is more than one. Everything about each item is read out of the book — its weight, its charges, what it confers, and the dice for a copy whose count the book rolls. Say where it came from; the log records it. A pack is unpacked into the things inside it. What a character does with an item afterwards is theirs: a potion is drunk with `use_item` and armour is worn by equipping it.',
  mutates: true,
  input: z.strictObject({
    who: creatureId.describe('Who is receiving it.'),
    items: z
      .array(
        z.strictObject({
          id: z.string().min(1).describe('Catalogue id, e.g. potion-of-healing, longsword.'),
          quantity: z.int().min(1).optional().describe('How many. One where it is left out.'),
        }),
      )
      .min(1)
      .describe('What was found. An award has to name something.'),
    because: z
      .string()
      .min(1)
      .describe('Where it came from, in one phrase: "the chest under the altar".'),
  }),
  run: (context, args) =>
    settleEvents(
      context,
      awardItems(
        context.campaign.state(),
        context.campaign.supply(),
        who(args.who),
        args.items.map((line) => ({
          id: line.id,
          ...(line.quantity === undefined ? {} : { quantity: line.quantity }),
        })),
        args.because,
        identity(context),
      ),
      { awarded: args.items.map((line) => line.id), to: args.who, because: args.because },
    ),
});

/**
 * Take away what a thief took — `award_items`' other half.
 *
 * **Here for the reason `award_items` is here**, which is the same sentence
 * read backwards: handing out what a party found is the DM's, so is a mimic
 * swallowing the sword, a ration eaten and a purse cut. What a character
 * *does* with what it holds — wears it, attunes to it, hands it to an ally —
 * is the character's, and those are on the model's door beside `use_item`. A
 * model that could delete a party's inventory by naming it would be writing
 * the world rather than playing in it.
 *
 * **No price and no catalogue.** Nothing is sold and no coin moves, and the
 * item does not have to be one the SRD lists — a DM may take away a thing the
 * book never printed. Two refusals are the engine's and both are the rule
 * rather than bookkeeping: more than is carried is refused rather than
 * silently taking what there is, and something worn or wielded is refused
 * because owning and wearing are two facts — confiscating worn armour would
 * leave it worn and still adding its Armour Class. Taking it off is
 * `unequip_item`, and it should look like a decision.
 */
const LOSE_ITEMS = tool({
  name: 'lose_items',
  description:
    'Take something away from a creature: the thief in the night, the mimic that swallowed the sword, the rations eaten. No coin moves and the catalogue is not consulted, so a thing the book never printed can be taken too. Say where it went; the log records it. More than the creature has is refused, and so is something worn or wielded — take that off first.',
  mutates: true,
  input: z.strictObject({
    who: creatureId.describe('Who is losing it.'),
    items: z
      .array(
        z.strictObject({
          id: z.string().min(1).describe('Catalogue id, or whatever the thing is called.'),
          quantity: z.int().min(1).optional().describe('How many. One where it is left out.'),
          instance: z
            .string()
            .min(1)
            .optional()
            .describe(
              'Which copy, where `sheet` tells the copies apart — a wand with charges of its own. Naming none is fine where there is only one.',
            ),
        }),
      )
      .min(1)
      .describe('What was lost. A loss has to name something.'),
    because: z
      .string()
      .min(1)
      .describe('Where it went, in one phrase: "the thief in the night".'),
  }),
  run: (context, args) =>
    settleEvents(
      context,
      loseItems(
        context.campaign.state(),
        who(args.who),
        args.items.map((line) => ({
          id: line.id,
          quantity: line.quantity ?? 1,
          ...(line.instance === undefined ? {} : { instance: line.instance }),
        })),
        args.because,
        identity(context),
      ),
      { lost: args.items.map((line) => line.id), from: args.who, because: args.because },
    ),
});

/**
 * Which coin, in the book's own denominations.
 *
 * A DM says "fifty gold", not "five thousand copper", and the rate between
 * them is the SRD's rather than the caller's — `COPPER_PER` is the catalogue's
 * own table, the one every printed price is already read through. So the
 * amount is a decision (how rich was the hoard) and the conversion is not,
 * which is the line this whole surface is drawn along.
 *
 * Gold by default, because that is the coin the treasure tables print.
 */
const COIN = z
  .enum(Object.keys(COPPER_PER) as [string, ...string[]])
  .default('gp')
  .describe('Which coin: cp, sp, ep, gp or pp. Gold where it is left out.');

/** How much, as a count of coins. Never a die, and never zero. */
const AMOUNT = z
  .int()
  .min(1)
  .describe('How many coins. A count you decided on, like the number of potions in a chest.');

/** The caller's two fields in the engine's single signed unit. */
const copperOf = (amount: number, coin: string): number =>
  amount * COPPER_PER[coin as keyof typeof COPPER_PER];

/**
 * Pay a party.
 *
 * **The door that was missing, and the shape of what was missing is exact.**
 * `purchase_item` has been on the model's surface for as long as the engine
 * has priced a shop, and it spent a purse that nothing on either surface could
 * fill: `coins-changed` had two writers, creation and a purchase, and the
 * second only ever wrote a negative one. A party's money was therefore what it
 * was born with and could only go down, so every shop in the book was
 * reachable exactly once and only by whoever started rich.
 *
 * **On this surface for the reason `award_items` is on it**, which is the same
 * sentence about a different kind of treasure: what a party found is the DM's
 * to give, and a model that could pay itself would be writing the world rather
 * than playing in it. It is a *tool* rather than a field on `create_character`
 * for the sharper half of that — `dmGrants.goldPieces` is pinned to a literal
 * zero in a schema **both** surfaces share, and loosening it there to let a DM
 * start a party rich would hand a model the same authorship in the same call.
 *
 * **The amount is a decision and the rate is not.** How much the patron paid
 * is fiction, exactly as how wide the room is; the conversion from the coin a
 * DM named into the copper the purse counts is the catalogue's.
 */
const AWARD_COIN = tool({
  name: 'award_coin',
  description:
    'Pay a creature: the reward for the caravan, the purse on the body, a share of the hoard. Say how many coins and which — gold where you do not say. The engine converts to the copper a purse is counted in and the character can spend it at the prices the book prints. Say where it came from; the log records it.',
  mutates: true,
  input: z.strictObject({
    who: creatureId.describe('Who is being paid.'),
    amount: AMOUNT,
    coin: COIN,
    because: z
      .string()
      .min(1)
      .describe('Where it came from, in one phrase: "the reward for the caravan".'),
  }),
  run: (context, args) =>
    settleEvents(
      context,
      changeCoins(
        context.campaign.state(),
        who(args.who),
        copperOf(args.amount, args.coin),
        args.because,
        identity(context).commandId,
      ),
      // **Both numbers, and the unit of each.** The purse is counted in copper
      // and the DM spoke in gold, so an echo that said `paid: 5000` to
      // somebody who typed `50` would read as the surface having invented a
      // number. It says what was asked for and what the catalogue made of it.
      {
        paid: args.amount,
        coin: args.coin,
        copper: copperOf(args.amount, args.coin),
        to: args.who,
        because: args.because,
      },
    ),
});

/**
 * Take coin away — `award_coin`'s other half, and `lose_items`' other half
 * too.
 *
 * **Two doors over one command, on purpose.** The engine has a single signed
 * event whose own comment reads "Money in or out", and `changeCoins` is a
 * single signed command over it, because splitting the directions down there
 * would invent an asymmetry the log does not have. A *surface* is exactly
 * where that turns back into the two sentences a DM would actually say: "pass
 * a negative number to rob them" is not prose a door should print, and
 * `award_items` and `lose_items` next door already answer the question this
 * way.
 *
 * **Not `purchase_item` in disguise.** A toll buys no item, a bribe has no
 * catalogue row and a thief leaves no receipt, and a purchase refuses an id
 * the catalogue does not hold — so there is no fiction to buy and this is not
 * a thing a shop could have done. `lose_items`, whose prose names "a purse
 * cut" among the things it is for, says in its next sentence that no coin
 * moves; this is the half that sentence was describing the absence of.
 *
 * **More than is carried is refused, and the refusal is the engine's.** The
 * reducer would throw on a purse below zero, which is the right answer to a
 * corrupt log and the wrong one to a DM who named a bigger bribe than the
 * party can pay; `changeCoins` answers `not_enough_coin` as a value and names
 * what is actually there, so the table can lower its price.
 */
const TAKE_COIN = tool({
  name: 'take_coin',
  description:
    'Take coin from a creature: the toll at the bridge, the bribe, the thief in the night, the tax on the gate. Say how many coins and which — gold where you do not say. More than the creature is carrying is refused, and the refusal says what is there. Say where it went; the log records it.',
  mutates: true,
  input: z.strictObject({
    who: creatureId.describe('Who is losing it.'),
    amount: AMOUNT,
    coin: COIN,
    because: z
      .string()
      .min(1)
      .describe('Where it went, in one phrase: "the toll at the bridge".'),
  }),
  run: (context, args) =>
    settleEvents(
      context,
      changeCoins(
        context.campaign.state(),
        who(args.who),
        -copperOf(args.amount, args.coin),
        args.because,
        identity(context).commandId,
      ),
      // The same two numbers and the same two units; see {@link AWARD_COIN}.
      {
        taken: args.amount,
        coin: args.coin,
        copper: copperOf(args.amount, args.coin),
        from: args.who,
        because: args.because,
      },
    ),
});

/**
 * What a spend of a printed line answers with, for both of the tools that
 * take one.
 *
 * **The name is read back out of the event rather than echoed from the
 * call.** The engine matches a heading without regard to case and writes the
 * *printed* spelling down, so a caller that typed `cold breath (recharge 5-6)`
 * is told what the block says and what the log says, which are one string. An
 * echo would be the surface answering a question the engine already answered,
 * and answering it differently.
 *
 * `expended` says whether the line is gone until it comes back, which a caller
 * that could not see it would have to spend another Action to find out. It is
 * asked of the **creature** — `expendedLines`, the same ledger the engine's own
 * `line_expended` refusal reads, so the answer here and the refusal there
 * cannot disagree. A `printed-line-expended` out of the log would answer "was
 * it ever", and a line the engine handed back at a turn boundary would still
 * read as gone.
 *
 * **Neither is read out of this call's batch**, and that is what makes a retry
 * honest. `once` hands a duplicate back with *no* events, so a reading of the
 * batch would fall through to echoing the caller's casing and would report a
 * spent recharge as unspent — the two failures this note forbids, arriving
 * through the one path with nothing to read. The log is searched instead,
 * matched on the command stamp the first call left on its own event, which is
 * the same id the transport is re-sending; `settle` appends before it asks for
 * a resolution, so the fresh path finds its own event there too and there is one
 * path rather than two. It is searched from the back, where the fresh path's
 * event always is. A call whose event cannot be found claims neither field:
 * `duplicate` is then the whole of the answer.
 */
const lineTaken = (
  context: ToolContext,
  type: 'stated-action-taken' | 'stated-bonus-action-taken',
  duplicate: boolean,
  id: string,
): Readonly<Record<string, unknown>> => {
  const taken = context.campaign
    .log()
    .findLast(
      (event) =>
        event.type === type &&
        (event as { command?: { id: string } }).command?.id === context.commandId,
    ) as { line: string } | undefined;

  return {
    who: id,
    ...(taken === undefined
      ? {}
      : {
          line: taken.line,
          expended:
            context.campaign.state().creatures[id]?.expendedLines.includes(taken.line) ?? false,
        }),
    duplicate,
  };
};

/**
 * Take one of the lines a creature's stat block prints under **Actions** that
 * is not an attack.
 *
 * The breath weapon, the gaze, the spellcasting line, the swallow, the roar.
 * Two hundred-odd of them across a third of the bestiary, and until this door
 * existed every one was a heading a caller could read off the block and could
 * not spend — `attack` takes the lines the parser read, and nothing took the
 * rest.
 *
 * **It is here and not on the model's surface, by `award_items`' own rule.**
 * The engine executes no part of a printed line: the whole of a successful
 * call is the Action spent, the heading written down, and the block's sentence
 * handed back under `unverified`. Somebody then has to *adjudicate* that
 * sentence — call the Constitution save, decide what the Cone covers, rule on
 * the shape-shift — and that is the DM's, exactly as the DC in `saving_throw`
 * is. A model holding this tool would be a model narrating a breath weapon
 * into effect with nothing having checked it, which is the one thing the
 * doctrine's division of authority forbids. What a creature does with a line
 * the engine *can* resolve is already a door: `attack` for a printed attack,
 * `cast_spell` for a spell.
 *
 * **It states no number and takes none.** The caller names a heading; the
 * recharge, the DC, the dice and the prose are the block's, pinned into the
 * creature at `add_creature` and never sent through here.
 */
const TAKE_PRINTED_ACTION = tool({
  name: 'take_printed_action',
  description:
    'Take one of the lines a creature’s stat block prints under Actions that is not an attack — a breath weapon, a gaze, a spellcasting line, a swallow. Name the heading as the block prints it. The engine spends the Action, records that this line was taken, and hands you the line’s own sentence back under `unverified`: it applies none of it, so the save, the area and what follows are yours to adjudicate. A line the block prints a recharge on is spent once and refused until it comes back. A printed *attack* is not taken here — `attack` takes that, by its name.',
  mutates: true,
  input: z.strictObject({
    who: creatureId.describe('Which creature is taking the line.'),
    line: printedLineName,
  }),
  run: (context, args) =>
    settle(
      context,
      takeStatedAction(context.campaign.state(), who(args.who), {
        line: args.line,
        ...identity(context),
      }),
      (value) => value.events,
      (value) => lineTaken(context, 'stated-action-taken', value.duplicate, args.who),
      (value) => value.unverified,
    ),
});

/**
 * The same, one section of the block along: a line printed under **Bonus
 * Actions**.
 *
 * A door of its own rather than a `kind` on the one above, because the two
 * spend different halves of the action economy and the engine has two
 * commands. A single tool with a slot would let a caller ask for the Action's
 * price and get the Bonus Action's, which is the quiet wrong answer the fourth
 * outcome exists to prevent.
 *
 * SRD's rule that a creature takes one Bonus Action a turn is the economy's
 * and is enforced there, so a second line on one turn is refused whichever
 * line it is — and a line with a recharge on it is refused before the economy
 * is charged at all.
 */
const TAKE_PRINTED_BONUS_ACTION = tool({
  name: 'take_printed_bonus_action',
  description:
    'Take one of the lines a creature’s stat block prints under Bonus Actions — the goblin’s Nimble Escape, the golem’s Hasten. Name the heading as the block prints it. The engine spends the Bonus Action, records which line was taken, and hands the line’s own sentence back under `unverified` without applying any of it. One Bonus Action a turn, and a line the block prints a recharge on is spent once until it comes back.',
  mutates: true,
  input: z.strictObject({
    who: creatureId.describe('Which creature is taking the line.'),
    line: printedLineName,
  }),
  run: (context, args) =>
    settle(
      context,
      takeStatedBonusAction(context.campaign.state(), who(args.who), {
        line: args.line,
        ...identity(context),
      }),
      (value) => value.events,
      (value) => lineTaken(context, 'stated-bonus-action-taken', value.duplicate, args.who),
      (value) => value.unverified,
    ),
});

/**
 * Say how many of a creature's heads are still on it.
 *
 * SRD Hydra's Multiattack: "The hydra makes as many Bite attacks as it has
 * heads", with the Multiple Heads trait taking one off at 25 damage in a turn
 * and growing two back at the end of it. None of that is state the engine
 * holds — the book counts damage *per turn* and the engine counts hit points —
 * so the count is the table's, and the Bites are the engine's to derive from
 * it. The owner's ruling in one line: a number the *engine* produces is a
 * fabrication, a number the *table* states is a fact.
 *
 * **The first door on either surface that takes a number, and it is here for
 * that reason rather than in spite of it.** Every other authoritative number a
 * caller could state is refused on the model's surface; this one is a fact
 * about the creature in front of the DM, like its side and unlike its hit
 * points. A model may not state it — a model that could say "the hydra has
 * twelve heads" would be writing itself twelve attacks — and that is what the
 * directory is: `boundary.test.ts` beside this file proves the model's surface
 * cannot reach anything in here.
 *
 * **One affordance, not arithmetic done twice.** The DM says how many heads
 * are active; nothing here asks how many Bites that is, and nothing takes an
 * attack count. A caller re-sends this whenever the number changes — a head
 * struck off, two grown back — and the Attack action follows the latest
 * answer, which is why the engine's command is re-declarable.
 *
 * Nobody is *required* to say. A creature nobody has counted swings once and
 * the engine reports the assumption, so this door exists to make a fight
 * right rather than to make one possible.
 */
const DECLARE_HEADS = tool({
  name: 'declare_heads',
  description:
    'Say how many heads a creature still has — the Hydra’s, and anything else whose block counts its attacks off them. Where the block states no attack sequence the engine could read, its Attack action then holds that many swings, derived by the engine rather than stated by you: you say five heads, not five Bites. A creature whose sequence the engine did read is held to what the book printed, whatever you say about its heads. Say it again whenever the number changes; the newest count is the one that counts. Until somebody says, the action holds one attack and the engine reports that it assumed so.',
  mutates: true,
  input: z.strictObject({
    who: creatureId.describe('Which creature.'),
    heads: z
      .int()
      .min(1)
      .describe(
        'How many heads are on it now — the whole count, not the change. A creature whose last head is gone is dead, which is a different thing to say.',
      ),
  }),
  run: (context, args) =>
    settleEvents(
      context,
      declareCreatureHeads(context.campaign.state(), who(args.who), args.heads, identity(context)),
      { heads: args.heads, of: args.who },
    ),
});

/**
 * The tools a model may never reach, in the stable sorted order the prompt
 * cache depends on.
 */
export const DM_ONLY_TOOLS: readonly ToolDefinition[] = [
  ABILITY_CHECK,
  AWARD_COIN,
  AWARD_ITEMS,
  DECLARE_HEADS,
  END_CONDITION,
  IMPROVISED_DAMAGE,
  LOSE_ITEMS,
  ROLL_IMPROVISED_DAMAGE,
  RULE_CONDITION,
  SAVING_THROW,
  SETTLE_TEST,
  TAKE_COIN,
  TAKE_PRINTED_ACTION,
  TAKE_PRINTED_BONUS_ACTION,
].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

export const DM_ONLY_TOOL_NAMES: readonly string[] = DM_ONLY_TOOLS.map((tool) => tool.name);

/**
 * The one model tool the DM's surface does not carry, because a wider tool
 * takes its place. Named rather than inlined so the swap is a decision with a
 * word for it — and so `boundary.test.ts` can assert it is exactly one wide.
 */
const REPLACED = 'apply_condition';

/**
 * The whole DM surface: everything a model may call, minus the one tool
 * {@link RULE_CONDITION} widens, plus the five above.
 *
 * A superset rather than a separate vocabulary, because a DM runs the fight
 * as well as adjudicating it, and a second spelling of `attack` would be a
 * second answer to what an attack is.
 */
export const DM_TOOLS: readonly ToolDefinition[] = [
  ...TOOLS.filter((definition) => definition.name !== REPLACED),
  ...DM_ONLY_TOOLS,
].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

export const DM_TOOL_NAMES: readonly string[] = DM_TOOLS.map((tool) => tool.name);
