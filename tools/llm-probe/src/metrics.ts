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
  /** Which combat round that beat fell in. */
  readonly round: number;
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
  readonly round: number;
  readonly ms: number;
  readonly promptTokens: number | null;
  readonly completionTokens: number | null;
  readonly cachedTokens: number | null;
  readonly stopReason: string | null;
  /** Any prose the model produced alongside its tool calls. */
  readonly text: string;
}

export interface Recorder {
  beat(n: number, round: number): void;
  call(record: Omit<CallRecord, 'beat' | 'round'>): void;
  modelTurn(record: Omit<ModelTurnRecord, 'beat' | 'round'>): void;
  readonly calls: readonly CallRecord[];
  readonly turns: readonly ModelTurnRecord[];
}

export function createRecorder(): Recorder {
  const calls: CallRecord[] = [];
  const turns: ModelTurnRecord[] = [];
  let current = 0;
  // The round is stamped on the way in rather than worked out afterwards. With
  // four actors a round is four beats, with three it is three, and with a
  // creature dropping mid-fight it is neither — so dividing the beat number by
  // a roster length would be arithmetic that quietly stops being true exactly
  // when the fight gets interesting.
  let round = 1;
  return {
    beat(n, at) {
      current = n;
      round = at;
    },
    call(record) {
      calls.push({ ...record, beat: current, round });
    },
    modelTurn(record) {
      turns.push({ ...record, beat: current, round });
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
  readonly round: number;
  /** What this one turn cost the model, in tokens and in wall-clock. */
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly cachedTokens: number;
  readonly modelMs: number;
  readonly engineMs: number;
  readonly modelTurns: number;
}

/** A whole round of the initiative order, which is what a table experiences. */
export interface RoundSummary {
  readonly round: number;
  readonly beats: number;
  readonly calls: number;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly modelMs: number;
}

/**
 * Whether a longer fight costs more per turn, or only more turns.
 *
 * The distinction is the whole of the Tier 2 performance question. A driver
 * that appends to one conversation pays for every earlier turn again on the
 * next request, so per-beat prompt tokens rising *linearly* is the expected
 * and survivable shape — it is what "the context grows by one turn" looks
 * like. What would not be survivable is the rise accelerating, which is what
 * `superlinear` names.
 *
 * Reported with the raw series beside it, because a three-word classification
 * of sixteen numbers is a summary and the reader should be able to check it.
 */
export interface GrowthReport {
  /** Prompt tokens for each beat, in order. */
  readonly promptPerBeat: readonly number[];
  readonly firstHalfMean: number;
  readonly secondHalfMean: number;
  /** Least-squares tokens added per additional beat. */
  readonly slopePerBeat: number;
  readonly shape: 'flat' | 'linear' | 'superlinear' | 'insufficient-data';
}

export interface Analysis {
  readonly beats: readonly BeatSummary[];
  readonly rounds: readonly RoundSummary[];
  readonly growth: GrowthReport;
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

/**
 * Classify a per-beat prompt-token series.
 *
 * Deliberately crude and deliberately stated: two halves and a least-squares
 * slope, no curve fitting. The question being asked is not "what function is
 * this" but "is the per-turn bill stable enough that a longer fight is only a
 * longer fight", and three coarse answers are enough to decide that. The raw
 * series is reported alongside so the classification can be disagreed with.
 *
 * A run with no token counts at all — the offline stand-in — is
 * `insufficient-data` rather than `flat`, because zero growth measured from
 * zero data is not a finding.
 */
export function growthOf(promptPerBeat: readonly number[]): GrowthReport {
  const empty = promptPerBeat.every((n) => n === 0);
  if (promptPerBeat.length < 4 || empty) {
    return {
      promptPerBeat,
      firstHalfMean: 0,
      secondHalfMean: 0,
      slopePerBeat: 0,
      shape: 'insufficient-data',
    };
  }

  const mean = (xs: readonly number[]): number =>
    xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
  const half = Math.floor(promptPerBeat.length / 2);
  const firstHalfMean = mean(promptPerBeat.slice(0, half));
  const secondHalfMean = mean(promptPerBeat.slice(half));

  // Least squares over (index, tokens).
  const n = promptPerBeat.length;
  const meanX = (n - 1) / 2;
  const meanY = mean(promptPerBeat);
  let num = 0;
  let den = 0;
  promptPerBeat.forEach((y, i) => {
    num += (i - meanX) * (y - meanY);
    den += (i - meanX) ** 2;
  });
  const slopePerBeat = den === 0 ? 0 : num / den;

  // Does the *rise* itself rise? Compare the slope of each half. A conversation
  // that appends one turn per beat rises by a roughly constant amount; one that
  // re-sends a growing state on top of a growing conversation does not.
  const slopeOf = (xs: readonly number[]): number =>
    xs.length < 2 ? 0 : (xs[xs.length - 1]! - xs[0]!) / (xs.length - 1);
  const early = slopeOf(promptPerBeat.slice(0, half));
  const late = slopeOf(promptPerBeat.slice(half));

  let shape: GrowthReport['shape'];
  if (firstHalfMean > 0 && secondHalfMean / firstHalfMean <= 1.25) shape = 'flat';
  else if (early > 0 && late > early * 1.5) shape = 'superlinear';
  else shape = 'linear';

  return { promptPerBeat, firstHalfMean, secondHalfMean, slopePerBeat, shape };
}

export function analyse(recorder: Recorder): Analysis {
  const calls = recorder.calls;

  // Beats with no call at all still happened and still cost a model turn, so
  // the beat list is the union of what was called and what was asked — not the
  // calls alone. A turn the model spent thinking and then ended by saying
  // nothing is exactly the beat a cost measurement must not drop.
  const allBeats = [
    ...new Set([...calls.map((c) => c.beat), ...recorder.turns.map((t) => t.beat)]),
  ].sort((a, b) => a - b);

  const beats: BeatSummary[] = allBeats.map((beat) => {
    const own = calls.filter((c) => c.beat === beat);
    const asked = recorder.turns.filter((t) => t.beat === beat);
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
      round: own[0]?.round ?? asked[0]?.round ?? 0,
      promptTokens: asked.reduce((n, t) => n + (t.promptTokens ?? 0), 0),
      completionTokens: asked.reduce((n, t) => n + (t.completionTokens ?? 0), 0),
      cachedTokens: asked.reduce((n, t) => n + (t.cachedTokens ?? 0), 0),
      modelMs: asked.reduce((n, t) => n + t.ms, 0),
      engineMs: own.reduce((n, c) => n + c.ms, 0),
      modelTurns: asked.length,
    };
  });

  const rounds: RoundSummary[] = [...new Set(beats.map((b) => b.round))]
    .sort((a, b) => a - b)
    .map((round) => {
      const own = beats.filter((b) => b.round === round);
      return {
        round,
        beats: own.length,
        calls: own.reduce((n, b) => n + b.calls, 0),
        promptTokens: own.reduce((n, b) => n + b.promptTokens, 0),
        completionTokens: own.reduce((n, b) => n + b.completionTokens, 0),
        modelMs: own.reduce((n, b) => n + b.modelMs, 0),
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
    rounds,
    growth: growthOf(beats.map((b) => b.promptTokens)),
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


// — money ——————————————————————————————————————————————————————————————————

/**
 * What a token costs, in US dollars per million.
 *
 * **A parameter, never a constant.** The probe cannot know what the account
 * was billed and a hard-coded rate would turn a stale price into a finding.
 * Every report states the rate it used beside the number it produced, so a
 * reader with a different rate can rescale the whole table and a reader with
 * none can ignore it and read the token counts instead.
 */
export interface Pricing {
  readonly inputPerMTok: number;
  /** A cached prompt token is billed at a discount by every provider here. */
  readonly cachedInputPerMTok: number;
  readonly outputPerMTok: number;
}

export interface Cost {
  readonly total: number;
  readonly perCompletedBeat: number;
  readonly perRound: number;
  readonly pricing: Pricing;
}

export function costOf(analysis: Analysis, pricing: Pricing): Cost {
  // Cached tokens are billed *instead of*, not on top of, so the uncached
  // remainder is what the full rate applies to. Counting the prompt total at
  // full rate and adding the cached ones again would bill the same token twice.
  const cached = analysis.tokens.cached;
  const fresh = Math.max(0, analysis.tokens.prompt - cached);
  const total =
    (fresh * pricing.inputPerMTok +
      cached * pricing.cachedInputPerMTok +
      analysis.tokens.completion * pricing.outputPerMTok) /
    1_000_000;
  const completed = analysis.beats.filter((b) => b.completed).length;
  return {
    total,
    perCompletedBeat: completed === 0 ? 0 : total / completed,
    perRound: analysis.rounds.length === 0 ? 0 : total / analysis.rounds.length,
    pricing,
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
  extras: {
    readonly model: string;
    readonly events: number;
    readonly pricing?: Pricing | undefined;
  },
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

  lines.push('## Calls per actor turn', '');
  lines.push(
    table([
      [
        'Beat',
        'Round',
        'Turn of',
        'Calls',
        'Mutating',
        'Queries',
        'Narration',
        'Refusals',
        'needs-context',
        'Invalid',
        'Prompt tok',
        'Cached',
        'Out tok',
        'Model s',
        'Turn ended',
      ],
      ...analysis.beats.map((b) => [
        String(b.beat),
        String(b.round),
        b.turnOf ?? '-',
        String(b.calls),
        String(b.mutating),
        String(b.queries),
        String(b.narration),
        String(b.refusals),
        String(b.needsContext),
        String(b.invalid),
        String(b.promptTokens),
        String(b.cachedTokens),
        String(b.completionTokens),
        (b.modelMs / 1000).toFixed(1),
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

  lines.push('## Per combat round', '');
  lines.push(
    table([
      ['Round', 'Actor turns', 'Calls', 'Calls/turn', 'Prompt tok', 'Out tok', 'Model s'],
      ...analysis.rounds.map((r) => [
        String(r.round),
        String(r.beats),
        String(r.calls),
        r.beats === 0 ? '-' : (r.calls / r.beats).toFixed(1),
        String(r.promptTokens),
        String(r.completionTokens),
        (r.modelMs / 1000).toFixed(1),
      ]),
    ]),
    '',
  );

  // The Tier 2 question, and the reason the series is printed rather than
  // summarised: whether a longer fight costs more per turn or only more turns.
  lines.push('## Does the per-turn bill grow?', '');
  const g = analysis.growth;
  lines.push(
    table([
      ['Measure', 'Value'],
      ['prompt tokens per beat', g.promptPerBeat.join(', ')],
      ['mean over the first half', g.firstHalfMean.toFixed(0)],
      ['mean over the second half', g.secondHalfMean.toFixed(0)],
      ['least-squares tokens added per beat', g.slopePerBeat.toFixed(0)],
      ['shape', `**${g.shape}**`],
    ]),
    '',
  );

  if (extras.pricing !== undefined) {
    const money = costOf(analysis, extras.pricing);
    const completed = analysis.beats.filter((b) => b.completed).length;
    lines.push('## Cost in money', '');
    lines.push(
      table([
        ['Measure', 'Value'],
        ['total', `$${money.total.toFixed(4)}`],
        [`per completed actor turn (${completed})`, `$${money.perCompletedBeat.toFixed(4)}`],
        [`per combat round (${analysis.rounds.length})`, `$${money.perRound.toFixed(4)}`],
      ]),
      '',
    );
    lines.push(
      `At $${extras.pricing.inputPerMTok.toFixed(2)} / $${extras.pricing.cachedInputPerMTok.toFixed(2)} / $${extras.pricing.outputPerMTok.toFixed(2)} per million input / cached input / output tokens. ` +
        'That rate is an input to this report, not a fact it discovered — rescale from the token counts above if it is wrong.',
      '',
    );
  }

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
