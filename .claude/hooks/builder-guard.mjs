#!/usr/bin/env node
/**
 * PreToolUse hook for the qb-builder agent: refuses the git operations a
 * builder must never perform.
 *
 * Claude Code's worktree isolation already blocks edits and git aimed at the
 * main checkout. This closes what that cannot see — publishing the branch,
 * moving or deleting refs, merging, tagging, or creating and removing
 * worktrees. Rebasing onto main, committing, fetching and resetting the
 * builder's own branch stay allowed, because the procedure asks for them.
 *
 * Reads the hook JSON on stdin. Exit 2 blocks the call and shows stderr to
 * the agent; exit 0 lets it through. Anything unparseable lets the call
 * through: a guard that wedges every command on a hook bug is worse than one
 * that is defence in depth behind the isolation checks.
 */
import { readFileSync } from 'node:fs';

const FORBIDDEN = [
  [/\bgit\s+push\b/, 'git push: builders never publish; the foreman integrates from the shared .git after merge approval'],
  [/\bgit\s+merge\b/, 'git merge: builders never merge; integration is Gate 3, done by the foreman'],
  [/\bgit\s+(?:update-ref|symbolic-ref)\b/, 'ref surgery'],
  [/\bgit\s+branch\b[^\n]*\s(?:-f|--force|-D|-d|--delete|-M|-m|--move|-c|-C|--copy)\b/, 'moving, forcing, copying or deleting a branch'],
  [/\bgit\s+(?:checkout|switch)\b[^\n]*\bmain\b/, 'checking out main: it is checked out in the primary worktree'],
  [/\bgit\s+worktree\s+(?:add|remove|prune|move|lock|unlock|repair)\b/, 'creating, removing or moving worktrees'],
  [/\bgit\s+tag\b/, 'tags publish refs'],
  [/\bgit\s+config\s+(?:--global|--system)\b/, 'global git configuration'],
  [/\bgh\s+pr\s+(?:merge|create)\b/, 'pull requests belong to the foreman and the owner'],
  [/\bnpm\s+publish\b/, 'publishing'],
];

let input = '';
try {
  input = readFileSync(0, 'utf8');
} catch {
  process.exit(0);
}
let hook;
try {
  hook = JSON.parse(input);
} catch {
  process.exit(0);
}
if (hook.tool_name !== 'Bash' && hook.tool_name !== 'PowerShell') process.exit(0);
const command = String(hook.tool_input?.command ?? '');
for (const [pattern, why] of FORBIDDEN) {
  if (pattern.test(command)) {
    process.stderr.write(
      `qb-builder guard: refused — ${why}.\n` +
        `Command: ${command}\n` +
        'A builder commits on its own worktree branch and reports; the foreman integrates after the owner approves the merge. ' +
        'If this command is genuinely needed, say so in your report instead of retrying.\n',
    );
    process.exit(2);
  }
}
process.exit(0);
