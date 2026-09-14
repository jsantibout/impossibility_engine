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
 *   node docs/dev/check-queue.mjs
 *
 * Prints the summary a fresh session reads first, lists every problem with
 * the file it is in, and exits 1 if there is one. Never edits anything.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEV = dirname(fileURLToPath(import.meta.url));
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
      current.roster = roster[1].match(ID) ?? [];
    }
  }
  return tranches;
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
    for (const id of tranche.roster) {
      if (!known.has(id)) {
        problem(where, `roster names ${id}, which has no task file`);
        continue;
      }
      const claimed = byId.get(id)?.fields.tranche;
      if (claimed !== String(tranche.n)) {
        problem(where, `roster names ${id}, whose task file says "tranche: ${claimed}"`);
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
    if (!tranche.roster.includes(task.id)) {
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
  // The budget is architecture *change*, not task count: a raw count was too
  // sensitive at this throughput and would have called a broad Fable audit once
  // or twice a day however little actually moved. WORKFLOW.md carries the 0/1/2/3
  // weighting; the weight is recorded at merge from what landed.
  const since = queue.match(/^Architecture-change points since last audit:\s*(\d+)/m);
  const dueAt = queue.match(/^Audit due at:\s*(\d+)/m);
  if (since === null || dueAt === null) {
    problem('docs/dev/QUEUE.md', 'needs "Architecture-change points since last audit: N" and "Audit due at: N" lines');
  }

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
    const outstanding = tranche.roster.filter((id) => stateOf.get(id) !== 'DONE');
    const roster = tranche.roster.map((id) => `${id} (${stateOf.get(id) ?? 'no task file'})`).join(', ');
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
  if (since !== null && dueAt !== null) {
    const n = Number(since[1]);
    const due = Number(dueAt[1]);
    console.log(`Audit: ${n} architecture-change point(s) since the last whole-engine audit; due at ${due}${n >= due ? ' → WHOLE_ENGINE_AUDIT_DUE' : ''}`);
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
