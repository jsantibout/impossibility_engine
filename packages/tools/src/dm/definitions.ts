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
  liftConditionFrom,
  resolveDamage,
  resolveTest,
  rollImprovisedDamage,
  settleTest,
} from '@ie/engine';
import { z } from 'zod';
import {
  identity,
  ruled,
  senses,
  settle,
  settleEvents,
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

/** The caller's two phrases, in the engine's attributed vocabulary. */
const ruledModes = (args: {
  readonly advantage?: string | undefined;
  readonly disadvantage?: string | undefined;
}): readonly ModeSource[] => [
  ...(args.advantage === undefined
    ? []
    : [{ source: ruled(args.advantage), mode: 'advantage' as const }]),
  ...(args.disadvantage === undefined
    ? []
    : [{ source: ruled(args.disadvantage), mode: 'disadvantage' as const }]),
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
 * **The `roll-recorded` event does not carry them**, and that is a gap in the
 * log rather than a choice made here: the event declares `contributions`,
 * which are named *amounts*, and Advantage is not an amount. So a reader of
 * the log alone can see that a d20 came to 17 and not that two were thrown
 * for it. Closing that means a field on `GameEvent`, which is a decision
 * about the log's shape and belongs to whoever owns it.
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
 * The tools a model may never reach, in the stable sorted order the prompt
 * cache depends on.
 */
export const DM_ONLY_TOOLS: readonly ToolDefinition[] = [
  ABILITY_CHECK,
  END_CONDITION,
  IMPROVISED_DAMAGE,
  ROLL_IMPROVISED_DAMAGE,
  RULE_CONDITION,
  SAVING_THROW,
  SETTLE_TEST,
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
