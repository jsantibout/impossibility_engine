/**
 * What the experiment actually measures.
 *
 * The recorder is deliberately dumb: it writes down every call and every model
 * turn as they happen and derives nothing until the run is over. Classifying
 * as you go means the classification can be wrong about a turn that has not
 * finished yet — whether a refusal was a dead end depends on what the model
 * does next, and "next" has not happened.
 *
 * **Wall-clock and token counts live here and nowhere else.** The engine may
 * not read a clock; this is not the engine. That separation is why latency can
 * be measured at all without putting `Date.now()` anywhere near a fold.
 */

import type { CallOutcome } from './surface.js';

export interface CallRecord {
  /** Which beat of the fight this call belongs to. */
  readonly beat: number;
  /** Whose turn it was, as far as the engine was concerned. */
  readonly turnOf: string | null;
  readonly tool: string;
  readonly input: unknown;
  readonly mutating: boolean;
  readonly outcome: CallOutcome;
  readonly code: string | null;
  readonly requestKinds: readonly string[];
  readonly events: number;
  readonly unverified: readonly string[];
  /** Milliseconds the engine call itself took. */
  readonly ms: number;
}

export interface ModelTurnRecord {
  readonly beat: number;
  readonly ms: number;
  readonly promptTokens: number | null;
  readonly completionTokens: number | null;
  readonly cachedTokens: number | null;
  readonly stopReason: string | null;
  /** Any prose the model produced alongside its tool calls. */
  readonly text: string;
}

export interface Recorder {
  beat(n: number): void;
  call(record: Omit<CallRecord, 'beat'>): void;
  modelTurn(record: Omit<ModelTurnRecord, 'beat'>): void;
  readonly calls: readonly CallRecord[];
  readonly turns: readonly ModelTurnRecord[];
}

export function createRecorder(): Recorder {
  const calls: CallRecord[] = [];
  const turns: ModelTurnRecord[] = [];
  let current = 0;
  return {
    beat(n) {
      current = n;
    },
    call(record) {
      calls.push({ ...record, beat: current });
    },
    modelTurn(record) {
      turns.push({ ...record, beat: current });
    },
    calls,
    turns,
  };
}

// — derivation, once the run is over ————————————————————————————————————————

/**
 * A refusal code the engine gives when a mechanic simply is not modelled.
 *
 * Kept as a list rather than a predicate over the message because the point is
 * to be able to say "this many turns hit a wall the engine does not intend to
 * have", and a fuzzy match would quietly absorb ordinary rules refusals into
 * that number. Anything not on this list that the model could not recover from
 * still shows up, under `unrecovered`, so nothing hides.
 */
const UNMODELLED_CODES: ReadonlySet<string> = new Set([
  'no_definition',
  'unknown_item',
  'unsupported',
  'not_supported',
  'long_casting_time',
  'unknown_tool',
]);

/** Facts the fixture could have declared before play instead of being asked. */
const PREDECLARABLE: ReadonlySet<string> = new Set([
  'position',
  'visibility',
  'creature-type',
  'scene',
]);

export interface BeatSummary {
  readonly beat: number;
  readonly turnOf: string | null;
  readonly calls: number;
  readonly mutating: number;
  readonly queries: number;
  /** Calls that only told the players something. Not mechanical, still a round trip. */
  readonly narration: number;
  readonly refusals: number;
  readonly needsContext: number;
  readonly invalid: number;
  /** True if the beat ended with the turn actually being ended. */
  readonly completed: boolean;
  /** A refusal on a mechanic the engine does not model, never recovered from. */
  readonly deadEnd: boolean;
}

export interface Analysis {
  readonly beats: readonly BeatSummary[];
  /** Every call in order, so a reader can see what the prose was built on. */
  readonly calls: readonly CallRecord[];
  readonly totalCalls: number;
  readonly mutatingCalls: number;
  readonly queryCalls: number;
  readonly callsPerBeat: { readonly median: number; readonly max: number; readonly mean: number };
  readonly refusalsByCode: ReadonlyMap<string, number>;
  readonly needsContextByKind: ReadonlyMap<string, number>;
  readonly needsContextPredeclarable: number;
  readonly invalidByReason: ReadonlyMap<string, number>;
  /** Identical (tool, input) sent more than once — a retry, wanted or not. */
  readonly duplicateCalls: number;
  /** Queries whose answer the previous result already contained. */
  readonly redundantQueries: number;
  /** A `needs-context` of the same kind and subject asked three times or more. */
  readonly contextLoops: readonly string[];
  readonly unmodelledHits: number;
  readonly deadEnds: number;
  readonly unrecovered: readonly string[];
  readonly unverified: readonly string[];
  readonly tokens: {
    readonly prompt: number;
    readonly completion: number;
    readonly cached: number;
  };
  readonly latency: {
    readonly modelMs: number;
    readonly engineMs: number;
    readonly modelTurns: number;
  };
}

const median = (xs: readonly number[]): number => {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

const tally = (values: readonly string[]): ReadonlyMap<string, number> => {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return new Map([...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
};

export function analyse(recorder: Recorder): Analysis {
  const calls = recorder.calls;
  const beatNumbers = [...new Set(calls.map((c) => c.beat))].sort((a, b) => a - b);

  const beats: BeatSummary[] = beatNumbers.map((beat) => {
    const own = calls.filter((c) => c.beat === beat);
    const completed = own.some((c) => c.tool === 'end_turn' && c.outcome === 'ok');
    const unmodelled = own.filter(
      (c) => c.outcome !== 'ok' && c.code !== null && UNMODELLED_CODES.has(c.code),
    );
    // A dead end is an unmodelled refusal the model never got past *within the
    // beat*: the distinction that matters is not whether it was refused but
    // whether the turn still happened.
    const recovered = unmodelled.length === 0 || own.some((c) => c.outcome === 'ok' && c.mutating);
    return {
      beat,
      turnOf: own[0]?.turnOf ?? null,
      calls: own.length,
      mutating: own.filter((c) => c.mutating).length,
      queries: own.filter((c) => !c.mutating && c.tool !== 'narrate').length,
      narration: own.filter((c) => c.tool === 'narrate').length,
      refusals: own.filter((c) => c.outcome === 'refusal').length,
      needsContext: own.filter((c) => c.outcome === 'needs-context').length,
      invalid: own.filter((c) => c.outcome === 'invalid').length,
      completed,
      deadEnd: unmodelled.length > 0 && !recovered,
    };
  });

  // A retry: the same tool with byte-identical arguments, sent again. Some are
  // legitimate (the engine makes them no-ops by command id); all of them cost
  // a round trip, which is the thing being counted.
  const seen = new Set<string>();
  let duplicateCalls = 0;
  for (const c of calls) {
    const key = `${c.tool}:${JSON.stringify(c.input)}`;
    if (seen.has(key)) duplicateCalls += 1;
    seen.add(key);
  }

  // A query asked immediately after another call that already returned the
  // same observation. `look` is the pure case: every result carries state, so
  // asking for state is never necessary.
  let redundantQueries = 0;
  calls.forEach((c, i) => {
    if (c.mutating) return;
    if (c.tool === 'look' && i > 0) redundantQueries += 1;
  });

  const contextAsks = calls.flatMap((c) =>
    c.requestKinds.map((kind) => `${kind}:${JSON.stringify(c.input)}`),
  );
  const contextLoops = [...tally(contextAsks)]
    .filter(([, n]) => n >= 3)
    .map(([key]) => key);

  const unrecovered = beats.filter((b) => !b.completed).map((b) => `beat ${b.beat} (${b.turnOf ?? 'unknown'})`);

  const modelMs = recorder.turns.reduce((sum, t) => sum + t.ms, 0);
  const engineMs = calls.reduce((sum, c) => sum + c.ms, 0);

  return {
    beats,
    calls,
    totalCalls: calls.length,
    mutatingCalls: calls.filter((c) => c.mutating).length,
    queryCalls: calls.filter((c) => !c.mutating).length,
    callsPerBeat: {
      median: median(beats.map((b) => b.calls)),
      max: beats.reduce((m, b) => Math.max(m, b.calls), 0),
      mean: beats.length === 0 ? 0 : calls.length / beats.length,
    },
    refusalsByCode: tally(
      calls.filter((c) => c.outcome === 'refusal' && c.code !== null).map((c) => c.code!),
    ),
    needsContextByKind: tally(calls.flatMap((c) => c.requestKinds)),
    needsContextPredeclarable: calls
      .flatMap((c) => c.requestKinds)
      .filter((k) => PREDECLARABLE.has(k)).length,
    invalidByReason: tally(
      calls.filter((c) => c.outcome === 'invalid' && c.code !== null).map((c) => c.code!),
    ),
    duplicateCalls,
    redundantQueries,
    contextLoops,
    unmodelledHits: calls.filter(
      (c) => c.outcome !== 'ok' && c.code !== null && UNMODELLED_CODES.has(c.code),
    ).length,
    deadEnds: beats.filter((b) => b.deadEnd).length,
    unrecovered,
    unverified: [...new Set(calls.flatMap((c) => c.unverified))],
    tokens: {
      prompt: recorder.turns.reduce((s, t) => s + (t.promptTokens ?? 0), 0),
      completion: recorder.turns.reduce((s, t) => s + (t.completionTokens ?? 0), 0),
      cached: recorder.turns.reduce((s, t) => s + (t.cachedTokens ?? 0), 0),
    },
    latency: { modelMs, engineMs, modelTurns: recorder.turns.length },
  };
}

// — the report ——————————————————————————————————————————————————————————————

/**
 * Whether the run met the criteria that were written down before it ran.
 *
 * Pre-registered in the README. Grading after the fact is how an experiment
 * becomes a demonstration.
 */
export interface Verdict {
  readonly name: string;
  readonly passed: boolean;
  readonly detail: string;
}

export interface DeterminismReport {
  readonly foldsIdentically: boolean;
  readonly seedIndependent: boolean;
  readonly survivesJson: boolean;
  readonly transcriptReplays: boolean;
}

export function verdicts(analysis: Analysis, determinism: DeterminismReport): readonly Verdict[] {
  return [
    {
      name: 'every beat completed',
      passed: analysis.unrecovered.length === 0,
      detail:
        analysis.unrecovered.length === 0
          ? 'every turn the model was given ended through the engine'
          : `unfinished: ${analysis.unrecovered.join(', ')}`,
    },
    {
      name: 'median calls per beat <= 6',
      passed: analysis.callsPerBeat.median <= 6,
      detail: `median ${analysis.callsPerBeat.median}, max ${analysis.callsPerBeat.max}`,
    },
    {
      name: 'no beat over 10 calls',
      passed: analysis.callsPerBeat.max <= 10,
      detail: `max ${analysis.callsPerBeat.max}`,
    },
    {
      name: 'no needs-context loop',
      passed: analysis.contextLoops.length === 0,
      detail:
        analysis.contextLoops.length === 0
          ? 'no fact was asked for three times'
          : `${analysis.contextLoops.length} repeated request(s)`,
    },
    {
      name: 'state folds deterministically',
      passed: determinism.foldsIdentically && determinism.seedIndependent && determinism.survivesJson,
      detail: `fold ${determinism.foldsIdentically}, seed-independent ${determinism.seedIndependent}, json ${determinism.survivesJson}`,
    },
    {
      name: 'transcript replays byte-identically',
      passed: determinism.transcriptReplays,
      detail: determinism.transcriptReplays
        ? 'replaying the recorded calls rebuilt the same log'
        : 'the replayed log differed',
    },
  ];
}

const table = (rows: readonly (readonly string[])[]): string => {
  if (rows.length === 0) return '_(none)_\n';
  const head = rows[0]!;
  const body = rows.slice(1);
  return [
    `| ${head.join(' | ')} |`,
    `|${head.map(() => '---').join('|')}|`,
    ...body.map((r) => `| ${r.join(' | ')} |`),
  ].join('\n');
};

export function report(
  title: string,
  analysis: Analysis,
  determinism: DeterminismReport,
  extras: { readonly model: string; readonly events: number },
): string {
  const checks = verdicts(analysis, determinism);
  const lines: string[] = [];

  lines.push(`# ${title}`, '');
  lines.push(`Model: \`${extras.model}\`. ${extras.events} events written to the authoritative log.`, '');

  lines.push('## Pre-registered criteria', '');
  lines.push(
    table([
      ['Criterion', 'Result', 'Detail'],
      ...checks.map((c) => [c.name, c.passed ? 'PASS' : 'FAIL', c.detail]),
    ]),
    '',
  );

  lines.push('## Calls per player turn', '');
  lines.push(
    table([
      ['Beat', 'Turn of', 'Calls', 'Mutating', 'Queries', 'Narration', 'Refusals', 'needs-context', 'Invalid', 'Turn ended'],
      ...analysis.beats.map((b) => [
        String(b.beat),
        b.turnOf ?? '-',
        String(b.calls),
        String(b.mutating),
        String(b.queries),
        String(b.narration),
        String(b.refusals),
        String(b.needsContext),
        String(b.invalid),
        b.completed ? 'yes' : `**no**${b.deadEnd ? ' (dead end)' : ''}`,
      ]),
    ]),
    '',
  );
  lines.push(
    `Total ${analysis.totalCalls} calls — ${analysis.mutatingCalls} mutating, ${analysis.queryCalls} query. ` +
      `Median ${analysis.callsPerBeat.median} per beat, mean ${analysis.callsPerBeat.mean.toFixed(1)}, max ${analysis.callsPerBeat.max}.`,
    '',
  );

  lines.push('## Refusals', '');
  lines.push(
    table([
      ['Code', 'Count'],
      ...[...analysis.refusalsByCode].map(([code, n]) => [`\`${code}\``, String(n)]),
    ]),
    '',
  );

  lines.push('## needs-context', '');
  lines.push(
    table([
      ['Kind', 'Count', 'Could have been pre-declared'],
      ...[...analysis.needsContextByKind].map(([kind, n]) => [
        `\`${kind}\``,
        String(n),
        PREDECLARABLE.has(kind) ? 'yes' : 'no',
      ]),
    ]),
    '',
  );
  lines.push(
    `${analysis.needsContextPredeclarable} of ${[...analysis.needsContextByKind.values()].reduce((a, b) => a + b, 0)} requests were for facts a scene-setup discipline could have established before play.`,
    '',
  );

  lines.push('## Malformed and repeated calls', '');
  lines.push(
    table([
      ['Measure', 'Count'],
      ['malformed or unknown-tool calls', String([...analysis.invalidByReason.values()].reduce((a, b) => a + b, 0))],
      ['identical calls repeated', String(analysis.duplicateCalls)],
      ['redundant state queries', String(analysis.redundantQueries)],
    ]),
    '',
  );
  if (analysis.invalidByReason.size > 0) {
    lines.push(
      table([
        ['Reason', 'Count'],
        ...[...analysis.invalidByReason].map(([r, n]) => [`\`${r}\``, String(n)]),
      ]),
      '',
    );
  }

  lines.push('## Unmodelled mechanics', '');
  lines.push(
    `${analysis.unmodelledHits} call(s) hit a mechanic the engine does not model; ${analysis.deadEnds} beat(s) became a dead end.`,
    '',
  );

  lines.push('## What the engine could not check', '');
  lines.push(
    analysis.unverified.length === 0
      ? '_Nothing: every rule that applied was applied._\n'
      : analysis.unverified.map((u) => `- ${u}`).join('\n') + '\n',
  );

  lines.push('## Cost', '');
  lines.push(
    table([
      ['Measure', 'Value'],
      ['model turns', String(analysis.latency.modelTurns)],
      ['model wall-clock', `${(analysis.latency.modelMs / 1000).toFixed(1)} s`],
      ['engine wall-clock', `${analysis.latency.engineMs.toFixed(0)} ms`],
      ['prompt tokens', String(analysis.tokens.prompt)],
      ['of which cached', String(analysis.tokens.cached)],
      ['completion tokens', String(analysis.tokens.completion)],
    ]),
    '',
  );

  // The mechanics and the prose, side by side, per turn.
  //
  // Printed together because the most important thing this experiment found is
  // only visible when they are: a model asked to shove a goblin into a hearth
  // called `attack` with no weapon — an Unarmed Strike — and then narrated that
  // "the impact doesn't drive it into the hearth". No rule was broken and no
  // number was invented. A *different mechanic* was resolved, and the prose
  // covered the join. A report listing the calls on one page and the narration
  // on another would hide exactly that.
  lines.push('## What was called, and what the players were told', '');
  for (const beat of analysis.beats) {
    const own = analysis.calls.filter((c) => c.beat === beat.beat);
    const mechanics = own
      .filter((c) => c.tool !== 'narrate')
      .map((c) => `\`${c.tool}\`${c.outcome === 'ok' ? '' : ` → ${c.outcome}: ${c.code ?? ''}`}`)
      .join(' · ');
    lines.push(
      `**Beat ${beat.beat} (${beat.turnOf ?? '-'})** — ${mechanics === '' ? '_no mechanical call_' : mechanics}`,
    );
    for (const call of own.filter((c) => c.tool === 'narrate')) {
      const text = (call.input as { text?: unknown }).text;
      if (typeof text === 'string') lines.push('', `> ${text}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
