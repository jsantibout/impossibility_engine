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
