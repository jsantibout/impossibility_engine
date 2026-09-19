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
 * The three things step one's digest named as missing, and the settlement one
 * of them owes:
 *
 * - `ability_check` — a check against a DC the table decided.
 * - `settle_test` — because a check can open a Reaction window, and a window
 *   nobody closes wedges every other command. A missing settlement is worse
 *   than a missing mechanic: the game stops rather than the action being
 *   refused.
 * - `improvised_damage` — the chandelier nobody has statted.
 * - `rule_condition` / `end_condition` — a ruled condition, for a span of time
 *   only a DM may state, and the ruling ended when the DM says it is over.
 *
 * A saving throw against a DM's DC is the obvious fourth and is deliberately
 * not here: `resolveTest` takes it as one field, so it is a tool and a test
 * rather than a design, and this batch's brief named three things.
 *
 * ## Why this is a directory and not a flag
 *
 * `boundary.test.ts` beside this file walks the imports out of the model's
 * `surface.ts` and asserts that no file under `dm/` is reachable from any of
 * them. That is a claim a directory can carry and a boolean cannot.
 */

import type { ConditionName } from '@ie/shared';
import type { Duration } from '@ie/engine';
import { applyConditionTo, liftConditionFrom, resolveDamage, resolveTest, settleTest } from '@ie/engine';
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
    'Ask a creature for an ability check against a Difficulty Class you have set. You choose the ability, the skill if one applies, and the DC; the engine supplies the modifier, proficiency, Expertise, conditions and every standing bonus, throws the die and decides the outcome. It does not take a roll — if you rolled physical dice, this is not the tool.',
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
  }),
  run: (context, args) =>
    settle(
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
          ...senses(args),
          ...identity(context),
        },
        context.campaign.supply(),
      ),
      (value) => value.events,
      (value) => ({
        natural: value.test?.natural ?? null,
        total: value.test?.total ?? null,
        success: value.test?.success ?? null,
        dc: args.dc,
        ...(value.offers.length === 0 ? {} : { mayAnswer: value.offers.map((o) => o.reactor) }),
        duplicate: value.duplicate,
      }),
      (value) => value.unverified,
    ),
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
 * **The amount is not a roll.** A DM who wants dice thrown for the chandelier
 * has nothing to call here yet: no engine command rolls a caller's notation
 * and records the generator it moved, and this layer must not roll one
 * itself — the roll id and the `rolls-issued` event are the engine's to
 * issue, and a surface that threw its own die would desynchronise the
 * campaign's generator from its log. That command is the next thing this
 * surface wants.
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
  RULE_CONDITION,
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
