#!/usr/bin/env node
/**
 * Validates the development queue: docs/dev/QUEUE.md and every task file
 * under docs/dev/tasks/.
 *
 * A representation without a validator is the failure this repository keeps
 * finding elsewhere, so the closed state set and the gate records are checked
 * here rather than trusted. It cannot stop a foreman writing a false approval
 * line — nothing can — but it makes every gate record visible and every
 * malformed one loud.
 *
 * Since V2 it also checks the thing that replaced the per-task merge button:
 * the **tranche roster**. The owner approves a bounded set of tasks once, and
 * that approval is the merge authority for exactly those tasks. So a task may
 * not execute unless it is on the roster of an approved tranche, a roster
 * entry may not name a task that does not exist, and the two may not disagree
 * about which tranche a task is in. Adding a task to an approved tranche is
 * the one way autonomy could quietly widen, and it is now loud.
 *
 * Since V3 it also refuses a tranche that **closes over a live task**. Tranche
 * 6 was declared complete while IE-042 still read `APPROVED_FOR_IMPLEMENTATION`,
 * and the closing report said thirteen of thirteen delivered when twelve were
 * `DONE`. This validator had printed IE-042 on its own line *and* again on the
 * tranche line in every summary of that tranche, and it was read past twelve
 * times: an attention rule that has already failed twelve times is not a fix,
 * so `COMPLETE` is now refused rather than reported.
 *
 * That leaves one trap, and avoiding it is most of the design. Once closing
 * over a live task is refused, the cheapest way to close a tranche becomes
 * *deleting the id from the roster* — which is quieter than the bug being
 * fixed, because a deleted entry is visible nowhere at all. So a tranche may
 * also close over a task that is **recorded as deferred**, and a deferral is
 * written on both rosters:
 *
 *   ### Tranche 6 — COMPLETE …
 *   roster: IE-036, …, IE-042 (deferred → tranche 7)
 *
 *   ### Tranche 7 — APPROVED …
 *   roster: IE-042 (deferred from tranche 6), IE-050, …
 *
 * Half of that pair is a problem, so removing either half is loud, and the
 * task file itself moves cleanly to its new tranche — one tranche per file,
 * unchanged — while the closing roster still shows the miss rather than
 * erasing it. `(deferred)` with no destination is allowed for a task that has
 * left the queue's tranches entirely; it is refused the moment the task file
 * claims another tranche, because that is a move and a move is recorded.
 *
 * A task deferred *twice* records both halves on one entry — tranche 7 writes
 * `IE-042 (deferred from tranche 6 → tranche 8)` — because a second slip that
 * had no legal spelling would leave deleting the tranche 6 marker as the only
 * way back to a green queue, which is the failure this whole rule exists to
 * prevent. Arrival and departure are independent facts about one entry.
 *
 * The closing counts are then **derived**: a `COMPLETE` tranche prints how
 * many shipped, how many were deferred and where to, and — until the tranche
 * is legal — how many are still live. The one number the foreman got wrong on
 * tranche 6 was the one it typed, so it is no longer typed.
 *
 *   node docs/dev/check-queue.mjs            the real queue
 *   node docs/dev/check-queue.mjs <dir>      a directory shaped like docs/dev
 *
 * Prints the summary a fresh session reads first, lists every problem with
 * the file it is in, and exits 1 if there is one. Never edits anything.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The directory holding QUEUE.md and tasks/. With no argument it is this
// script's own — `node docs/dev/check-queue.mjs` is what a fresh session runs
// and what the workflow documents, and that is unchanged. A path may be given
// instead, which is the only way to drive the validator over a fixture queue
// and watch a signal fire rather than assume it does: the flag that says a
// broad audit is recommended went unprinted for as long as it existed, because
// nothing had ever run this against a queue that carried one.
const DEV = process.argv[2] ?? dirname(fileURLToPath(import.meta.url));
const TASKS = join(DEV, 'tasks');
const QUEUE = join(DEV, 'QUEUE.md');

const STATES = [
  'PROPOSED',
  'OWNER_APPROVAL_REQUIRED',
  'APPROVED_FOR_IMPLEMENTATION',
  'IMPLEMENTING',
  'ARCHITECTURE_BLOCKED',
  'AWAITING_FOREMAN_REVIEW',
  'CHANGES_REQUIRED',
  'OWNER_DECISION_REQUIRED',
  'AWAITING_MERGE_APPROVAL',
  'DONE',
];
const BEFORE_GATE_1 = new Set(['PROPOSED', 'OWNER_APPROVAL_REQUIRED']);
const HELD_BY_A_BUILDER = new Set([
  'IMPLEMENTING',
  'ARCHITECTURE_BLOCKED',
  'AWAITING_FOREMAN_REVIEW',
  'CHANGES_REQUIRED',
]);
const LANES = new Set(['mechanism', 'content', 'conformance', 'tooling', 'docs']);
const FIELDS = ['state', 'lane', 'tranche', 'parallel-safe', 'depends-on', 'worker', 'approved', 'merge-approved'];
const TRANCHE_STATES = ['PROPOSED', 'APPROVED', 'COMPLETE'];
const DATE = /\b\d{4}-\d{2}-\d{2}\b/;
const QUOTED = /"[^"]+"/;
const ID = /\bIE-\d{3}\b/g;
// A roster entry is an id, optionally annotated with where the task came from,
// where it went, or both — a task deferred twice needs one entry to say both
// halves, or the only green spelling of a second slip would be the erasure
// this rule exists to prevent. Anything else in the brackets is refused rather
// than read past: a misspelled marker that silently degraded to a plain entry
// would be the same class of silence.
//
//   (deferred)                            left this tranche, nowhere yet
//   (deferred → tranche 8)                left this tranche for tranche 8
//   (deferred from tranche 6)             arrived here from tranche 6
//   (deferred from tranche 6 → tranche 8) arrived from 6, and left again for 8
const DEFERRAL = /^deferred(?:\s+from\s+tranche\s+(\d+))?(?:\s*(?:→|->)\s*tranche\s+(\d+))?$/;

const problems = [];
const problem = (file, text) => problems.push(`${file}: ${text}`);

function parseTask(name) {
  const text = readFileSync(join(TASKS, name), 'utf8');
  const title = text.match(/^# (IE-\d{3}) — (.+)$/m);
  const fields = {};
  for (const line of text.split('\n').slice(0, 40)) {
    const m = line.match(/^([a-z-]+):\s*(.*)$/);
    if (m && FIELDS.includes(m[1])) fields[m[1]] = m[2].trim();
  }
  return { name, id: title?.[1], title: title?.[2], fields };
}

function checkTask(task, known) {
  const { name, id, fields } = task;
  if (id === undefined) {
    problem(name, 'first line must be "# IE-NNN — Title"');
    return;
  }
  if (!name.startsWith(id)) problem(name, `file name must start with ${id}`);
  for (const field of FIELDS) {
    if (fields[field] === undefined) problem(name, `missing header line "${field}:"`);
  }
  const state = fields.state ?? '';
  if (!STATES.includes(state)) problem(name, `state "${state}" is not one of ${STATES.join(', ')}`);
  if (fields.lane !== undefined && !LANES.has(fields.lane)) {
    problem(name, `lane "${fields.lane}" is not one of ${[...LANES].join(', ')}`);
  }
  if (fields.tranche !== undefined && !/^(none|\d+)$/.test(fields.tranche)) {
    problem(name, `tranche "${fields.tranche}" must be "none" or a number`);
  }
  if (fields['parallel-safe'] !== undefined && !/^(YES|NO|CONDITIONAL)\b/.test(fields['parallel-safe'])) {
    problem(name, 'parallel-safe must start with YES, NO or CONDITIONAL');
  }
  const approved = fields.approved ?? 'none';
  const mergeApproved = fields['merge-approved'] ?? 'none';
  const worker = fields.worker ?? 'none';
  if (BEFORE_GATE_1.has(state)) {
    if (approved !== 'none') problem(name, `state ${state} but an approval is recorded — a gate was crossed on paper`);
  } else if (STATES.includes(state)) {
    if (!DATE.test(approved) || !QUOTED.test(approved)) {
      problem(name, `state ${state} needs "approved: YYYY-MM-DD — \\"<owner's words>\\"" (Gate 1)`);
    }
  }
  if (state === 'DONE' && (!DATE.test(mergeApproved) || !QUOTED.test(mergeApproved))) {
    problem(
      name,
      'DONE needs "merge-approved: YYYY-MM-DD — \\"<owner\'s words>\\"" — the tranche approval it merged under, or an exceptional Gate 3',
    );
  }
  if (state !== 'DONE' && mergeApproved !== 'none') {
    problem(name, `state ${state} but a merge approval is recorded`);
  }
  if (HELD_BY_A_BUILDER.has(state) && worker === 'none') {
    problem(name, `state ${state} but no worker is recorded`);
  }
  if (!HELD_BY_A_BUILDER.has(state) && state !== 'AWAITING_MERGE_APPROVAL' && state !== 'OWNER_DECISION_REQUIRED' && worker !== 'none') {
    problem(name, `state ${state} but a worker is still recorded`);
  }
  const deps = fields['depends-on'] ?? 'none';
  if (deps !== 'none') {
    for (const dep of deps.match(ID) ?? []) {
      if (!known.has(dep)) problem(name, `depends on ${dep}, which has no task file`);
    }
    if ((deps.match(ID) ?? []).length === 0) problem(name, 'depends-on must be "none" or a list of IE-NNN ids');
  }
}

/**
 * A roster line, as entries rather than as bare ids. An annotated entry records
 * where the task came `from`, where it went `to`, or both, and `out` — whether
 * this tranche let it go — is what decides whether the tranche still owns it.
 *
 *   kind 'plain'    IE-005
 *   kind 'deferral' IE-042 (deferred from tranche 6 → tranche 8)
 *   kind 'unknown'  IE-042 (anything else)
 *
 * `out` is true unless the note is purely an arrival: a bare `(deferred)` is a
 * departure with no destination yet, and every form carrying an arrow is a
 * departure too, including the one that also records an arrival.
 */
function parseRoster(text) {
  const entries = [];
  for (const m of text.matchAll(/\b(IE-\d{3})\b(?:\s*\(([^)]*)\))?/g)) {
    const [, id, raw] = m;
    if (raw === undefined) {
      entries.push({ id, kind: 'plain' });
      continue;
    }
    const note = raw.trim();
    const deferral = note.match(DEFERRAL);
    if (deferral === null) {
      entries.push({ id, kind: 'unknown', note });
      continue;
    }
    const from = deferral[1] === undefined ? undefined : Number(deferral[1]);
    const to = deferral[2] === undefined ? undefined : Number(deferral[2]);
    entries.push({ id, kind: 'deferral', from, to, out: to !== undefined || from === undefined, note });
  }
  return entries;
}

/** The roster entry a tranche holds for an id, if it holds one. */
const entryFor = (tranche, id) => tranche?.roster.find((e) => e.id === id);

/** Where a deferral sent a task, for a human reading the summary. */
const destination = (entry) => (entry.to === undefined ? 'unrostered' : `tranche ${entry.to}`);

/**
 * Tranches live in QUEUE.md, because no task file can hold what the owner
 * approved as one act. The shape is a heading and a roster line:
 *
 *   ### Tranche 2 — APPROVED 2026-09-14 — "APPROVE TRANCHE 2"
 *   roster: IE-005, IE-006, IE-002
 */
function parseTranches(queue) {
  const tranches = new Map();
  let current = null;
  for (const line of queue.split('\n')) {
    const heading = line.match(/^###\s+Tranche\s+(\d+)\s+—\s+(\S+)(.*)$/);
    if (heading !== null) {
      const n = Number(heading[1]);
      if (tranches.has(n)) problem('docs/dev/QUEUE.md', `two headings claim tranche ${n}`);
      current = { n, status: heading[2], authority: heading[3].trim(), roster: [], sawRoster: false };
      tranches.set(n, current);
      continue;
    }
    if (/^##\s/.test(line)) current = null;
    if (current === null) continue;
    const roster = line.match(/^roster:\s*(.*)$/);
    if (roster !== null) {
      current.sawRoster = true;
      current.roster = parseRoster(roster[1]);
    }
  }
  return tranches;
}

/**
 * The outgoing half: `IE-042 (deferred → tranche 7)` on the tranche letting go.
 *
 * The task file must have actually moved — a deferral marker over a task still
 * claiming this tranche is a claim nothing backs — and the receiving roster
 * must carry the matching incoming half, so that deleting either one is loud.
 */
function checkDeferral(tranche, entry, claimed, tranches, where) {
  const { id, to } = entry;
  // Whatever the destination, a deferred task has left. A marker over a task
  // whose file still claims this tranche is a claim nothing backs.
  if (claimed === String(tranche.n)) {
    problem(
      where,
      `${id} is marked deferred${to === undefined ? '' : ` to tranche ${to}`} but its task file still says "tranche: ${tranche.n}"`,
    );
    return;
  }
  if (to === undefined) {
    if (claimed !== 'none') {
      problem(
        where,
        `${id} is marked deferred with no destination, but its task file says "tranche: ${claimed}" — write "(deferred → tranche ${claimed})" so the move is recorded on both rosters`,
      );
    }
    return;
  }
  if (to === tranche.n) {
    problem(where, `${id} is deferred to tranche ${to}, which is the tranche deferring it`);
    return;
  }
  const target = tranches.get(to);
  if (target === undefined) {
    problem(where, `${id} is deferred to tranche ${to}, which QUEUE.md does not define`);
    return;
  }
  const back = entryFor(target, id);
  if (back === undefined || back.kind !== 'deferral' || back.from !== tranche.n) {
    problem(
      where,
      `${id} is deferred to tranche ${to}, whose roster does not record it as "${id} (deferred from tranche ${tranche.n})" — a deferral is recorded on both rosters, so that deleting either half is loud`,
    );
    return;
  }
  // Only the *end* of a chain can be checked against the task file, because a
  // file carries exactly one tranche: a task deferred 6 → 7 → 8 claims 8, and
  // tranche 6's link is verified by tranche 7's reciprocal rather than by the
  // file. Every intermediate link is checked the same way, so the chain is
  // covered end to end without any of it being taken on trust.
  if (!back.out && claimed !== String(to)) {
    problem(where, `${id} is marked deferred to tranche ${to} but its task file says "tranche: ${claimed}"`);
  }
}

/**
 * The incoming half: `IE-042 (deferred from tranche 6)` on the tranche picking
 * it up. This is the check that makes erasure loud — the source roster has to
 * still name the task, and still say where it sent it.
 */
function checkDeferralSource(tranche, entry, tranches, where) {
  const { id, from } = entry;
  const source = tranches.get(from);
  if (source === undefined) {
    problem(where, `${id} records a deferral from tranche ${from}, which QUEUE.md does not define`);
    return;
  }
  const out = entryFor(source, id);
  if (out === undefined) {
    problem(
      where,
      `${id} records a deferral from tranche ${from}, whose roster does not name it — a roster entry may not be deleted to close a tranche`,
    );
    return;
  }
  if (out.kind !== 'deferral' || !out.out || out.to !== tranche.n) {
    problem(
      where,
      `${id} records a deferral from tranche ${from}, whose roster does not record it as "${id} (deferred → tranche ${tranche.n})"`,
    );
  }
}

function checkTranches(tranches, tasks, known) {
  const byId = new Map(tasks.filter((t) => t.id !== undefined).map((t) => [t.id, t]));
  for (const tranche of tranches.values()) {
    const where = `docs/dev/QUEUE.md (tranche ${tranche.n})`;
    if (!TRANCHE_STATES.includes(tranche.status)) {
      problem(where, `status "${tranche.status}" is not one of ${TRANCHE_STATES.join(', ')}`);
    }
    if (tranche.status === 'APPROVED' || tranche.status === 'COMPLETE') {
      if (!DATE.test(tranche.authority) || !QUOTED.test(tranche.authority)) {
        problem(where, `${tranche.status} needs the owner's words: "— ${tranche.status} YYYY-MM-DD — \\"<owner's words>\\""`);
      }
    } else if (DATE.test(tranche.authority) && QUOTED.test(tranche.authority)) {
      problem(where, 'PROPOSED but an approval is recorded — a gate was crossed on paper');
    }
    if (!tranche.sawRoster) problem(where, 'needs a "roster: IE-NNN, …" line naming exactly the tasks it authorises');
    else if (tranche.roster.length === 0) problem(where, 'roster is empty');
    for (const entry of tranche.roster) {
      const { id } = entry;
      if (!known.has(id)) {
        problem(where, `roster names ${id}, which has no task file`);
        continue;
      }
      if (entry.kind === 'unknown') {
        problem(
          where,
          `roster entry ${id} carries "(${entry.note})", which is not a deferral — write "(deferred → tranche M)" or "(deferred from tranche M)"`,
        );
      }
      const claimed = byId.get(id)?.fields.tranche;
      // Arrival and departure are independent: a task deferred into a tranche
      // and out of it again carries both halves on the one entry.
      if (entry.kind === 'deferral' && entry.from !== undefined) {
        checkDeferralSource(tranche, entry, tranches, where);
      }
      if (entry.kind === 'deferral' && entry.out) {
        checkDeferral(tranche, entry, claimed, tranches, where);
        continue;
      }
      if (claimed !== String(tranche.n)) {
        problem(where, `roster names ${id}, whose task file says "tranche: ${claimed}"`);
      }
    }
    // A tranche cannot close over a live task. Every roster entry is either
    // shipped or recorded as deferred; anything else is the tranche 6 bug.
    if (tranche.status === 'COMPLETE') {
      for (const entry of tranche.roster) {
        if (entry.kind === 'deferral' && entry.out) continue;
        const state = byId.get(entry.id)?.fields.state;
        if (state === undefined || state === 'DONE') continue;
        problem(
          where,
          `COMPLETE but ${entry.id} is ${state} — a tranche cannot close over a live task; finish it, or record the deferral as "${entry.id} (deferred → tranche N)" on this roster`,
        );
      }
    }
  }

  for (const task of tasks) {
    if (task.id === undefined) continue;
    const state = task.fields.state ?? '';
    const claimed = task.fields.tranche ?? 'none';
    if (claimed === 'none') {
      if (!BEFORE_GATE_1.has(state) && STATES.includes(state)) {
        problem(task.name, `state ${state} but "tranche: none" — nothing executes outside an approved tranche`);
      }
      if (state === 'OWNER_APPROVAL_REQUIRED') {
        problem(task.name, 'OWNER_APPROVAL_REQUIRED but "tranche: none" — a task is presented as part of a tranche');
      }
      continue;
    }
    const tranche = tranches.get(Number(claimed));
    if (tranche === undefined) {
      problem(task.name, `claims tranche ${claimed}, which QUEUE.md does not define`);
      continue;
    }
    if (entryFor(tranche, task.id) === undefined) {
      problem(
        task.name,
        `claims tranche ${claimed} but is not on its roster — a task may not be added to a tranche the owner approved`,
      );
    }
    if (state === 'PROPOSED') {
      problem(task.name, `PROPOSED but rostered in tranche ${claimed} — a rostered task is briefed and presented`);
    }
    if (state === 'OWNER_APPROVAL_REQUIRED' && tranche.status !== 'PROPOSED') {
      problem(task.name, `OWNER_APPROVAL_REQUIRED but tranche ${claimed} is ${tranche.status}`);
    }
    if (!BEFORE_GATE_1.has(state) && STATES.includes(state) && tranche.status === 'PROPOSED') {
      problem(task.name, `state ${state} but tranche ${claimed} has not been approved — that is the merge authority`);
    }
  }
}

function main() {
  let names = [];
  try {
    names = readdirSync(TASKS).filter((n) => n.endsWith('.md')).sort();
  } catch {
    problem('docs/dev/tasks', 'directory is missing');
  }
  const tasks = names.map(parseTask);
  const known = new Set(tasks.map((t) => t.id).filter((id) => id !== undefined));
  const duplicates = tasks.map((t) => t.id).filter((id, i, all) => id !== undefined && all.indexOf(id) !== i);
  for (const dup of new Set(duplicates)) problem('docs/dev/tasks', `two task files claim ${dup}`);
  for (const task of tasks) checkTask(task, known);

  let queue = '';
  try {
    queue = readFileSync(QUEUE, 'utf8');
  } catch {
    problem('docs/dev/QUEUE.md', 'file is missing');
  }
  const mentioned = new Set(queue.match(ID) ?? []);
  for (const id of mentioned) {
    if (!known.has(id)) problem('docs/dev/QUEUE.md', `mentions ${id}, which has no task file`);
  }
  for (const task of tasks) {
    if (task.id !== undefined && task.fields.state !== 'DONE' && !mentioned.has(task.id)) {
      problem('docs/dev/QUEUE.md', `does not mention ${task.id} (${task.fields.state})`);
    }
  }
  const tranches = parseTranches(queue);
  checkTranches(tranches, tasks, known);

  // The summary a fresh session reads first.
  const byState = new Map(STATES.map((s) => [s, []]));
  const stateOf = new Map();
  for (const task of tasks) {
    if (task.id === undefined) continue;
    const list = byState.get(task.fields.state) ?? [];
    list.push(task);
    byState.set(task.fields.state, list);
    stateOf.set(task.id, task.fields.state);
  }
  console.log(`Development queue — ${tasks.length} task file(s)`);
  for (const state of STATES) {
    const list = byState.get(state) ?? [];
    if (list.length === 0) continue;
    for (const task of list) {
      const f = task.fields;
      console.log(`  ${state.padEnd(27)} ${task.id}  ${task.title}  [tranche ${f.tranche}, ${f.lane}, ${f['parallel-safe']?.split(' ')[0]}]`);
    }
  }

  // The tranche is the unit of owner authority, so it is printed as one.
  let authority = 'none — no approved tranche; nothing may execute';
  for (const tranche of [...tranches.values()].sort((a, b) => a.n - b.n)) {
    const deferred = tranche.roster.filter((e) => e.kind === 'deferral' && e.out);
    const kept = tranche.roster.filter((e) => !(e.kind === 'deferral' && e.out));
    const outstanding = kept.filter((e) => stateOf.get(e.id) !== 'DONE');
    // A closed tranche's report is computed, never written: the one number the
    // foreman got wrong on tranche 6 was the one it typed, so the shipped
    // count, the deferred list and anything still live all come from the task
    // states. `rostered = shipped + deferred + live`, always.
    if (tranche.status === 'COMPLETE') {
      const shipped = kept.filter((e) => stateOf.get(e.id) === 'DONE');
      const live = outstanding;
      const tail = live.length === 0 ? '' : `, ${live.length} STILL LIVE`;
      console.log(
        `  Tranche ${tranche.n}  ${tranche.status.padEnd(9)} ${tranche.roster.length} rostered → ${shipped.length} shipped, ${deferred.length} deferred${tail}`,
      );
      console.log(`    shipped (${shipped.length}): ${shipped.map((e) => e.id).join(', ') || '—'}`);
      if (deferred.length > 0) {
        console.log(
          `    deferred (${deferred.length}): ${deferred.map((e) => `${e.id} → ${destination(e)}`).join(', ')}`,
        );
      }
      if (live.length > 0) {
        console.log(
          `    live (${live.length}): ${live.map((e) => `${e.id} (${stateOf.get(e.id) ?? 'no task file'})`).join(', ')}`,
        );
      }
      continue;
    }
    const roster = tranche.roster
      .map((e) =>
        e.kind === 'deferral' && e.out
          ? `${e.id} (deferred → ${destination(e)})`
          : `${e.id} (${stateOf.get(e.id) ?? 'no task file'})`,
      )
      .join(', ');
    const tail =
      tranche.status !== 'APPROVED'
        ? ''
        : outstanding.length === 0
          ? '  → TRANCHE_COMPLETE'
          : `  → ${outstanding.length} outstanding`;
    console.log(`  Tranche ${tranche.n}  ${tranche.status.padEnd(9)} ${roster}${tail}`);
    if (tranche.status === 'APPROVED') authority = `tranche ${tranche.n} ${tranche.authority}`;
  }
  console.log(`Merge authority in force: ${authority}`);

  const active = tasks.filter((t) => HELD_BY_A_BUILDER.has(t.fields.state));
  console.log(
    active.length === 0
      ? 'Active builders: none'
      : `Active builders: ${active.map((t) => `${t.id} → ${t.fields.worker}`).join('; ')}`,
  );
  const gate1 = (byState.get('OWNER_APPROVAL_REQUIRED') ?? []).map((t) => t.id);
  const gate2 = (byState.get('OWNER_DECISION_REQUIRED') ?? []).map((t) => t.id);
  const gate3 = (byState.get('AWAITING_MERGE_APPROVAL') ?? []).map((t) => t.id);
  console.log(`Awaiting the owner: approval ${gate1.join(', ') || '—'} · decision ${gate2.join(', ') || '—'} · merge ${gate3.join(', ') || '—'}`);
  // Audit scheduling is the owner's, not the validator's: no counter, no
  // threshold. The foreman may still flag systemic risk, and if it has, say so.
  if (/^WHOLE_ENGINE_AUDIT_RECOMMENDED/m.test(queue)) {
    console.log('Audit: WHOLE_ENGINE_AUDIT_RECOMMENDED — see QUEUE.md for the evidence');
  }
  if (problems.length === 0) {
    console.log('Problems: none');
    return 0;
  }
  console.log(`Problems: ${problems.length}`);
  for (const p of problems) console.log(`  - ${p}`);
  return 1;
}

process.exit(main());
