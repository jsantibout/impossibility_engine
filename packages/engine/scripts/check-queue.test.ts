/**
 * The queue validator, driven over fixtures rather than trusted.
 *
 * `docs/dev/check-queue.mjs` is the first thing a fresh session reads, and it
 * had no test of its own. That is how a stray `U+0008` — written where a `\b`
 * was meant — sat inside its `WHOLE_ENGINE_AUDIT_RECOMMENDED` regex from the
 * day the flag was written: the regex demanded a backspace after the flag, so
 * it matched nothing, so **the one signal the manual-audit design leaves the
 * foreman was invisible to every fresh session**. Nothing failed. The summary
 * simply never mentioned it, which looks exactly like there being nothing to
 * mention.
 *
 * A guard nobody has watched fire is the class of failure this tranche has now
 * met three times, and the remedy is always the same: a case where the signal
 * is present, a case where it is absent, and a mutation that tells them apart.
 *
 * ### Fixtures, not the real queue
 *
 * Every case builds a throwaway `docs/dev` — a `QUEUE.md` and a `tasks/`
 * directory — in a temporary directory. The real queue is the foreman's file
 * and its contents change with every merge, so a test that asserted anything
 * about it would be asserting today's development state and would go red for
 * reasons that have nothing to do with the validator. What *is* asserted about
 * the real queue is that running with no arguments still reaches it and still
 * prints the summary, because that CLI shape is what a fresh session depends
 * on.
 *
 * ### It runs the command, rather than importing a piece of it
 *
 * `spawnSync` on the script itself exercises the exit code as well as the
 * output — and the exit code is half of what the validator is for. The one
 * change that made this possible is an optional directory argument; with none,
 * the script is exactly what it was.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const VALIDATOR = fileURLToPath(new URL('../../../docs/dev/check-queue.mjs', import.meta.url));

/** A task file the validator has no complaint about. */
const VALID_TASK = [
  '# IE-001 — A fixture task',
  '',
  'state: APPROVED_FOR_IMPLEMENTATION',
  'lane: tooling',
  'tranche: 1',
  'parallel-safe: YES — a fixture',
  'depends-on: none',
  'worker: none',
  'approved: 2026-09-14 — "APPROVE TRANCHE 1"',
  'merge-approved: none',
  '',
].join('\n');

/** A queue whose single tranche authorises that task. */
const queueWith = (audit: string): string =>
  [
    '# Development queue',
    '',
    '## Tranches',
    '',
    '### Tranche 1 — APPROVED 2026-09-14 — "APPROVE TRANCHE 1"',
    'roster: IE-001',
    '',
    '## Now',
    '',
    '- IE-001 — a fixture task',
    '',
    '## Audit',
    '',
    audit,
    '',
  ].join('\n');

interface Run {
  readonly status: number | null;
  readonly stdout: string;
}

/** Build a throwaway `docs/dev`, validate it, and throw the fixture away. */
function validate(queue: string, tasks: Record<string, string>): Run {
  const dev = mkdtempSync(join(tmpdir(), 'ie-023-queue-'));
  try {
    mkdirSync(join(dev, 'tasks'));
    writeFileSync(join(dev, 'QUEUE.md'), queue, 'utf8');
    for (const [name, text] of Object.entries(tasks)) {
      writeFileSync(join(dev, 'tasks', name), text, 'utf8');
    }
    const run = spawnSync(process.execPath, [VALIDATOR, dev], { encoding: 'utf8' });
    return { status: run.status, stdout: run.stdout };
  } finally {
    rmSync(dev, { recursive: true, force: true });
  }
}

describe('check-queue', () => {
  it('prints the audit flag when the queue carries it', () => {
    const run = validate(queueWith('WHOLE_ENGINE_AUDIT_RECOMMENDED — the evidence goes here'), {
      'IE-001-fixture.md': VALID_TASK,
    });
    expect(run.stdout).toContain(
      'Audit: WHOLE_ENGINE_AUDIT_RECOMMENDED — see QUEUE.md for the evidence',
    );
    // The fixture is otherwise clean, so the flag is a signal rather than a
    // complaint — and a fixture the validator rejected would prove nothing
    // about the flag.
    expect(run.stdout).toContain('Problems: none');
    expect(run.status).toBe(0);
  });

  it('says nothing about an audit when the queue does not ask for one', () => {
    const run = validate(queueWith('No audit is recommended.'), {
      'IE-001-fixture.md': VALID_TASK,
    });
    expect(run.stdout).not.toContain('Audit:');
    expect(run.stdout).toContain('Problems: none');
    expect(run.status).toBe(0);
  });

  it('reports a malformed task file rather than skipping it', () => {
    const run = validate(queueWith('No audit is recommended.'), {
      'IE-001-fixture.md': VALID_TASK,
      'IE-002-malformed.md': '## Not a task heading\n\nstate: IMPLEMENTING\n',
    });
    expect(run.stdout).toContain('IE-002-malformed.md: first line must be "# IE-NNN — Title"');
    expect(run.status).toBe(1);
  });

  it('summarises the tranche that holds the merge authority', () => {
    const run = validate(queueWith('No audit is recommended.'), {
      'IE-001-fixture.md': VALID_TASK,
    });
    expect(run.stdout).toContain('IE-001 (APPROVED_FOR_IMPLEMENTATION)');
    expect(run.stdout).toContain('Merge authority in force: tranche 1');
  });

  /**
   * The CLI shape a fresh session depends on: no arguments, the real queue.
   * Deliberately no claim about *what* it finds there — that is the foreman's
   * file, and pinning its contents here would make this test a second copy of
   * the development state.
   */
  it('still reads the real queue with no arguments', () => {
    const run = spawnSync(process.execPath, [VALIDATOR], { encoding: 'utf8' });
    expect(run.stdout).toContain('Development queue —');
    expect(run.stdout).toContain('Merge authority in force:');
    expect(run.status === 0 || run.status === 1).toBe(true);
  });
});

/**
 * ### Tranche closure, and why it is a rule rather than a habit
 *
 * Tranche 6 was declared complete over a live task. IE-042 was approved, never
 * launched, still read `APPROVED_FOR_IMPLEMENTATION` — and the closing report
 * said thirteen of thirteen delivered when twelve were `DONE`. The validator
 * had been printing IE-042 on its own line *and* again on the tranche line in
 * every summary for the whole tranche, and it was read past twelve times. An
 * attention rule that has already failed twelve times is not a fix, so the
 * closure is refused by the tool here.
 *
 * The second half is the one that is easy to get backwards. Once closing over
 * a live task is refused, the cheapest way to close a tranche becomes *deleting
 * the id from the roster* — which is quieter than the bug being fixed, because
 * a deleted entry is visible nowhere at all. So a deferral is recorded on both
 * rosters: the closing tranche keeps the id and says where it went, the
 * receiving tranche says where it came from, and half of that pair is a
 * problem. Deferring is two annotations and no deletion; erasing means taking
 * an id off a roster the owner approved, and it buys nothing, because the
 * shipped count is derived from the task states either way.
 */

/** A task file with the fields a case wants to vary. */
function task(id: string, fields: Readonly<Record<string, string | undefined>>): string {
  const done = fields.state === 'DONE';
  return [
    `# ${id} — A fixture task`,
    '',
    `state: ${fields.state}`,
    'lane: tooling',
    `tranche: ${fields.tranche}`,
    'parallel-safe: YES — a fixture',
    'depends-on: none',
    `worker: ${fields.worker ?? 'none'}`,
    `approved: ${fields.approved ?? '2026-09-14 — "APPROVE THE TRANCHE"'}`,
    `merge-approved: ${fields['merge-approved'] ?? (done ? '2026-09-14 — "APPROVE THE TRANCHE"' : 'none')}`,
    '',
  ].join('\n');
}

/** A queue whose tranche block is exactly the lines given. */
const queueOf = (...tranches: readonly string[]): string =>
  ['# Development queue', '', '## Tranches', '', ...tranches, '', '## Now', '', 'No audit is recommended.', ''].join(
    '\n',
  );

const heading = (n: number, status: string): string =>
  `### Tranche ${n} — ${status} 2026-09-14 — "APPROVE THE TRANCHE"`;

/** Every state that is not `DONE` — the full set a closing tranche must refuse. */
const LIVE_STATES = [
  'PROPOSED',
  'OWNER_APPROVAL_REQUIRED',
  'APPROVED_FOR_IMPLEMENTATION',
  'IMPLEMENTING',
  'ARCHITECTURE_BLOCKED',
  'AWAITING_FOREMAN_REVIEW',
  'CHANGES_REQUIRED',
  'OWNER_DECISION_REQUIRED',
  'AWAITING_MERGE_APPROVAL',
] as const;

const NEEDS_A_WORKER = new Set([
  'IMPLEMENTING',
  'ARCHITECTURE_BLOCKED',
  'AWAITING_FOREMAN_REVIEW',
  'CHANGES_REQUIRED',
]);

describe('check-queue: a tranche cannot close over a live task', () => {
  /** The tranche 6 shape exactly: one task shipped, one still approved. */
  const tranche6Shape = (state: string): Run =>
    validate(queueOf(heading(6, 'COMPLETE'), 'roster: IE-041, IE-042'), {
      'IE-041-shipped.md': task('IE-041', { state: 'DONE', tranche: '6' }),
      'IE-042-live.md': task('IE-042', {
        state,
        tranche: '6',
        worker: NEEDS_A_WORKER.has(state) ? 'qb-builder' : 'none',
        approved: state === 'PROPOSED' || state === 'OWNER_APPROVAL_REQUIRED' ? 'none' : undefined,
      }),
    });

  it('rejects the tranche 6 regression, naming the task and its state', () => {
    const run = tranche6Shape('APPROVED_FOR_IMPLEMENTATION');
    expect(run.stdout).toContain(
      'docs/dev/QUEUE.md (tranche 6): COMPLETE but IE-042 is APPROVED_FOR_IMPLEMENTATION',
    );
    expect(run.status).toBe(1);
  });

  it('tells the foreman how to record the deferral rather than delete the id', () => {
    expect(tranche6Shape('APPROVED_FOR_IMPLEMENTATION').stdout).toContain(
      'record the deferral as "IE-042 (deferred → tranche N)" on this roster',
    );
  });

  it.each(LIVE_STATES)('rejects a COMPLETE tranche holding a %s task', (state) => {
    const run = tranche6Shape(state);
    expect(run.stdout).toContain(`docs/dev/QUEUE.md (tranche 6): COMPLETE but IE-042 is ${state}`);
    expect(run.status).toBe(1);
  });

  it('accepts the same tranche once the task is DONE', () => {
    const run = tranche6Shape('DONE');
    expect(run.stdout).toContain('Problems: none');
    expect(run.status).toBe(0);
  });

  /**
   * `LIVE_STATES` is a copy of the validator's closed set minus `DONE`, and a
   * copy is a claim nothing checks: a tenth state added over there would leave
   * the table above silently one case short. The validator names its own set in
   * the message it prints for an unknown state, so the copy is pinned against
   * it rather than against memory.
   */
  it('covers every state the validator knows, so a new one cannot slip past the table', () => {
    const run = validate(queueOf(heading(6, 'APPROVED'), 'roster: IE-041'), {
      'IE-041-bogus.md': task('IE-041', { state: 'NOT_A_STATE', tranche: '6' }),
    });
    const named = run.stdout.match(/state "NOT_A_STATE" is not one of (.+)$/m);
    expect(named).not.toBeNull();
    expect(named?.[1]?.split(', ')).toEqual([...LIVE_STATES, 'DONE']);
  });

  it('leaves an APPROVED tranche with live tasks alone — that is the running state', () => {
    const run = validate(queueOf(heading(6, 'APPROVED'), 'roster: IE-041, IE-042'), {
      'IE-041-shipped.md': task('IE-041', { state: 'DONE', tranche: '6' }),
      'IE-042-live.md': task('IE-042', { state: 'APPROVED_FOR_IMPLEMENTATION', tranche: '6' }),
    });
    expect(run.stdout).toContain('Problems: none');
    expect(run.stdout).toContain('→ 1 outstanding');
    expect(run.status).toBe(0);
  });
});

describe('check-queue: a deferral is recorded on both rosters', () => {
  /** Tranche 6 closes; IE-042 is deferred into tranche 7 and is still live there. */
  const deferred = (closing: string, receiving: string): Run =>
    validate(
      queueOf(heading(6, 'COMPLETE'), `roster: ${closing}`, '', heading(7, 'APPROVED'), `roster: ${receiving}`),
      {
        'IE-041-shipped.md': task('IE-041', { state: 'DONE', tranche: '6' }),
        'IE-042-deferred.md': task('IE-042', { state: 'APPROVED_FOR_IMPLEMENTATION', tranche: '7' }),
      },
    );

  it('accepts a deferral marked on both rosters', () => {
    const run = deferred('IE-041, IE-042 (deferred → tranche 7)', 'IE-042 (deferred from tranche 6)');
    expect(run.stdout).toContain('Problems: none');
    expect(run.status).toBe(0);
  });

  it('accepts the ASCII arrow too', () => {
    const run = deferred('IE-041, IE-042 (deferred -> tranche 7)', 'IE-042 (deferred from tranche 6)');
    expect(run.stdout).toContain('Problems: none');
    expect(run.status).toBe(0);
  });

  it('counts the deferred task as deferred rather than shipped', () => {
    const run = deferred('IE-041, IE-042 (deferred → tranche 7)', 'IE-042 (deferred from tranche 6)');
    expect(run.stdout).toContain('Tranche 6  COMPLETE  2 rostered → 1 shipped, 1 deferred');
    expect(run.stdout).toContain('deferred (1): IE-042 → tranche 7');
    expect(run.stdout).not.toContain('2 shipped');
  });

  it('refuses the outgoing half alone — the receiving roster must say where it came from', () => {
    const run = deferred('IE-041, IE-042 (deferred → tranche 7)', 'IE-042');
    expect(run.stdout).toContain(
      'docs/dev/QUEUE.md (tranche 6): IE-042 is deferred to tranche 7, whose roster does not record it as "IE-042 (deferred from tranche 6)"',
    );
    expect(run.status).toBe(1);
  });

  it('refuses the incoming half alone — a roster entry may not be deleted to close a tranche', () => {
    const run = deferred('IE-041', 'IE-042 (deferred from tranche 6)');
    expect(run.stdout).toContain(
      'docs/dev/QUEUE.md (tranche 7): IE-042 records a deferral from tranche 6, whose roster does not name it — a roster entry may not be deleted to close a tranche',
    );
    expect(run.status).toBe(1);
  });

  it('refuses a deferral whose task file still claims the closing tranche', () => {
    const run = validate(
      queueOf(
        heading(6, 'COMPLETE'),
        'roster: IE-041, IE-042 (deferred → tranche 7)',
        '',
        heading(7, 'APPROVED'),
        'roster: IE-053',
      ),
      {
        'IE-041-shipped.md': task('IE-041', { state: 'DONE', tranche: '6' }),
        'IE-042-deferred.md': task('IE-042', { state: 'APPROVED_FOR_IMPLEMENTATION', tranche: '6' }),
        'IE-053-other.md': task('IE-053', { state: 'APPROVED_FOR_IMPLEMENTATION', tranche: '7' }),
      },
    );
    expect(run.stdout).toContain(
      'docs/dev/QUEUE.md (tranche 6): IE-042 is marked deferred to tranche 7 but its task file still says "tranche: 6"',
    );
    expect(run.status).toBe(1);
  });

  it('refuses a deferral to a tranche QUEUE.md does not define', () => {
    const run = validate(queueOf(heading(6, 'COMPLETE'), 'roster: IE-041, IE-042 (deferred → tranche 9)'), {
      'IE-041-shipped.md': task('IE-041', { state: 'DONE', tranche: '6' }),
      'IE-042-deferred.md': task('IE-042', { state: 'APPROVED_FOR_IMPLEMENTATION', tranche: '9' }),
    });
    expect(run.stdout).toContain(
      'docs/dev/QUEUE.md (tranche 6): IE-042 is deferred to tranche 9, which QUEUE.md does not define',
    );
    expect(run.status).toBe(1);
  });

  it('accepts a deferral with no destination yet, and says so in the count', () => {
    const run = validate(queueOf(heading(6, 'COMPLETE'), 'roster: IE-041, IE-042 (deferred)'), {
      'IE-041-shipped.md': task('IE-041', { state: 'DONE', tranche: '6' }),
      'IE-042-deferred.md': task('IE-042', { state: 'PROPOSED', tranche: 'none', approved: 'none' }),
    });
    expect(run.stdout).toContain('deferred (1): IE-042 → unrostered');
    expect(run.stdout).toContain('Problems: none');
    expect(run.status).toBe(0);
  });

  it('refuses a bare deferral for a task that has quietly joined another tranche', () => {
    const run = validate(
      queueOf(
        heading(6, 'COMPLETE'),
        'roster: IE-041, IE-042 (deferred)',
        '',
        heading(7, 'APPROVED'),
        'roster: IE-042',
      ),
      {
        'IE-041-shipped.md': task('IE-041', { state: 'DONE', tranche: '6' }),
        'IE-042-deferred.md': task('IE-042', { state: 'APPROVED_FOR_IMPLEMENTATION', tranche: '7' }),
      },
    );
    expect(run.stdout).toContain(
      'docs/dev/QUEUE.md (tranche 6): IE-042 is marked deferred with no destination, but its task file says "tranche: 7" — write "(deferred → tranche 7)" so the move is recorded on both rosters',
    );
    expect(run.status).toBe(1);
  });

  it('refuses an annotation it does not recognise rather than reading past it', () => {
    const run = validate(queueOf(heading(6, 'COMPLETE'), 'roster: IE-041, IE-042 (moved to 7)'), {
      'IE-041-shipped.md': task('IE-041', { state: 'DONE', tranche: '6' }),
      'IE-042-deferred.md': task('IE-042', { state: 'APPROVED_FOR_IMPLEMENTATION', tranche: '6' }),
    });
    expect(run.stdout).toContain(
      'docs/dev/QUEUE.md (tranche 6): roster entry IE-042 carries "(moved to 7)", which is not a deferral',
    );
    expect(run.status).toBe(1);
  });
});

/**
 * A second slip has to be representable, or the fix reintroduces the bug. If
 * tranche 7 could say where IE-042 came from *or* where it went but not both,
 * then deferring it onward to tranche 8 would leave the queue red with no legal
 * spelling — and the cheapest way back to green would be deleting the tranche 6
 * marker, which is exactly the erasure the two-sided record exists to prevent.
 */
describe('check-queue: a task can be deferred twice', () => {
  /** 6 → 7 → 8, with tranche 7 carrying both halves on one entry. */
  const chain = (middle: string): Run =>
    validate(
      queueOf(
        heading(6, 'COMPLETE'),
        'roster: IE-041, IE-042 (deferred → tranche 7)',
        '',
        heading(7, 'COMPLETE'),
        `roster: IE-043, ${middle}`,
        '',
        heading(8, 'APPROVED'),
        'roster: IE-042 (deferred from tranche 7)',
      ),
      {
        'IE-041-shipped.md': task('IE-041', { state: 'DONE', tranche: '6' }),
        'IE-043-shipped.md': task('IE-043', { state: 'DONE', tranche: '7' }),
        'IE-042-deferred.md': task('IE-042', { state: 'APPROVED_FOR_IMPLEMENTATION', tranche: '8' }),
      },
    );

  it('accepts a 6 → 7 → 8 chain recorded on every roster it passed through', () => {
    const run = chain('IE-042 (deferred from tranche 6 → tranche 8)');
    expect(run.stdout).toContain('Problems: none');
    expect(run.status).toBe(0);
  });

  it('keeps the chained counts derived — each tranche reports what it did with the task', () => {
    const run = chain('IE-042 (deferred from tranche 6 → tranche 8)');
    expect(run.stdout).toContain('Tranche 6  COMPLETE  2 rostered → 1 shipped, 1 deferred');
    expect(run.stdout).toContain('deferred (1): IE-042 → tranche 7');
    expect(run.stdout).toContain('Tranche 7  COMPLETE  2 rostered → 1 shipped, 1 deferred');
    expect(run.stdout).toContain('deferred (1): IE-042 → tranche 8');
    // Passing through tranche 7 is not shipping it, in either tranche.
    expect(run.stdout).not.toContain('2 shipped');
  });

  /**
   * A file carries exactly one tranche, so only the end of a chain can be
   * checked against it — the intermediate links are covered by their own
   * reciprocals. A task that stopped at tranche 7 while tranche 7 claims to
   * have passed it on is still caught, which is what makes that split safe.
   */
  it('refuses a chain whose task file never reached the end of it', () => {
    const run = validate(
      queueOf(
        heading(6, 'COMPLETE'),
        'roster: IE-041, IE-042 (deferred → tranche 7)',
        '',
        heading(7, 'COMPLETE'),
        'roster: IE-043, IE-042 (deferred from tranche 6 → tranche 8)',
        '',
        heading(8, 'APPROVED'),
        'roster: IE-042 (deferred from tranche 7)',
      ),
      {
        'IE-041-shipped.md': task('IE-041', { state: 'DONE', tranche: '6' }),
        'IE-043-shipped.md': task('IE-043', { state: 'DONE', tranche: '7' }),
        'IE-042-deferred.md': task('IE-042', { state: 'APPROVED_FOR_IMPLEMENTATION', tranche: '7' }),
      },
    );
    expect(run.stdout).toContain(
      'docs/dev/QUEUE.md (tranche 7): IE-042 is marked deferred to tranche 8 but its task file still says "tranche: 7"',
    );
    expect(run.status).toBe(1);
  });

  it('still refuses a chain whose middle link forgets where the task came from', () => {
    const run = chain('IE-042 (deferred → tranche 8)');
    expect(run.stdout).toContain(
      'docs/dev/QUEUE.md (tranche 6): IE-042 is deferred to tranche 7, whose roster does not record it as "IE-042 (deferred from tranche 6)"',
    );
    expect(run.status).toBe(1);
  });

  it('still refuses a chain whose middle link forgets where the task went', () => {
    const run = chain('IE-042 (deferred from tranche 6)');
    expect(run.stdout).toContain(
      'docs/dev/QUEUE.md (tranche 8): IE-042 records a deferral from tranche 7, whose roster does not record it as "IE-042 (deferred → tranche 8)"',
    );
    // Tranche 7 has not let it go, so tranche 7 may not close over it either.
    expect(run.stdout).toContain('docs/dev/QUEUE.md (tranche 7): COMPLETE but IE-042 is APPROVED_FOR_IMPLEMENTATION');
    expect(run.status).toBe(1);
  });
});

describe('check-queue: the closing counts are derived, not written', () => {
  it('reports two shipped and one deferred rather than three delivered', () => {
    const run = validate(
      queueOf(
        heading(6, 'COMPLETE'),
        'roster: IE-041, IE-043, IE-042 (deferred → tranche 7)',
        '',
        heading(7, 'APPROVED'),
        'roster: IE-042 (deferred from tranche 6)',
      ),
      {
        'IE-041-shipped.md': task('IE-041', { state: 'DONE', tranche: '6' }),
        'IE-043-shipped.md': task('IE-043', { state: 'DONE', tranche: '6' }),
        'IE-042-deferred.md': task('IE-042', { state: 'APPROVED_FOR_IMPLEMENTATION', tranche: '7' }),
      },
    );
    expect(run.stdout).toContain('Tranche 6  COMPLETE  3 rostered → 2 shipped, 1 deferred');
    expect(run.stdout).toContain('shipped (2): IE-041, IE-043');
    expect(run.stdout).toContain('deferred (1): IE-042 → tranche 7');
    expect(run.stdout).not.toContain('3 shipped');
    expect(run.status).toBe(0);
  });

  it('counts a live task as live rather than folding it into the shipped number', () => {
    const run = validate(queueOf(heading(6, 'COMPLETE'), 'roster: IE-041, IE-042'), {
      'IE-041-shipped.md': task('IE-041', { state: 'DONE', tranche: '6' }),
      'IE-042-live.md': task('IE-042', { state: 'APPROVED_FOR_IMPLEMENTATION', tranche: '6' }),
    });
    expect(run.stdout).toContain('Tranche 6  COMPLETE  2 rostered → 1 shipped, 0 deferred, 1 STILL LIVE');
    expect(run.stdout).toContain('live (1): IE-042 (APPROVED_FOR_IMPLEMENTATION)');
  });
});
