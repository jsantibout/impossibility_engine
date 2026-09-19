/**
 * Two surfaces, and the wall between them.
 *
 * Step one proved one thing structurally: the external-roll functions are not
 * *importable* from this package, in seven ways of writing an import. This
 * file makes the same kind of claim about the same kind of hazard, one layer
 * up — **a DM tool is not reachable from the model's surface** — and it makes
 * the step-one claim again over the files step one could not sweep, because
 * they did not exist.
 *
 * Three walls, each asserted rather than described:
 *
 * 1. **The model's surface cannot see a DM tool.** Not "does not call one":
 *    the module closure of `createSurface` — every file reachable from it by
 *    following imports — contains no file under `dm/`, and the factory takes
 *    no tool list that could be handed one.
 * 2. **The external-roll functions are unreachable from the DM surface too.**
 *    A DM states a DC and an amount, and still never stamps a roll as the
 *    engine's. `boundary.test.ts` sweeps the top-level files; this sweeps
 *    `dm/`, with the same detectors and the same forms.
 * 3. **No file falls between the two sweeps.** A guard that stops at a
 *    directory boundary is a guard with a door in it.
 *
 * Like its counterpart one directory up, this file holds both the detectors
 * and the breaches they are tested against, so it is the one file exempt from
 * its own sweeps.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import * as engine from '@ie/engine';
import { fold } from '@ie/engine';
import * as tools from '@ie/tools';
import {
  createCampaign,
  createDmSurface,
  createSurface,
  DM_ONLY_TOOL_NAMES,
  DM_TOOL_NAMES,
  TOOL_NAMES,
} from '@ie/tools';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const ABOVE = fileURLToPath(new URL('..', import.meta.url));

const GUARD_FILE = 'boundary.test.ts';

const filesIn = (directory: string): { file: string; text: string }[] =>
  readdirSync(directory)
    .filter((file) => file.endsWith('.ts'))
    .map((file) => ({ file, text: readFileSync(directory + file, 'utf8') }));

/** Every file of the DM surface but this one, which holds the breaches. */
const swept = (): { file: string; text: string }[] =>
  filesIn(HERE).filter(({ file }) => file !== GUARD_FILE);

// — the detectors, borrowed in shape from the sweep one directory up ————————

const FORBIDDEN_EVERYWHERE = ['recordExternalD20', 'recordExternalDamage'];

function engineImports(text: string): string[] {
  const found: string[] = [];
  const pattern = /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*'@ie\/engine'/g;
  for (const match of text.matchAll(pattern)) {
    for (const raw of match[1]!.split(',')) {
      const name = raw.replace(/\btype\b/, '').trim().split(/\s+as\s+/)[0]!.trim();
      if (name.length > 0) found.push(name);
    }
  }
  return found;
}

const opaqueForms = (module: string): readonly { readonly what: string; readonly pattern: RegExp }[] => [
  { what: 'a namespace import', pattern: new RegExp(`import\\s+\\*\\s+as\\s+\\w+\\s+from\\s*'${module}'`) },
  { what: 'a star re-export', pattern: new RegExp(`export\\s+\\*\\s+(?:as\\s+\\w+\\s+)?from\\s*'${module}'`) },
  { what: 'a named re-export', pattern: new RegExp(`export\\s+(?:type\\s+)?\\{[^}]*\\}\\s*from\\s*'${module}'`) },
  { what: 'a dynamic import', pattern: new RegExp(`import\\s*\\(\\s*'${module}'\\s*\\)`) },
];

const ENGINE_FORMS = opaqueForms('@ie/engine');

/**
 * The same four forms, aimed at the DM's own modules.
 *
 * A model-side file could reach a DM tool by any of them, and a *named* import
 * is the fifth — so the pair of detectors below is the pair step one used,
 * with the module pattern changed and nothing else.
 */
const DM_PATH = String.raw`\.{1,2}/dm/[\w./-]+`;
const DM_FORMS: readonly { readonly what: string; readonly pattern: RegExp }[] = [
  ...opaqueForms(DM_PATH),
  { what: 'a named import', pattern: new RegExp(`import\\s+(?:type\\s+)?\\{[^}]*\\}\\s*from\\s*'${DM_PATH}'`) },
  { what: 'a bare import', pattern: new RegExp(`import\\s*'${DM_PATH}'`) },
];

const reachesTheDm = (text: string): boolean => DM_FORMS.some(({ pattern }) => pattern.test(text));

// — wall one: the model's surface cannot see a DM tool ——————————————————————

/**
 * A factory's parameter list, split at the commas that are its own.
 *
 * The commas inside `Record<string, string>` and `{ a: 1, b: 2 }` are not
 * parameter separators, so the split walks the depth rather than calling
 * `String.split`.
 */
function factoryParameters(source: string, name: string): readonly string[] {
  const match = new RegExp(String.raw`export function ${name}\(([\s\S]*?)\):`).exec(source);
  expect(match, `${name} is declared as a plain exported function`).not.toBeNull();
  const parameters: string[] = [];
  let depth = 0;
  let current = '';
  for (const character of match![1]!) {
    if ('<{(['.includes(character)) depth += 1;
    else if ('>})]'.includes(character)) depth -= 1;
    if (character === ',' && depth === 0) {
      parameters.push(current.trim());
      current = '';
      continue;
    }
    current += character;
  }
  if (current.trim().length > 0) parameters.push(current.trim());
  return parameters;
}

/**
 * Every file the model's surface pulls in, by following its imports.
 *
 * A list of "the model-side files" would be a list that goes stale the first
 * time somebody adds one. This is the closure of `surface.ts` — what a caller
 * holding `createSurface` actually loads — so a model-side file that starts
 * importing a DM module is in it whether or not anybody remembered to write
 * it down.
 */
function closureFrom(entry: string): ReadonlySet<string> {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const text = readFileSync(ABOVE + file, 'utf8');
    for (const match of text.matchAll(/from\s*'(\.[^']*)'/g)) {
      const relative = match[1]!.replace(/\.js$/, '.ts');
      const resolved = relative.startsWith('./') ? relative.slice(2) : relative;
      queue.push(resolved);
    }
  }
  return seen;
}

describe('the model’s surface cannot reach a DM tool', () => {
  it('loads no DM module at all', () => {
    const closure = closureFrom('surface.ts');
    expect([...closure].filter((file) => file.includes('dm/')).sort()).toEqual([]);
    // Non-vacuous: the walk really does follow imports, several deep.
    expect(closure).toContain('definitions.ts');
    expect(closure).toContain('campaign.ts');
    expect(closure).toContain('schemas.ts');
  });

  it('and none of those files names a DM module, in any form of import', () => {
    const breaches: string[] = [];
    for (const file of closureFrom('surface.ts')) {
      const text = readFileSync(ABOVE + file, 'utf8');
      for (const { what, pattern } of DM_FORMS) {
        if (pattern.test(text)) breaches.push(`${file} reaches the DM surface through ${what}`);
      }
    }
    expect(breaches).toEqual([]);
  });

  it('and the detector catches every way of writing that import', () => {
    // A detector nobody tested is a guard nobody tested.
    expect(reachesTheDm("import { DM_TOOLS } from './dm/definitions.js';")).toBe(true);
    expect(reachesTheDm("import { DM_TOOLS as extra } from './dm/definitions.js';")).toBe(true);
    expect(reachesTheDm("import type { DmTool } from './dm/definitions.js';")).toBe(true);
    expect(reachesTheDm("import * as dm from './dm/definitions.js';")).toBe(true);
    expect(reachesTheDm("export * from './dm/surface.js';")).toBe(true);
    expect(reachesTheDm("export { createDmSurface } from './dm/surface.js';")).toBe(true);
    expect(reachesTheDm("const dm = await import('./dm/definitions.js');")).toBe(true);
    expect(reachesTheDm("import './dm/definitions.js';")).toBe(true);
    expect(reachesTheDm("import { DM_TOOLS } from '../dm/definitions.js';")).toBe(true);
    // And it does not cry wolf at the imports the model's files actually make.
    expect(reachesTheDm("import { TOOLS } from './definitions.js';")).toBe(false);
    expect(reachesTheDm("import { observe } from './observe.js';")).toBe(false);
  });

  it('takes no tool list, so none can be handed to it', () => {
    // A single surface with a flag is what this is instead of. Each factory
    // takes the campaign and nothing else, and the list it dispatches over is
    // not something a caller chooses.
    //
    // Read off the source rather than off `Function.length`, which is the
    // detector this test had first and which a *defaulted* second parameter
    // walks straight past: `(campaign, tools = TOOLS)` reports a length of 1
    // and accepts anything.
    expect(factoryParameters(readFileSync(`${ABOVE}surface.ts`, 'utf8'), 'createSurface')).toEqual([
      'campaign: Campaign',
    ]);
    expect(factoryParameters(readFileSync(`${HERE}surface.ts`, 'utf8'), 'createDmSurface')).toEqual([
      'campaign: Campaign',
    ]);
  });

  it('and the reader would see a second parameter, defaulted or not', () => {
    const breach = (parameters: string) =>
      factoryParameters(`export function createSurface(${parameters}): Surface {`, 'createSurface');
    expect(breach('campaign: Campaign, tools: readonly ToolDefinition[]')).toHaveLength(2);
    expect(breach('campaign: Campaign, tools: readonly ToolDefinition[] = TOOLS')).toHaveLength(2);
    expect(breach('campaign: Campaign, options: { tools?: readonly ToolDefinition[] }')).toHaveLength(2);
    expect(breach('campaign: Campaign')).toHaveLength(1);
  });

  it('publishes no way to build a surface over an arbitrary list', () => {
    // The shared dispatch mechanism is deliberately not on the barrel: two
    // factories are two doors, and a third that takes a list would be a flag
    // wearing a function's clothes.
    expect(Object.keys(tools)).not.toContain('createDispatch');
    // Both factories are, which is what "separately obtainable" means.
    expect(Object.keys(tools)).toContain('createSurface');
    expect(Object.keys(tools)).toContain('createDmSurface');
  });

  it('holds no DM tool in its dispatch table', () => {
    const surface = createSurface(createCampaign({ content: SRD_CONTENT, seed: 'walls' }));
    const held = surface.tools.map((definition) => definition.name);
    expect(held.filter((name) => DM_ONLY_TOOL_NAMES.includes(name))).toEqual([]);
    expect(TOOL_NAMES.filter((name) => DM_ONLY_TOOL_NAMES.includes(name))).toEqual([]);
    // And the list it does hold is not empty, or the claim is free.
    expect(held.length).toBeGreaterThan(20);
  });

  it('answers a call to one as an unknown tool, not as a refusal', () => {
    const surface = createSurface(createCampaign({ content: SRD_CONTENT, seed: 'walls' }));
    for (const tool of DM_ONLY_TOOL_NAMES) {
      const outcome = surface.call({ tool, input: {}, commandId: 'toolu_1' });
      expect(outcome.status).toBe('invalid');
      if (outcome.status !== 'invalid') continue;
      expect(outcome.code).toBe('unknown_tool');
    }
    // Non-vacuous: there are DM tools, and the DM surface answers them.
    expect(DM_ONLY_TOOL_NAMES.length).toBeGreaterThan(0);
  });

  it('never names one as the door to a missing fact', () => {
    // `doorsFor` is what a `needs-context` hands back, and a model told to
    // establish a fact through a tool it does not have would be stuck.
    const surface = createSurface(createCampaign({ content: SRD_CONTENT, seed: 'walls' }));
    for (const kind of tools.CONTEXT_REQUEST_KINDS) {
      for (const door of surface.doorsFor(kind)) {
        expect(DM_ONLY_TOOL_NAMES).not.toContain(door);
        expect(TOOL_NAMES).toContain(door);
      }
    }
  });
});

// — wall two: neither surface reaches the external-roll functions ——————————

describe('the DM surface cannot reach the external-roll functions either', () => {
  it('and they are real, so the guard is aimed at something', () => {
    expect(typeof (engine as Record<string, unknown>)['recordExternalD20']).toBe('function');
    expect(typeof (engine as Record<string, unknown>)['recordExternalDamage']).toBe('function');
  });

  it('imports neither of them, in any file under dm/', () => {
    const breaches: string[] = [];
    for (const { file, text } of swept()) {
      for (const name of engineImports(text)) {
        if (FORBIDDEN_EVERYWHERE.includes(name)) breaches.push(`${file} imports ${name}`);
      }
    }
    expect(breaches).toEqual([]);
  });

  it('reaches the engine only through named imports, which the sweep can read', () => {
    const breaches: string[] = [];
    for (const { file, text } of swept()) {
      for (const { what, pattern } of ENGINE_FORMS) {
        if (pattern.test(text)) breaches.push(`${file} reaches @ie/engine through ${what}`);
      }
    }
    expect(breaches).toEqual([]);
  });

  it('and between them the two sweeps catch every way of writing it', () => {
    const caught = (text: string) =>
      engineImports(text).some((name) => FORBIDDEN_EVERYWHERE.includes(name)) ||
      ENGINE_FORMS.some(({ pattern }) => pattern.test(text));

    expect(caught("import { recordExternalD20 } from '@ie/engine';")).toBe(true);
    expect(caught("import { recordExternalD20 as roll } from '@ie/engine';")).toBe(true);
    expect(caught("import type { recordExternalDamage } from '@ie/engine';")).toBe(true);
    expect(caught("import * as anything from '@ie/engine';")).toBe(true);
    expect(caught("export * from '@ie/engine';")).toBe(true);
    expect(caught("export { recordExternalD20 } from '@ie/engine';")).toBe(true);
    expect(caught("const { recordExternalDamage } = await import('@ie/engine');")).toBe(true);
    // The DM surface *does* import the commands that take a number, which is
    // the whole difference between the two surfaces — and is not a breach.
    expect(caught("import { resolveDamage, resolveTest } from '@ie/engine';")).toBe(false);
  });

  it('sweeps something: the DM files do import the engine', () => {
    const all = swept().flatMap(({ text }) => engineImports(text));
    expect(all).toContain('resolveDamage');
    expect(all).toContain('resolveTest');
  });

  it('publishes no DM tool whose name suggests one', () => {
    expect(DM_TOOL_NAMES.filter((name) => /external|record_d20|set_hp/.test(name))).toEqual([]);
  });

  it('answers a call to one as an unknown tool', () => {
    const surface = createDmSurface(createCampaign({ content: SRD_CONTENT, seed: 'walls' }));
    for (const tool of ['record_external_d20', 'recordExternalD20', 'record_external_damage']) {
      const outcome = surface.call({ tool, input: {}, commandId: 'toolu_1' });
      expect(outcome.status).toBe('invalid');
      if (outcome.status !== 'invalid') continue;
      expect(outcome.code).toBe('unknown_tool');
    }
  });

  it('publishes neither of them on the package’s surface', () => {
    expect(Object.keys(tools).filter((name) => /^record(External|D20)/.test(name))).toEqual([]);
  });
});

// — wall three: nothing falls between the sweeps ——————————————————————————

describe('every file of this package is swept by one of the two boundary files', () => {
  const directoriesIn = (directory: string): string[] =>
    readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

  it('and the directory split is the whole of the division', () => {
    // `readdirSync` is not recursive, so each sweep reaches exactly one
    // directory. That is only a complete guard while there are exactly two —
    // a third would be swept by neither, silently, which is the shape of hole
    // this whole file exists to refuse.
    expect(directoriesIn(ABOVE)).toEqual(['dm']);
    expect(directoriesIn(HERE)).toEqual([]);
    expect(filesIn(ABOVE).length).toBeGreaterThan(0);
    expect(filesIn(HERE).length).toBeGreaterThan(0);
    expect(filesIn(ABOVE).map(({ file }) => file)).toContain(GUARD_FILE);
    expect(filesIn(HERE).map(({ file }) => file)).toContain(GUARD_FILE);
  });

  it('exempts exactly one file here, and it is the one holding the detectors', () => {
    expect(filesIn(HERE).length - swept().length).toBe(1);
    expect(swept().map(({ file }) => file)).not.toContain(GUARD_FILE);
  });

  it('and nothing under dm/ writes to the log except through settle', () => {
    // `Campaign.append` has two call sites and both are in `definitions.ts`,
    // which the sweep one directory up counts. Nothing here appends at all.
    for (const { file, text } of swept()) {
      expect(text, file).not.toContain('.append(');
    }
  });
});

describe('the DM campaign’s cache is the fold', () => {
  it('agrees with a fresh fold after every call', () => {
    const campaign = createCampaign({ content: SRD_CONTENT, seed: 'dm-cache' });
    const surface = createDmSurface(campaign);
    let calls = 0;
    const call = (tool: string, input: unknown = {}) => {
      surface.call({ tool, input, commandId: `toolu_${++calls}` });
      expect(JSON.stringify(campaign.state())).toBe(
        JSON.stringify(fold(campaign.seed, campaign.log())),
      );
    };

    call('set_scene', { width: 30, depth: 30, height: 10 });
    call('ability_check', { who: 'nobody', ability: 'dex', dc: 10 });
    call('improvised_damage', { target: 'nobody', amount: 3, ruling: 'a trap' });
    call('look');
  });
});

describe('every DM schema rejects a malformed call', () => {
  const surface = () => createDmSurface(createCampaign({ content: SRD_CONTENT, seed: 'dm-schemas' }));

  it.each([...DM_ONLY_TOOL_NAMES])(
    '%s refuses arguments that are not even an object',
    (name) => {
      const outcome = surface().call({ tool: name, input: 42, commandId: 'toolu_schema' });
      expect(outcome.status).toBe('invalid');
      if (outcome.status !== 'invalid') return;
      expect(outcome.code).toBe('malformed_arguments');
      expect(outcome.reason).toContain(name);
      expect(outcome.issues.length).toBeGreaterThan(0);
    },
  );

  it('rejects a key it does not know, rather than dropping it in silence', () => {
    const outcome = surface().call({
      tool: 'end_condition',
      input: { who: 'kessa', condition: 'prone', natural: 20 },
      commandId: 'toolu_schema',
    });
    expect(outcome.status).toBe('invalid');
  });

  it('carries every model tool but the one the wider ruling replaces', () => {
    const missing = TOOL_NAMES.filter((name) => !DM_TOOL_NAMES.includes(name));
    expect(missing).toEqual(['apply_condition']);
    // And exactly one tool on the DM surface applies a condition.
    expect(DM_TOOL_NAMES.filter((name) => /condition/.test(name)).sort()).toEqual([
      'end_condition',
      'rule_condition',
    ]);
  });

  it('is sorted, because the prompt cache depends on it', () => {
    expect([...DM_TOOL_NAMES]).toEqual([...DM_TOOL_NAMES].sort());
  });
});
