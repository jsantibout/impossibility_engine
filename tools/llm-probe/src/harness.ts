/**
 * The experiment loop, and the determinism checks it ends with.
 *
 * One beat is one creature's turn. The model is told whose turn it is and, on
 * the player character's turns, what the player said; it then calls tools until
 * it ends the turn, stops calling, or hits the cap. Everything it does is
 * recorded in the order it happened, and the recording is replayed at the end
 * into a fresh table to prove the surface adds no nondeterminism of its own.
 *
 * **The harness never repairs a bad turn.** If the model stops without ending
 * the turn, that beat is recorded as unfinished and the harness advances the
 * fight itself so the remaining beats can still be measured. The intervention
 * is counted and reported; it is a measurement, not a rescue.
 */

import { expect as unwrap, type CharacterId } from '@ie/shared';
import {
  fold,
  rollInitiativeFor,
  speed,
  type GameEvent,
  type GameState,
} from '@ie/engine';
import type { Encounter } from './encounter.js';
import { createSession, type Session } from './session.js';
import { analyse, createRecorder, type Analysis, type DeterminismReport } from './metrics.js';
import { MUTATING_TOOLS, dispatch, observe, type CallResult } from './surface.js';
import type { ModelDriver } from './drivers.js';

/** One dispatched call, in order, so the whole run can be replayed. */
export interface TranscriptEntry {
  readonly tool: string;
  readonly input: unknown;
  /** True when the harness made the call, not the model. */
  readonly harness: boolean;
}

export interface RunOutcome {
  readonly analysis: Analysis;
  readonly determinism: DeterminismReport;
  readonly log: readonly GameEvent[];
  readonly transcript: readonly TranscriptEntry[];
  readonly narration: readonly string[];
  readonly interventions: number;
  readonly finalState: GameState;
}

export interface RunOptions {
  readonly encounter: Encounter;
  readonly rounds: number;
  /** How many model exchanges one beat may take before the harness steps in. */
  readonly maxExchangesPerBeat: number;
}

/**
 * Start the fight.
 *
 * Done by the harness rather than the model, and that is a finding rather than
 * a shortcut: **there is no engine command that begins combat.** `combat-started`
 * is an event a caller assembles by hand, so a tool for it would either take
 * initiative values the model invented or wrap an event the doctrine says the
 * layer above should never assemble. Rolling it here keeps the experiment
 * honest about where the surface actually stops.
 */
function beginCombat(session: Session, order: readonly CharacterId[]): void {
  const combatants = order.map((who) => {
    const { issuer, rng } = session.supply();
    const before = issuer.count;
    const roll = unwrap(rollInitiativeFor(session.state(), who, issuer, rng), 'initiative');
    session.push([{ type: 'rolls-issued', count: issuer.count - before, rng: rng.snapshot() }]);
    // Read off the creature, never assumed. A flat 30 was correct for every
    // combatant in the tavern and is wrong for the first thing that is not a
    // person: an SRD Ogre walks at 40, and a harness that told the engine 30
    // would have quietly given every later Tier 2 measurement a monster that
    // could not reach where it was trying to go.
    const sheet = session.state().creatures[who]?.sheet;
    return {
      id: who,
      initiative: roll.total,
      speed: sheet === undefined ? 30 : speed(sheet),
    };
  });
  session.push([{ type: 'combat-started', combatants }]);
}

const activeIn = (state: GameState): CharacterId | null => {
  const combat = state.combat;
  if (combat === null) return null;
  return combat.order[combat.turnIndex]?.id ?? null;
};

const alive = (state: GameState, who: CharacterId): boolean => {
  const c = state.creatures[who];
  return c !== undefined && !c.vitals.dead && c.vitals.hp > 0;
};

/**
 * What the model is told at the start of a beat.
 *
 * The player character's beats carry the player's words, verbatim and
 * scripted. A monster's beat carries only whose turn it is — working out what a
 * goblin does is the DM's job, and handing it a suggestion would be the
 * harness playing the game.
 *
 * **The state goes in the prompt.** The first version of this carried prose
 * only, and the first live run showed exactly what that costs: the model
 * opened by casting at `"goblin"` on behalf of `"Kessa"`, having had nothing
 * but the narration to take ids from. The engine answered `needs-context` and
 * it corrected itself in one round trip — the protocol doing its job — but the
 * round trip was the harness's fault, not the boundary's. A surface that
 * answers every call with the state must open the turn with it too, or the
 * first call of every beat is made blind.
 */
function promptFor(state: GameState, who: CharacterId, intent: string | undefined): string {
  const combat = state.combat;
  const round = combat?.round ?? 1;
  const ground = `Authoritative state:\n${JSON.stringify(observe(state))}`;
  const name = state.creatures[who]?.name ?? who;
  // A scripted line is what makes this a player's beat; its absence is what
  // makes it the DM's. That is the whole of the distinction, and it scales
  // from one player character to three without the harness knowing anything
  // about classes, sides or who is a monster.
  if (intent !== undefined) {
    return `Round ${round}. It is ${name}'s turn (id \`${who}\`).\n\nThe player says: "${intent}"\n\n${ground}\n\nResolve ${name}'s turn, then end it.`;
  }
  return `Round ${round}. It is ${name}'s turn (id \`${who}\`). You are running the monsters. Take its turn, then end it.\n\n${ground}`;
}

export async function runExperiment(
  driver: ModelDriver,
  options: RunOptions,
): Promise<RunOutcome> {
  const encounter = options.encounter;
  const session = createSession(encounter.seed, encounter.prelude);
  beginCombat(session, encounter.roster);
  const opening = session.log();

  const recorder = createRecorder();
  const narration: string[] = [];
  const transcript: TranscriptEntry[] = [];
  let interventions = 0;

  /** Dispatch one call, record it, and hand back what the model is shown. */
  const perform = (tool: string, input: unknown, byHarness: boolean): CallResult => {
    const before = session.state();
    const started = Date.now();
    const result = dispatch(session, tool, input, { narration });
    const ms = Date.now() - started;
    transcript.push({ tool, input, harness: byHarness });
    if (!byHarness) {
      recorder.call({
        turnOf: activeIn(before),
        tool,
        input,
        mutating: MUTATING_TOOLS.has(tool),
        outcome: result.outcome,
        code: result.code,
        requestKinds: result.requestKinds,
        events: result.events,
        unverified: result.unverified,
        ms,
      });
    }
    return result;
  };

  let beat = 0;
  // One cursor per scripted player, so three players each say their own next
  // line. A single index shared across them would hand the Cleric the
  // Fighter's words the moment initiative put them in a different order.
  const intentCursor = new Map<CharacterId, number>();
  const totalBeats = options.rounds * encounter.roster.length;

  while (beat < totalBeats) {
    const state = session.state();
    const who = activeIn(state);
    if (who === null) break;
    // The fight is over when any side has nobody left standing.
    if (encounter.sides.some((side) => !side.some((member) => alive(state, member)))) break;

    beat += 1;
    recorder.beat(beat, state.combat?.round ?? 1);

    const script = encounter.intents.get(who);
    let intent: string | undefined;
    if (script !== undefined) {
      const at = intentCursor.get(who) ?? 0;
      intent = script[at];
      intentCursor.set(who, at + 1);
    }

    const turnsBefore = state.combat?.turnsTaken ?? 0;
    let turn = await driver.beat(promptFor(state, who, intent), state);
    recorder.modelTurn({
      ms: turn.ms,
      promptTokens: turn.promptTokens,
      completionTokens: turn.completionTokens,
      cachedTokens: turn.cachedTokens,
      stopReason: turn.stopReason,
      text: turn.text,
    });

    for (let exchange = 0; exchange < options.maxExchangesPerBeat; exchange += 1) {
      if (turn.calls.length === 0) break;

      const replies = turn.calls.map((call) => {
        const result = perform(call.name, call.input, false);
        return {
          id: call.id,
          content: JSON.stringify({ ...result.body, state: observe(session.state()) }),
        };
      });

      // The turn moved on: whatever else the model wanted to say, this beat is
      // over and the next creature is up. The results still go back — they are
      // what the model reads at the start of its next beat, and a tool call
      // left unanswered makes every later request malformed.
      const lastExchange = (session.state().combat?.turnsTaken ?? 0) > turnsBefore;

      turn = await driver.replies(replies, session.state(), !lastExchange);
      if (lastExchange) break;
      recorder.modelTurn({
        ms: turn.ms,
        promptTokens: turn.promptTokens,
        completionTokens: turn.completionTokens,
        cachedTokens: turn.cachedTokens,
        stopReason: turn.stopReason,
        text: turn.text,
      });
    }

    // The cap bounds a *beat*, not a conversation. A batch the loop stopped
    // before dispatching is still an assistant message with tool calls on it,
    // and leaving those unanswered makes every later request malformed — the
    // provider rejects the *next* beat with an error about a message thirty
    // turns back. Tier 1 never used all eight exchanges and so never found
    // this; Tier 2's first live run died on it inside round one.
    //
    // They are answered and **not** executed. The harness has already decided
    // this beat is over, and running one more mutation after deciding that
    // would be the apparatus taking a turn.
    if (turn.calls.length > 0) {
      await driver.replies(
        turn.calls.map((call) => ({
          id: call.id,
          content: JSON.stringify({
            outcome: 'not-dispatched',
            reason: 'the harness ended this beat at its exchange cap; this call was not executed',
          }),
        })),
        session.state(),
        false,
      );
    }

    // Unfinished: the model stopped, or ran out of exchanges, without ending
    // the turn. Recorded as such — `analyse` sees no successful `end_turn` for
    // this beat — and then moved past so the rest of the run is still measured.
    if ((session.state().combat?.turnsTaken ?? 0) === turnsBefore) {
      interventions += 1;
      perform('end_turn', { command_id: `harness-${beat}` }, true);
      // A turn the engine refuses to end is a debt somebody owes. Settling it
      // is not something the harness may invent, so the run stops here rather
      // than pretending.
      if ((session.state().combat?.turnsTaken ?? 0) === turnsBefore) break;
    }
  }

  const log = session.log();
  const determinism = checkDeterminism(encounter.seed, log, opening, transcript, narration);

  return {
    analysis: analyse(recorder),
    determinism,
    log,
    transcript,
    narration,
    interventions,
    finalState: fold(encounter.seed, log),
  };
}

/**
 * The four questions the doctrine's invariants 2, 3 and 4 turn into here.
 *
 * The fourth is the one this experiment adds: replaying the *model's calls*
 * through a fresh table must rebuild the same log. Folding the log twice only
 * proves the reducer is a function; re-dispatching proves the tool surface
 * introduced no decision of its own between the model and the engine.
 */
function checkDeterminism(
  seed: string,
  log: readonly GameEvent[],
  opening: readonly GameEvent[],
  transcript: readonly TranscriptEntry[],
  narration: readonly string[],
): DeterminismReport {
  const foldsIdentically = JSON.stringify(fold(seed, log)) === JSON.stringify(fold(seed, log));

  const under = (s: string) => JSON.stringify({ ...fold(s, log), seed: '' });
  const seedIndependent = under(seed) === under('a completely different seed');

  const revived = JSON.parse(JSON.stringify(log)) as GameEvent[];
  const survivesJson = JSON.stringify(fold(seed, revived)) === JSON.stringify(fold(seed, log));

  const replayed = replay(seed, opening, transcript, narration.length);
  const transcriptReplays = JSON.stringify(replayed) === JSON.stringify(log);

  return { foldsIdentically, seedIndependent, survivesJson, transcriptReplays };
}

/**
 * Re-issue a recorded run's calls against a fresh table.
 *
 * Takes the opening log rather than rebuilding it, because the opening
 * contains rolled Initiative and a replay must not reroll — the same rule the
 * event log itself follows. Everything after that is the surface doing exactly
 * what it did the first time, or not.
 */
export function replay(
  seed: string,
  opening: readonly GameEvent[],
  transcript: readonly TranscriptEntry[],
  _narrationCount: number,
): readonly GameEvent[] {
  const session = createSession(seed, opening);
  const narration: string[] = [];
  for (const entry of transcript) {
    dispatch(session, entry.tool, entry.input, { narration });
  }
  return session.log();
}
