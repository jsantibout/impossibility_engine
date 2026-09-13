#!/usr/bin/env node
/**
 * PreToolUse hook for the qb-builder and qb-reviewer agents: refuses the git
 * operations those roles must never perform.
 *
 * Claude Code's worktree isolation already blocks edits and git aimed at the
 * main checkout. This closes what that cannot see — publishing the branch,
 * moving or deleting refs, merging, tagging, or creating and removing
 * worktrees. For a builder, rebasing onto main, committing, fetching and
 * resetting its own branch stay allowed, because the procedure asks for
 * them. With `--reviewer`, anything that changes the branch or the tree is
 * refused too: a reviewer reads and runs, and never moves anything.
 *
 * Reads the hook JSON on stdin. Exit 2 blocks the call and shows stderr to
 * the agent; exit 0 lets it through. Anything unparseable lets the call
 * through: a guard that wedges every command on a hook bug is worse than one
 * that is defence in depth behind the isolation checks.
 */
import { readFileSync } from 'node:fs';

const FORBIDDEN = [
  [/\bgit\s+push\b/, 'git push: nobody but the architect publishes, and only after merge approval'],
  [/\bgit\s+merge\b/, 'git merge: integration is Gate 3, done by the architect'],
  [/\bgit\s+(?:update-ref|symbolic-ref)\b/, 'ref surgery'],
  [/\bgit\s+branch\b[^\n]*\s(?:-f|--force|-D|-d|--delete|-M|-m|--move|-c|-C|--copy)\b/, 'moving, forcing, copying or deleting a branch'],
  [/\bgit\s+(?:checkout|switch)\b[^\n]*\bmain\b/, 'checking out main: it is checked out in the primary worktree'],
  [/\bgit\s+worktree\s+(?:add|remove|prune|move|lock|unlock|repair)\b/, 'creating, removing or moving worktrees'],
  [/\bgit\s+tag\b/, 'tags publish refs'],
  [/\bgit\s+config\s+(?:--global|--system)\b/, 'global git configuration'],
  [/\bgh\s+pr\s+(?:merge|create)\b/, 'pull requests belong to the architect and the owner'],
  [/\bnpm\s+publish\b/, 'publishing'],
];

const REVIEWER_ONLY = [
  [/\bgit\s+(?:commit|add|rm|mv|reset|rebase|stash|restore|cherry-pick|revert|apply|am|clean|checkout|switch)\b/, 'a reviewer changes nothing: no commits, no tree changes, no branch moves'],
];

const reviewer = process.argv.includes('--reviewer');
const rules = reviewer ? [...FORBIDDEN, ...REVIEWER_ONLY] : FORBIDDEN;

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
for (const [pattern, why] of rules) {
  if (pattern.test(command)) {
    process.stderr.write(
      `${reviewer ? 'qb-reviewer' : 'qb-builder'} guard: refused — ${why}.\n` +
        `Command: ${command}\n` +
        (reviewer
          ? 'Report what you found in your verdict instead; the builder makes the changes.\n'
          : 'A builder commits on its own worktree branch and reports; the architect integrates after the owner approves the merge. If this command is genuinely needed, say so in your digest instead of retrying.\n'),
    );
    process.exit(2);
  }
}
process.exit(0);
