/**
 * What every command in this directory needs, and nothing else.
 *
 * Four things, and each is here because every domain asks for it: how to read
 * a creature out of the world, what to answer about one the engine has never
 * been told about, what to answer when there is no scene to be anywhere in,
 * and what to answer when a moment in the turn order has no turn order to be a
 * moment in. The fifth — `once`, the wrapper that puts the duplicate check
 * first — is in `idempotency.ts` with the rest of the identity machinery,
 * because `rest.ts` needs it too and must not reach upwards.
 *
 * It is the one module every other one in `commands/` imports, and it imports
 * none of them. That is what keeps the value-level graph a DAG: the two
 * creature readers were called from all thirteen of the regions the old single
 * file had, so leaving them in any domain would have made that domain a
 * dependency of every other. `sceneFor` arrived here by the same argument
 * measured rather than predicted: it was written privately in
 * `commands/scene.ts`, copied whole into `commands/movement.ts`, and
 * `commands/teleport.ts` is the third place that needs it.
 */

import { type CharacterId, err, type Err, needsContext, ok, type Result } from '@ie/shared';
import { spendAction, spendBonusAction } from '../combat.js';
import { type Duration } from '../duration.js';
import { type GameEvent, type GameState } from '../events.js';
import { distanceBetween, positionOf, type PositionState } from '../positioning.js';

/**
 * The source recorded for unconsciousness that comes from having no hit points
 * left, as opposed to a spell.
 *
 * It is a named constant because healing has to lift *this* cause and leave
 * every other one standing: a character knocked out by Sleep and then dropped
 * to 0 wakes from the hit points, not from the spell.
 */
export const ZERO_HIT_POINTS = 'zero hit points';

export const creatureOf = (state: GameState, id: CharacterId) => state.creatures[id] ?? null;

/**
 * The answer for a creature the engine has never been told about.
 *
 * The most common `needs-context` there is, and until now the one that named
 * no request — so `contextRequestsOf` came back empty and a tool surface was
 * left matching the error code, which is the thing the predicate exists to
 * make unnecessary. Absence from structured state is not evidence a thing
 * does not exist; this says what would make it exist here.
 *
 * Commands attach requests. The pure helpers beneath them (`positioning.ts`,
 * `combat.ts`) return the bare kind and leave the request to the command that
 * knows which rule wanted the fact.
 *
 * **This was the one request that named an event rather than a command**, and
 * it is not any more. Every other one names something a caller can send,
 * because a tool surface calls commands and never appends events — appending
 * one is how the model would assert a mechanical fact directly. Adding a
 * creature genuinely had no command: `createCharacter` in `creation.ts` emits
 * `creature-added`, predates the command layer, takes no `CommandIdentity` and
 * is not published through the `commands.ts` barrel, so this said "a
 * creature-added event" and `invariants.test.ts` carried a written exemption
 * saying that a barrel command adding a creature was what would end it.
 * `addCreature` is that command, and the exemption was deleted rather than
 * reworded — which is what an exemption naming the fact that would end it is
 * for.
 *
 * It names `addCreature` rather than `createCharacter` because the creature
 * the engine is asked about mid-fight is a monster far more often than a
 * character sheet, and a request has to name one thing. A caller whose missing
 * creature is a player character builds it the way every character is built.
 */
export const unknownCreature = (id: CharacterId, detail = 'is not in this game') =>
  needsContext('unknown_creature', `${id} ${detail}`, [
    {
      kind: 'creature',
      subject: id,
      need: `a record for ${id}`,
      because: 'the command names a creature the engine has never been told about',
      satisfyWith: `an addCreature command for ${id}`,
    },
  ]);

/**
 * The scene, or the request that would make one.
 *
 * Homework rather than a verdict: nothing is wrong, the record is thin, and
 * `setScene` in `commands/scene.ts` is what settles it. The reducer says the
 * same thing by throwing `no scene has been set`; a command says it as a fact
 * to go and get, because a caller who has not described the room yet has made
 * no mistake.
 *
 * **Hoisted because a third copy arrived.** It was written privately in
 * `commands/scene.ts` and copied, prose included, into `commands/movement.ts`
 * — IE-016's builder and reviewer both recorded that a third copy would be the
 * moment to move it, and `commands/teleport.ts` is that third. It belongs
 * here for the reason the two creature readers do: it is a question every
 * domain that is about a *place* has to ask, and answering it in any one of
 * them would make that domain a dependency of the others.
 */
export function sceneFor(
  state: GameState,
  subject: string,
  because: string,
): Result<PositionState> {
  if (state.scene !== null) return ok(state.scene);
  return needsContext('no_scene', `there is no scene for ${because}`, [
    {
      kind: 'scene',
      subject,
      need: 'a scene, so that a place in it means something',
      because,
      satisfyWith: 'a setScene command',
    },
  ]);
}

/**
 * How the SRD writes each moment in the turn order, in its own words.
 *
 * The rule that wanted the fact **is** the printed clause, so `because` is
 * read off the duration rather than threaded from the call site. That is not a
 * convenience: a rider on a condition, a rider on a Speed and a casting's own
 * Duration are three different sentences in three different spells, and the
 * only thing they have in common is the member they resolve to — which is
 * precisely the thing that cannot be answered without a turn order.
 */
const PRINTED_AS: Readonly<Record<string, string>> = {
  'start-of-next-turn': 'until the start of your next turn',
  'end-of-next-turn': 'until the end of your next turn',
  'end-of-current-turn': 'until the end of the current turn',
};

/**
 * A moment in the turn order, asked for rather than refused.
 *
 * `resolveDuration` is the single conversion between a relative `Duration` and
 * an absolute `Deadline`, and it **refuses** a turn-anchored one it cannot
 * pin. It must go on refusing: where "the start of your next turn" falls
 * depends on where the anchor sits in the Initiative order and on whose turn
 * the effect began, so quietly calling it six seconds is the one mistake the
 * whole two-type split exists to prevent.
 *
 * What was wrong was not the refusal but **who it was addressed to**. SRD Ray
 * of Frost is a cantrip; a cantrip that cannot be cast in a corridor is a hole
 * the layer above cannot repair, because `no_turns` does not say what would
 * repair it. This is the three-state discipline the engine already applies to
 * a creature nobody has typed and a room nobody has described — the rules say
 * no, the record is thin, or fine — reaching a fact that is thin rather than
 * forbidden.
 *
 * **Two thin records, not one**, and they are repaired by different commands:
 *
 * | Refusal | What is missing | What settles it |
 * |---|---|---|
 * | `no_turns` | there is no Initiative order at all | `beginCombat` |
 * | `not_in_combat` | the fight exists and the anchor has no place in it | `rollInitiativeFor`, then `joinCombat` |
 *
 * Collapsing them would tell a caller mid-fight to begin a fight, which is not
 * a repair and is not even legal to mean.
 *
 * **The second row used to describe a repair rather than name one**, and that
 * was the honest shape of a gap rather than a wording problem: it asked for "a
 * number for the anchor, and a fight that holds it", because the only command
 * that could hold the number was `beginCombat` and beginning a fight is
 * exactly what this row exists to say the caller must not do. `joinCombat`
 * puts one creature into a running order, so the request names it. Two
 * commands are still named, and that is the fact rather than the workaround:
 * the number and the place in the order are two things, and the first row
 * names two for the same reason a fight needs somebody in it.
 *
 * **Everything else stays a refusal.** `bad_duration` is a span running
 * backwards or in fractions of a second: nothing a caller can declare makes
 * minus six seconds a whole number forwards, so offering to go and find a fact
 * would be an orchestrator loop rather than a repair. The default is the one
 * that closes the question, exactly as `err` is.
 *
 * `holder` is read only where the duration names no anchor — SRD's "until the
 * end of the current turn" is a moment in the order rather than a fact about a
 * creature, so the subject falls back to whoever the effect is being hung on.
 * It is a `string` rather than a `CharacterId` because a casting's deadline is
 * about a casting, and a request has to be about something.
 */
export function turnContextFor(refused: Err, duration: Duration, holder: string): Err {
  const printed = PRINTED_AS[duration.kind];
  if (printed === undefined) return refused;

  const subject = 'of' in duration ? duration.of : holder;

  // The fight exists and this creature has no place in it. Beginning combat is
  // not the repair — there is a combat — so the request names what gives the
  // anchor a number and what puts that number in the order.
  if (refused.code === 'not_in_combat') {
    return needsContext(refused.code, refused.reason, [
      {
        kind: 'turn-order',
        subject,
        need: `a place in the Initiative order for ${subject}`,
        because: `the effect lasts "${printed}", and this fight holds no turns for ${subject}`,
        satisfyWith: `a rollInitiativeFor command for ${subject}, then a joinCombat command putting ${subject} into the running order at that number`,
      },
    ]);
  }

  if (refused.code === 'no_turns') {
    return needsContext(refused.code, refused.reason, [
      {
        kind: 'turn-order',
        subject,
        need: 'an Initiative order, so that a moment in it means something',
        because: `the effect lasts "${printed}", and outside combat there is no turn whose start or end that names`,
        satisfyWith: 'a beginCombat command',
      },
    ]);
  }

  return refused;
}

/**
 * SRD's "a creature you touch", and "administer it to another creature within
 * 5 feet of yourself" — one rule, asked by two commands.
 *
 * It was written once in `commands/features.ts` for a Paladin's Lay On Hands,
 * and a potion is the second thing in the book that reaches across a table to
 * do somebody good — which is the moment it stops being one command's
 * business.
 *
 * **Three answers, and all three are load-bearing:**
 *
 * - **Null** — it reaches. Which includes *no scene at all*: a table not using
 *   positions is not a table where everybody is out of reach, and refusing a
 *   touch for want of a map the DM never drew would be the engine inventing a
 *   rule. Reaching yourself is null too; you are always within five feet of
 *   yourself.
 * - **A request** — somebody's position is unstated. The scene exists, so the
 *   table *is* keeping positions and one of them is missing; that is a gap in
 *   a record rather than a fact about the world, and unknown is not false.
 * - **A refusal** — the distance is known, and it is too far.
 */
export function reachedBy(
  state: GameState,
  who: CharacterId,
  target: CharacterId,
  /** What is reaching, for the refusal and the request to name. */
  what: string,
  feet = 5,
): Err | null {
  if (target === who || state.scene === null) return null;

  const scene = state.scene;
  const measured = distanceBetween(scene, who, target);
  if (!measured.ok) {
    const off = [who, target].filter((absent) => positionOf(scene, absent) === null);
    return needsContext(
      'unplaced',
      `nobody has said where ${off.join(' or ')} ${off.length === 1 ? 'is' : 'are'} standing, and ${what} reaches ${feet} feet`,
      off.map((absent) => ({
        kind: 'position' as const,
        subject: absent,
        need: `where ${absent} is standing`,
        because: `${what} reaches ${feet} feet`,
        satisfyWith: `a placeCreatureInScene command for ${absent}`,
      })),
    );
  }
  if (measured.value > feet) {
    return err(
      'out_of_reach',
      `${target} is ${measured.value} feet away, and ${what} reaches ${feet} feet`,
    );
  }
  return null;
}

/**
 * Spend the Action or Bonus Action a command costs, whichever kind it is.
 *
 * The same two functions `resolveCast` uses, because they are the ones that
 * know the Incapacitated rule: SRD says a creature with that condition "can't
 * take any action, Bonus Action, or Reaction", and that check belongs in one
 * place rather than in every caller that spends one.
 *
 * Here rather than in `commands/features.ts`, where it was written, for the
 * reason {@link sceneFor} and the two creature readers are here: a third
 * module wants it. **The action economy exists only in combat** — outside one
 * there is nothing to spend, which every feature and every potion finds alike
 * — so a caller asks this only when `state.combat` is not null, and the
 * refusal inside is for a caller who forgot.
 */
export function spendFor(
  state: GameState,
  id: CharacterId,
  action: 'action' | 'bonus-action',
): Result<GameEvent> {
  const combat = state.combat;
  if (combat === null) {
    return err('not_in_combat', 'there is no action economy outside combat');
  }
  const creature = creatureOf(state, id);
  const conditions = creature?.conditions;

  // **No name**, because this helper does not know one: it is what a feature
  // or an item activation costs, and the engine has no member of
  // `NAMED_ACTIONS` for "whatever this feature is". The slot-level rules
  // still bite, which is what SRD Stinking Cloud's sentence actually says.
  const spend = { rules: creature?.actionRules ?? [] };

  const spent =
    action === 'bonus-action'
      ? spendBonusAction(combat, id, conditions, spend)
      : spendAction(combat, id, conditions, spend);
  if (!spent.ok) return spent;

  return ok(
    action === 'bonus-action'
      ? { type: 'bonus-action-spent', id }
      : { type: 'action-spent', id },
  );
}
