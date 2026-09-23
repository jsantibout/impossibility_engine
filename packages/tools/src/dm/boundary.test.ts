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

/**
 * The names no file under `dm/` may import from the engine.
 *
 * **Step one's list, minus exactly one name.** The two surfaces are
 * partitioned by *authority*, and authority runs one way: a DM decides what
 * the rules leave open, and a model running the table holds that door as a
 * human does. So everything a model may not import, a DM may not import
 * either, except where a DM's authority buys it back — which is
 * {@link ALLOWED_A_DM}, and is one name.
 *
 * The reason for each is step one's and is written beside it there, in
 * `FORBIDDEN_BECAUSE`. What *this* list says is only which of them a DM's
 * authority does not reach, and the answer for every group is all of them:
 *
 * - The external-roll functions stamp a roll as the engine's own, and a DM
 *   stating a number is not the same act. `recordD20Test` and
 *   `setExhaustionLevel` are named in `dm/definitions.ts`'s own "no" column.
 * - **The stated-face seam is not a DM door either.** `resolveStatedD20` and
 *   the four that carry a face into a check, a save, an attack or a death save
 *   all end at `recordExternalD20`, which this list has always forbidden.
 *   Forbidding the callee and permitting the callers is the hole rather than
 *   the guard. `CLAUDE.md` says the face a table throws reaches the engine
 *   "only through a door built for one", in "its own directory with its own
 *   sweep" — and `dm/` is not that directory.
 * - The rollers that hand back a roll rather than events advance a generator
 *   whose `rolls-issued` event only a command emits, leaving the campaign's
 *   dice out of step with its log. `rollAttackDamage` is where that reason was
 *   first written down, and it is on step one's list now too: a name forbidden
 *   the wider surface and allowed the narrower one was a hole, not an
 *   asymmetry. `rollInitiativeFor` is the one that lives under `commands/` and
 *   is not a command, which is why step one derives that group on what comes
 *   back rather than on where a function lives.
 * - `createRng`, `restoreRng` and `createRollIssuer` make the generator and
 *   the stamp all of those need: `Rng.int(20)` is a face, and `issue` takes
 *   the source it stamps and refuses nothing. Step one exempts `campaign.ts`,
 *   which rebuilds both per call and throws them away; **nothing here is
 *   exempt**, because no file under `dm/` rebuilds either — `supply()` is
 *   passed whole to the command that rolls, which is the only thing that
 *   should hold one.
 */
const FORBIDDEN_HERE = [
  'recordExternalD20',
  'recordExternalDamage',
  'damageCreature',
  'healCreature',
  'grantTemporaryHpTo',
  'setExhaustionLevel',
  'recordD20Test',
  'resolveStatedD20',
  'rollD20Test',
  'rollAbilityCheck',
  'rollSavingThrow',
  'rollAttack',
  'resolveDeathSave',
  'roll',
  'rollUnder',
  'rollD20',
  'rerollDice',
  'rollD20Recorded',
  'rollRecorded',
  'rollBonusDice',
  'rerollTest',
  'interveneAfterRoll',
  'reduceDamage',
  'rollAttackDamage',
  'rollInitiative',
  'rollInitiativeFor',
  'rollDeathSave',
  'createRng',
  'restoreRng',
  'createRollIssuer',
];

/**
 * The one name that comes off step one's list, with the reason.
 *
 * `resolveDamage` takes an `amount`, which is exactly the difference between
 * the two surfaces: a decision the rules leave open, adjudicated by the
 * person the rules leave it to.
 */
const ALLOWED_A_DM: Readonly<Record<string, string>> = {
  resolveDamage:
    'takes an amount the DM adjudicated, which is the decision the rules leave open rather than an outcome they decide — and settles the Concentration save that `damageCreature` alone would forget',
};

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

/** Source with its comments removed, so prose about a field is not a use. */
const stripComments = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

/**
 * Every shape a binding of one field can take — step one's detector, and a
 * test below holds the two character for character.
 *
 * What tells `{ rng: generator }` from `{ readonly rng: Rng }` is the type: an
 * annotation of this field names the type this field has, and a rename names
 * anything else.
 */
const BOUND_AS = (field: string, type: string): RegExp[] => [
  new RegExp(String.raw`\.${field}\b`),
  new RegExp(String.raw`\{[^}]*\b${field}\s*[,}]`),
  new RegExp(String.raw`\b${field}\s*:\s*(?!${type}\b)[A-Za-z_$][\w$]*\s*[,}=]`),
  new RegExp(String.raw`['"\`]${field}['"\`]`),
];

/**
 * A file under `dm/` reaching past `supply()` for what it holds.
 *
 * Step one's guard over the files step one cannot reach, and with no exempt
 * file: nothing here rebuilds a generator or an issuer, because `supply()` is
 * passed whole to the command that rolls.
 */
function reachesPastTheSupply(file: string, source: string): string[] {
  const breaches: string[] = [];
  const text = stripComments(source);
  if ([/\bissue\s*\(/, ...BOUND_AS('issue', 'RollIssuer')].some((pattern) => pattern.test(text))) {
    breaches.push(`${file} mints a roll provenance`);
  }
  if (BOUND_AS('rng', 'Rng').some((pattern) => pattern.test(text))) {
    breaches.push(`${file} reaches for a generator`);
  }
  return breaches;
}

/**
 * The same four forms, aimed at the two specifiers that reach a DM tool.
 *
 * **Two specifiers, not one.** `./dm/...` is the obvious door and `@ie/tools`
 * is the other: this package's own barrel republishes `DM_TOOLS`, so a
 * model-side source importing the package it lives in would hold the DM's
 * list, and a walk that follows only relative paths would never see it. No
 * source file here does that and every test file does, which is exactly the
 * kind of idiom that becomes a breach nobody reads.
 *
 * A model-side file could reach one by any of them, and a *named* import
 * is the fifth — so the pair of detectors below is the pair step one used,
 * with the module pattern changed and nothing else.
 */
const DM_PATH = String.raw`\.{1,2}/dm/[\w./-]+`;
const BARREL = '@ie/tools';

const formsFor = (module: string): readonly { readonly what: string; readonly pattern: RegExp }[] => [
  ...opaqueForms(module),
  { what: 'a named import', pattern: new RegExp(`import\\s+(?:type\\s+)?\\{[^}]*\\}\\s*from\\s*'${module}'`) },
  { what: 'a bare import', pattern: new RegExp(`import\\s*'${module}'`) },
];

const DM_FORMS: readonly { readonly what: string; readonly pattern: RegExp }[] = [
  ...formsFor(DM_PATH),
  ...formsFor(BARREL).map(({ what, pattern }) => ({ what: `${what} of this package's barrel`, pattern })),
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
    // And the way round the relative paths: the package's own barrel.
    expect(reachesTheDm("import { DM_TOOLS } from '@ie/tools';")).toBe(true);
    expect(reachesTheDm("import * as tools from '@ie/tools';")).toBe(true);
    expect(reachesTheDm("export * from '@ie/tools';")).toBe(true);
    expect(reachesTheDm("const { DM_TOOLS } = await import('@ie/tools');")).toBe(true);
    // And it does not cry wolf at the imports the model's files actually make.
    expect(reachesTheDm("import { TOOLS } from './definitions.js';")).toBe(false);
    expect(reachesTheDm("import { observe } from './observe.js';")).toBe(false);
    expect(reachesTheDm("import { z } from 'zod';")).toBe(false);
    expect(reachesTheDm("import { resolveAttack } from '@ie/engine';")).toBe(false);
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

  it('imports none of them, in any file under dm/', () => {
    const breaches: string[] = [];
    for (const { file, text } of swept()) {
      for (const name of engineImports(text)) {
        if (FORBIDDEN_HERE.includes(name)) breaches.push(`${file} imports ${name}`);
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
      engineImports(text).some((name) => FORBIDDEN_HERE.includes(name)) ||
      ENGINE_FORMS.some(({ pattern }) => pattern.test(text));

    // Every name, not a sample: two of the forms are caught by the shape of
    // the import rather than by the name inside it, so a sample would pass for
    // a name the name sweep could not read at all.
    for (const name of FORBIDDEN_HERE) {
      expect(caught(`import { ${name} } from '@ie/engine';`), name).toBe(true);
      expect(caught(`import { ${name} as alias } from '@ie/engine';`), name).toBe(true);
      expect(caught(`import type { ${name} } from '@ie/engine';`), name).toBe(true);
      expect(caught(`export { ${name} } from '@ie/engine';`), name).toBe(true);
      expect(caught(`const { ${name} } = await import('@ie/engine');`), name).toBe(true);
    }
    // And the two forms that name nothing at all, which no loop over names
    // would produce.
    expect(caught("import * as anything from '@ie/engine';")).toBe(true);
    expect(caught("export * from '@ie/engine';")).toBe(true);
    // The DM surface *does* import the command that takes an amount, which is
    // the whole difference between the two surfaces — and is not a breach.
    expect(caught("import { resolveDamage, resolveTest } from '@ie/engine';")).toBe(false);
  });

  it('forbids everything step one forbade but the one name it names', () => {
    // The two lists cannot be derived from each other — one is about a model
    // and one about a DM — but they can be held to a *stated* difference,
    // which is what stops this one quietly shrinking. Step one's list is read
    // out of its own source rather than transcribed.
    const stepOne = /const FORBIDDEN = \[([\s\S]*?)\];/.exec(
      readFileSync(`${ABOVE}boundary.test.ts`, 'utf8'),
    );
    expect(stepOne, 'step one still declares a FORBIDDEN list').not.toBeNull();
    const theirs = [...stepOne![1]!.matchAll(/'(\w+)'/g)].map((match) => match[1]!);
    expect(theirs.length).toBeGreaterThan(5);

    const dropped = theirs.filter((name) => !FORBIDDEN_HERE.includes(name));
    expect(dropped).toEqual(Object.keys(ALLOWED_A_DM));
    expect(Object.values(ALLOWED_A_DM).every((why) => why.length > 20)).toBe(true);
    // And an exemption is not a note: a name excused here must really be one
    // step one forbade, or it is a sentence about nothing.
    expect(Object.keys(ALLOWED_A_DM).filter((name) => !theirs.includes(name))).toEqual([]);

    // **And the difference runs one way only.** The clause above catches this
    // list shrinking; this one catches step one's. Authority is a containment:
    // a DM decides what the rules leave open and a model does not, so a name
    // forbidden here and allowed there would be a hole in the *stricter*
    // surface — which is what `rollAttackDamage` was for one batch, sitting on
    // this list alone because step one had had no reason to want it.
    expect(FORBIDDEN_HERE.filter((name) => !theirs.includes(name))).toEqual([]);
  });

  it('and the ones that are forbidden here are really reachable', () => {
    // A guard aimed at a name the engine does not export is not a guard.
    for (const name of FORBIDDEN_HERE) {
      expect(typeof (engine as Record<string, unknown>)[name], name).toBe('function');
    }
  });

  it('and mints no roll of its own out of the supply it is handed', () => {
    // The same text sweep step one makes, over the files step one cannot
    // reach. `campaign.supply()` hands back a live `RollIssuer` and a live
    // `Rng`, and neither `issuer.issue('engine')` nor `rng.int(20)` names a
    // forbidden import — so the import sweep above cannot see either.
    //
    // **The bindings, not the property, and the rename as much as the name**,
    // for step one's reason: a detector reading `.rng` misses
    // `const { rng } = supply()` and one reading `{ rng }` misses
    // `const { rng: generator }`, which are how anybody would actually write
    // it. No file under `dm/` rebuilds either at all, so nothing here is
    // exempt: `supply()` is passed whole to the command that rolls, which is
    // the only thing that should hold one.
    const breaches = swept().flatMap(({ file, text }) => reachesPastTheSupply(file, text));
    expect(breaches).toEqual([]);
  });

  it('and that detector catches the way anybody would write it', () => {
    // A detector nobody tested is a guard nobody tested — and the first
    // version of this one caught the form nobody uses and missed the form
    // everybody would, which is why the fixtures are here rather than a
    // reading of the regex.
    const caught = (source: string) => reachesPastTheSupply('probe.ts', source);
    const generator = ['probe.ts reaches for a generator'];
    const mint = ['probe.ts mints a roll provenance'];

    expect(caught('const { rng } = campaign.supply();')).toEqual(generator);
    expect(caught('const { rng, issuer, content } = campaign.supply();')).toEqual(generator);
    expect(caught('const supply = campaign.supply();\nsupply.rng.int(20);')).toEqual(generator);
    expect(caught("const g = campaign.supply()['rng'];")).toEqual(generator);
    expect(caught('const { rng: generator } = campaign.supply();\ngenerator.int(20);')).toEqual(
      generator,
    );
    expect(caught('const { rng: Generator } = campaign.supply();\nGenerator.int(20);')).toEqual(
      generator,
    );
    // The issuer, through a property, a destructure, a rename or a bound name.
    expect(caught("campaign.supply().issuer.issue('engine');")).toEqual(mint);
    expect(caught("const { issue } = issuer;\nissue('engine');")).toEqual(mint);
    expect(caught("const { issue: mint } = issuer;\nmint('engine');")).toEqual(mint);
    expect(caught("const mint = issuer.issue;\nmint('engine');")).toEqual(mint);
    // A type annotation naming the field is not a binding, and passing the
    // supply whole is what every tool here does.
    expect(caught('const declare = (supply: { readonly rng: Rng }): void => undefined;')).toEqual(
      [],
    );
    expect(caught('resolveDamage(state, target, amount, context.campaign.supply());')).toEqual([]);
    expect(caught('const outcome = resolveTest(state, supply);')).toEqual([]);
    expect(caught('const spent = state.rollsIssued;\nconst n = z.int().min(1);')).toEqual([]);
  });

  it('and that detector is step one’s, character for character', () => {
    // This file re-declares step one's detectors rather than importing them,
    // which is its own convention and is fine for a regex nobody has had to
    // change. `BOUND_AS` is not that: it was wrong once already, in both
    // copies, and a fix applied to one is the drift arriving rather than being
    // predicted. So the two are held equal by their own source.
    // Read with the line endings normalised. `.gitattributes` says `eol=lf`,
    // so a checkout cannot produce CRLF — but an editor on Windows can, and
    // one did, which is how this test came to fail on two byte-identical
    // declarations. A guard that reports a difference nobody wrote is a guard
    // somebody stops believing.
    const read = (path: string): string => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
    const declaration = /const BOUND_AS = [\s\S]*?\n\];/;
    const ours = declaration.exec(read(`${HERE}${GUARD_FILE}`));
    const theirs = declaration.exec(read(`${ABOVE}${GUARD_FILE}`));
    expect(ours, 'this file declares BOUND_AS').not.toBeNull();
    expect(theirs, 'step one declares BOUND_AS').not.toBeNull();
    expect(ours![0]).toBe(theirs![0]);
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

/**
 * One creature, built through the surface's own door, for the cache test
 * below to throw dice at.
 *
 * A level 1 Wizard rather than `session.test.ts`'s Kessa: everything this
 * file needs is a sheet the engine will roll against, and the shorter the
 * fixture the less there is to go stale beside a copy of it.
 */
const APPRENTICE: Record<string, unknown> = {
  name: 'Kessa',
  classId: 'wizard',
  level: 1,
  speciesId: 'human',
  backgroundId: 'sage',
  abilities: {
    method: 'standard-array',
    assignment: { str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 10 },
  },
  abilityIncreases: { int: 2, con: 1 },
  classSkills: ['investigation', 'insight'],
  languages: ['Draconic', 'Elvish'],
  alignment: 'Chaotic Good',
  cantrips: ['fire-bolt', 'light', 'prestidigitation'],
  spellbook: ['magic-missile', 'shield', 'detect-magic', 'feather-fall', 'mage-armor', 'sleep'].map(
    (spellId) => ({ spellId, acquiredAt: 1, origin: 'level' as const }),
  ),
  preparedSpells: ['magic-missile', 'shield', 'mage-armor', 'sleep'],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: [],
  hitPoints: { method: 'fixed' },
  featureChoices: { 'wizard:scholar': ['arcana'], 'human:skillful': ['perception'] },
  feats: {
    'sage:magic-initiate-wizard': {
      featId: 'magic-initiate',
      spellList: 'wizard',
      spellcastingAbility: 'int',
      cantrips: ['mage-hand', 'ray-of-frost'],
      levelOneSpell: 'find-familiar',
    },
    'human:versatile': { featId: 'skilled', proficiencies: ['stealth', 'nature', 'survival'] },
  },
};

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

  /**
   * And again over the three calls that **throw dice**, which is the half the
   * test above cannot reach: every tool it names either writes nothing or
   * asks about a creature nobody has declared, so the generator never moves.
   *
   * `rolls-issued` is the only event that moves `rng` and `rollsIssued`, and
   * a stepped cache that disagreed with a fresh fold about where the
   * generator stands would be invisible until the next roll came out
   * different — which is exactly the failure a tool surface rolling for
   * itself would cause, and the reason these three are engine commands.
   */
  it('agrees with a fresh fold after every call that throws a die', () => {
    const campaign = createCampaign({ content: SRD_CONTENT, seed: 'dm-dice-cache' });
    const surface = createDmSurface(campaign);
    let calls = 0;
    const call = (tool: string, input: unknown = {}) => {
      const outcome = surface.call({ tool, input, commandId: `toolu_${++calls}` });
      expect(outcome.status, `${tool}: ${JSON.stringify(outcome).slice(0, 300)}`).toBe('ok');
      expect(JSON.stringify(campaign.state())).toBe(
        JSON.stringify(fold(campaign.seed, campaign.log())),
      );
      return outcome;
    };

    call('create_character', { id: 'kessa', choices: APPRENTICE });
    call('ability_check', {
      who: 'kessa',
      ability: 'dex',
      dc: 12,
      advantage: 'the rope is already in her hand',
    });
    // Kessa is a Human, so a failed roll offers her Heroic Inspiration and
    // holds a window open; settling it is the protocol, and issues no die.
    if (campaign.state().pendingTest !== null) call('settle_test');
    call('saving_throw', { who: 'kessa', ability: 'con', dc: 12, disadvantage: 'the smoke' });
    if (campaign.state().pendingTest !== null) call('settle_test');
    call('roll_improvised_damage', {
      target: 'kessa',
      dice: '2d4',
      damageType: 'fire',
      ruling: 'the falling brazier',
    });

    // Non-vacuous: dice really were thrown, and the log really does say so.
    expect(campaign.state().rollsIssued).toBeGreaterThan(2);
    expect(campaign.log().filter((event) => event.type === 'rolls-issued').length).toBe(3);
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
