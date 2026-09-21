/**
 * The three things this layer has to keep, asserted rather than assumed.
 *
 * 1. **The caller never produces a number**, which at this layer means the
 *    external-roll functions are unreachable. Not "not called today" — not
 *    *importable*, proved by sweeping this package's own imports.
 * 2. **Every `ContextRequest.kind` has a door.** `docs/design/claude-
 *    integration.md`: "a kind with no door is the failure to test for."
 * 3. **The campaign's cache is the fold.** The session boundary says
 *    `GameState` is a derived cache stepped by `applyEvent`, and that
 *    stepping and refolding agree; here that is an assertion after every
 *    call rather than a sentence.
 *
 * Unlike `fight.test.ts`, this file *does* import the engine — it has to, to
 * show that the functions it forbids are real and that the fold it compares
 * against is the engine's own.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import * as engine from '@ie/engine';
import { fold } from '@ie/engine';
import * as tools from '@ie/tools';
import {
  CONTEXT_REQUEST_KINDS,
  createCampaign,
  createSurface,
  TOOL_NAMES,
  TOOLS,
  type ToolOutcome,
} from '@ie/tools';

const HERE = fileURLToPath(new URL('.', import.meta.url));

const sources = (): { file: string; text: string }[] =>
  readdirSync(HERE)
    .filter((file) => file.endsWith('.ts'))
    .map((file) => ({ file, text: readFileSync(HERE + file, 'utf8') }));

/**
 * This file, which is the one the sweeps do not sweep.
 *
 * It holds both detectors *and* the fixtures they are tested against, so it
 * contains every forbidden form written out on purpose — and it uses a
 * namespace import to show that the functions it forbids are real. Exempting
 * it costs nothing a caller could reach: it is a test, and ships nothing.
 * `every other file is swept` is what keeps the exemption to one file.
 */
const GUARD_FILE = 'boundary.test.ts';

const swept = (): { file: string; text: string }[] =>
  sources().filter(({ file }) => file !== GUARD_FILE);

/**
 * The names this package may not import from the engine.
 *
 * `CLAUDE.md` rule 1 rests on **reachability, not a handshake**: every door an
 * AI holds reaches only commands that roll. This list is what makes that
 * sentence true, so it is several groups rather than two names, and the reason
 * for each name is beside it in {@link FORBIDDEN_BECAUSE} rather than in a
 * paragraph that goes stale the first time somebody adds to the list.
 *
 * 1. **The external-roll functions.** `recordExternalD20` and
 *    `recordExternalDamage` are for a table whose people roll their own dice,
 *    and reach one only through a door built for one — never a model.
 * 2. **The commands that state an outcome the rules decide**: hit points lost
 *    or restored, a level of Exhaustion, a completed D20 Test.
 * 3. **The stated-face seam.** A `StatedD20` is a caller reading dice out to
 *    the engine, and three functions carry one on an *options field* where the
 *    name `resolveStatedD20` never appears — a file importing `rollAttack` and
 *    filling in `statedRoll` would have passed this sweep. No command carries
 *    the field, so nothing such a file produced could reach the log today;
 *    this is the guard arriving before the command surface makes it live.
 * 4. **The rollers that hand back a roll.** A command hands back
 *    `GameEvent[]`, which is the only way a die reaches the log. Anything else
 *    that takes a generator throws dice, emits nothing, and hands the face to
 *    its caller — `rollInitiativeFor` says so about itself in as many words,
 *    and lives under `commands/`, which is why the criterion is what comes
 *    back rather than where it lives. `rollAttackDamage` was on the DM list
 *    alone for this reason and is on both now: a name forbidden the wider
 *    surface and allowed the narrower one is a hole rather than an asymmetry.
 * 5. **The supply itself.** Forbidding every roller and leaving open the
 *    functions that *make* what they roll with is the guard with the door in
 *    it: `Rng.int(20)` is a face, a seed the caller chose decides which one,
 *    and a `RollIssuer` stamps a provenance `engine` for anyone who asks.
 *    `campaign.ts` is exempt by name — see {@link REBUILDS_THE_SUPPLY} —
 *    because rebuilding both per call and throwing them away is what that file
 *    is for, and is what makes a refusal free.
 *
 * **Half of this is derived and half is argued for**, and the line does not
 * fall between the groups. Every public engine function that takes an `Rng`
 * and hands back anything but events must be on the list, which is the whole
 * of group 4 *and* the four of group 3 that take a generator — so the next
 * roller somebody exports fails this file instead of slipping past it. What
 * the derivation cannot reach is written out: `resolveStatedD20` and
 * `resolveDeathSave` take a stated face and no generator at all, groups 1 and
 * 2 are handed no bare `Rng` — `resolveDamage` takes a whole `Supply` and
 * rolls a Concentration save through it, which the second derivation beside
 * the first does reach — and group 5 *makes* a generator rather than being
 * handed one.
 */
const FORBIDDEN = [
  // — the external-roll functions, which are the rule ————————————————————————
  'recordExternalD20',
  'recordExternalDamage',
  // — outcomes the rules decide, stated as a number —————————————————————————
  'damageCreature',
  'healCreature',
  'grantTemporaryHpTo',
  'setExhaustionLevel',
  'recordD20Test',
  'resolveDamage',
  // — the stated-face seam: a face the caller produced, taken as a real roll —
  'resolveStatedD20',
  'rollD20Test',
  'rollAbilityCheck',
  'rollSavingThrow',
  'rollAttack',
  'resolveDeathSave',
  // — rollers that hand back a roll rather than events ——————————————————————
  'roll',
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
  // — the supply every roller above needs, and one file may rebuild —————————
  'createRng',
  'restoreRng',
  'createRollIssuer',
];

/**
 * The one file that may name a generator or an issuer, and the names it may.
 *
 * An exemption is the weakest thing in a guard, so it is one file and three
 * names and it is checked: a test below holds `campaign.ts` to actually
 * importing all of them, because an exemption for an import nobody makes is a
 * hole kept open for nothing.
 */
const REBUILDS_THE_SUPPLY = {
  file: 'campaign.ts',
  names: ['createRng', 'restoreRng', 'createRollIssuer'] as readonly string[],
};

const mayRebuildTheSupply = (file: string, name: string): boolean =>
  file === REBUILDS_THE_SUPPLY.file && REBUILDS_THE_SUPPLY.names.includes(name);

/**
 * Why each of them is on the list.
 *
 * A name on a guard with no reason beside it is a name the next reader has to
 * either take on trust or delete, and a name on that list that does not belong
 * is its own kind of lie. So the sentence travels with the name, and a test
 * below holds the two lists to each other.
 */
const FORBIDDEN_BECAUSE: Readonly<Record<string, string>> = {
  recordExternalD20:
    'takes the face a die showed and stamps it into a roll the engine will honour; the human-DM path, never a model one',
  recordExternalDamage:
    'the same door for damage, and the one that is not bounds-checked at all when a DM calls the number a ruling',
  damageCreature:
    'states the hit points lost as a number, and skips the Concentration save that resolveDamage settles',
  healCreature: 'states the hit points restored, which is a number the rules reach on their own',
  grantTemporaryHpTo: 'states the Temporary Hit Points, likewise',
  setExhaustionLevel: 'states a level the rules arrive at by their own arithmetic',
  recordD20Test:
    'builds the roll-recorded event out of a D20TestResult handed to it, so a hand-written literal is a forged roll with nothing left to check it',
  resolveDamage:
    'takes an amount, which is a decision the rules leave to a DM and to nobody else — see dm/boundary.test.ts, where it is the one name excused',
  resolveStatedD20:
    'the whole seam in one function: faces and a source in, a RecordedD20 the engine treats as its own out',
  rollD20Test:
    'its sixth parameter is a StatedD20, so the seam is reachable without the word resolveStatedD20 appearing anywhere',
  rollAbilityCheck: 'D20TestOptions.statedRoll carries the same faces into an ability check',
  rollSavingThrow: 'the same field on the same options, for a save',
  rollAttack:
    'AttackOptions.statedRoll is the third door onto the seam, and the one that decides whether a blow lands',
  resolveDeathSave:
    'takes a natural and a total the caller states and answers whether a creature lives; it writes no event, but it is the one place a stated face decides a life outside the seam above',
  roll: 'the raw roller — notation in, faces out, and no event anywhere',
  rollD20: 'the raw d20, for the same reason',
  rerollDice: 'rerolls faces that were never in a log to begin with',
  rollD20Recorded:
    'one of the two functions in rolls.ts that stamp a roll engine, which CLAUDE.md says only rolls.ts does',
  rollRecorded: 'the other one, and the half of it that rolls damage',
  rollBonusDice: 'throws Bless and Guidance apart from the roll they belong to',
  rerollTest: 'throws the Indomitable die with no command behind it',
  interveneAfterRoll:
    'adds a Bardic Inspiration die after a roll, which is a second number on a settled one',
  reduceDamage: 'rolls Cutting Words against a damage total',
  rollAttackDamage:
    'the engine one damage roller, and the name the DM list carried alone until now',
  rollInitiative:
    'the primitive under rollInitiativeAndBeginCombat, which is the command a caller may have instead',
  rollInitiativeFor:
    'lives under commands/ and is not one: its own note says it throws dice and hands back a number and emits nothing, which is why this list is derived on what comes back rather than on where a function lives',
  rollDeathSave: 'throws a death save with no command to put it in the log',
  createRng:
    'makes a generator from a seed the caller chose, and Rng.int hands a face straight back — which is every group above in two lines and no forbidden name at all',
  restoreRng: 'the same generator, resumed from a snapshot rather than built from a seed',
  createRollIssuer:
    'makes a RollIssuer, whose issue takes the source it stamps and refuses nothing — checkExternalSource is not exported and guards only the two external-roll functions, so the stamper is the door under the stamp',
};

/** The engine's own source, for the two guards that ask what it exports. */
const ENGINE = fileURLToPath(new URL('../../engine/src/', import.meta.url));

/**
 * Source with its comments removed, the way `doors.test.ts` reads code.
 *
 * The engine's prose names its own rollers constantly, and a sweep that read
 * `rollAttackDamage` out of a sentence about `rollAttackDamage` would find
 * functions that do not exist. A trailing `//` is stripped as well as a
 * leading one, and the `[^:]` keeps a `https://` out of it.
 */
const stripComments = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

/** Every non-test source file in the engine, at any depth. */
function engineSources(directory = ENGINE): { file: string; text: string }[] {
  const found: { file: string; text: string }[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = `${directory}${entry.name}`;
    if (entry.isDirectory()) found.push(...engineSources(`${path}/`));
    else if (entry.name.endsWith('.ts') && !entry.name.includes('.test.')) {
      found.push({ file: entry.name, text: stripComments(readFileSync(path, 'utf8')) });
    }
  }
  return found;
}

/**
 * Every public engine function that throws dice and hands back a roll.
 *
 * The roller half of {@link FORBIDDEN} written down by hand would be a list
 * that stops guarding the day somebody adds to it — which is exactly how
 * `resolveStatedD20` came to sit on the engine's surface and on neither sweep.
 * So it is read out of the engine instead.
 *
 * **The criterion is the return type, not the directory.** This walk read only
 * the modules above `commands/` at first, on the reasoning that a command is
 * handed a `Supply` and a primitive a bare `Rng`. That was simply untrue —
 * commands under `commands/` take a bare `Rng`, and `rollInitiativeFor` is a
 * *roller* that lives there too, whose own note says "it throws dice and hands
 * back a number; it emits nothing". A directory said nothing about either. So
 * the whole engine is walked, and what separates the two is what comes back: a
 * command hands over `GameEvent[]`, which is the only way a die reaches the
 * log, and anything else hands the face to its caller.
 *
 * **What it reads, exactly.** An `export function`, anywhere under
 * `engine/src`, whose signature ends in an explicit return type, with a
 * parameter spelled `rng: Rng`. Three assumptions, and a derivation is only a
 * guard while they hold — a roller declared as an arrow, or taking an `Rng`
 * under another name, or with no return type to end its signature, would be
 * invisible to it and the list would go on looking complete. Each is asserted
 * by {@link shapesTheWalkCannotRead}; this function makes no claim about any
 * of them on its own, and that note says in turn what it still does not read.
 */
function rollersThatHandBackARoll(): string[] {
  const found: string[] = [];
  for (const { text } of engineSources()) {
    for (const match of text.matchAll(/export function (\w+)\(([\s\S]*?)\)\s*:\s*([^{\n]*)/g)) {
      if (!/\brng\s*:\s*Rng\b/.test(match[2]!)) continue;
      if (/\bGameEvent\b/.test(match[3]!)) continue;
      found.push(match[1]!);
    }
  }
  return found.sort();
}

/**
 * The ways of declaring a roller that {@link rollersThatHandBackARoll} would
 * not see, found in one engine file's text.
 *
 * Four detectors rather than four sentences in a comment: a generator
 * parameter under another name, an exported function the walk could not read,
 * an `export const` holding an arrow or a function expression, named or not,
 * and a default export. Between them they say that the engine declares its
 * rollers the one way the walk reads.
 *
 * **What they still do not read, said plainly** rather than claimed away: a
 * curried arrow whose generator is in the *second* parameter list, and an
 * `export const` whose head runs past four hundred characters before it
 * reaches its arrow. Both are shapes the engine has never written — it
 * declares with `export function`, or with a short `export const` — and a
 * guard that claimed them would be the same lie one function down.
 *
 * **And a roller handed a `Supply` rather than a bare `Rng`** is invisible to
 * the walk as well, because a `Supply` is what a command takes. That is not
 * hypothetical: `commands/rolls.ts` has `rollSpellDice`, which rolls through
 * `supply.rng` and hands back damage components and no events at all. It is
 * off the list because it is off the engine's *public surface*, and that is a
 * claim rather than a fact of nature — so it is asserted beside the walk,
 * under `every public function handed a Supply hands back events`, rather
 * than left as the sentence that used to stand here saying a `Supply` taker
 * is what a command is.
 */
function shapesTheWalkCannotRead(file: string, source: string): string[] {
  const breaches: string[] = [];
  const text = stripComments(source);
  const read = [...text.matchAll(/export function (\w+)\(([\s\S]*?)\)\s*:/g)];

  // One: a generator parameter spelled something other than `rng`, which the
  // walk finds and then throws away.
  for (const match of read) {
    if (/:\s*Rng\b/.test(match[2]!) && !/\brng\s*:\s*Rng\b/.test(match[2]!)) {
      breaches.push(`${file}: ${match[1]!} takes an Rng under another name`);
    }
  }

  // Two: an exported function the walk could not read at all — which is what
  // a missing return type does to it, since the signature regex ends at `):`
  // and runs on into the body looking for one.
  const declared = [...text.matchAll(/export function (\w+)\(/g)].map((match) => match[1]!);
  if (declared.join(',') !== read.map((match) => match[1]!).join(',')) {
    breaches.push(`${file}: the walk reads ${read.length} of ${declared.length} exported functions`);
  }

  // Three: a declaration that is not an `export function` at all, which the
  // walk does not look for. An arrow and a function expression are both
  // `export const`; a default export is neither, and the engine has none.
  // The window stops at a `;` as well as at four hundred characters, or an
  // `export const LIMIT = 20;` standing above a roller is reported as the
  // roller — which is the wrong name on a true breach, and reads as a bug in
  // the guard rather than in the code.
  const heads = [
    /export const (\w+)[^;]{0,400}?\(([^)]*)\)\s*(?::[^=;]*)?=>/g,
    /export const (\w+)[^;]{0,400}?function\s*(?:\w+\s*)?\(([^)]*)\)/g,
  ];
  for (const pattern of heads) {
    for (const match of text.matchAll(pattern)) {
      if (/:\s*Rng\b/.test(match[2]!)) {
        breaches.push(`${file}: ${match[1]!} is declared with const and takes an Rng`);
      }
    }
  }
  for (const match of text.matchAll(/export default (?:function\s*)?(\w*)/g)) {
    breaches.push(`${file}: ${match[1]!} is a default export, which the walk never reads`);
  }

  return breaches;
}

/**
 * A file reaching past `supply()` for the generator or the issuer inside it.
 *
 * The import sweeps read import lines, and this route needs none:
 * `campaign.supply()` hands back a live `RollIssuer` and a live `Rng` to
 * anything holding a `Campaign`, so `issuer.issue('engine')` forges the stamp
 * `CLAUDE.md` says only `rolls.ts` applies, and `rng.int(20)` is a face — with
 * no forbidden name anywhere in the file.
 *
 * **The bindings, not the property, and the rename as much as the name.** A
 * detector reading `.rng` catches `supply().rng` and misses
 * `const { rng } = supply()`, which is how anybody would actually write it —
 * the form nobody uses caught and the form everybody would, missed. And a
 * detector reading only `{ rng }` misses `const { rng: generator }`, which is
 * how anybody writes it when `rng` is already taken. So each is looked for in
 * every shape a binding takes: a property, a plain destructure, a renamed
 * destructure, and a string key.
 *
 * **A rename is not an annotation.** `{ rng: generator }` binds and
 * `{ readonly rng: Rng }` declares, and the two are one character apart. What
 * tells them apart is the *type*: an annotation of this field names the type
 * this field has, and a rename names anything else. A lower-case target was
 * the first reading of that and it was the wrong one — `{ rng: Generator }` is
 * a rename anybody might write and it walked straight past. `doors.test.ts`
 * quotes the annotation inside a string fixture, so a guard that could not
 * tell them apart would be a guard somebody deletes.
 *
 * `campaign.ts` may name a generator and an issuer, because rebuilding both
 * per call from `state.rng` and `state.rollsIssued` and throwing them away is
 * what that file is for. It may not read a face off one, which is the half of
 * the rule an exemption would otherwise carry away with it; and the mint is
 * swept there as everywhere, because nothing above the engine stamps a roll.
 */
const BOUND_AS = (field: string, type: string): RegExp[] => [
  new RegExp(String.raw`\.${field}\b`),
  new RegExp(String.raw`\{[^}]*\b${field}\s*[,}]`),
  new RegExp(String.raw`\b${field}\s*:\s*(?!${type}\b)[A-Za-z_$][\w$]*\s*[,}=]`),
  new RegExp(String.raw`['"\`]${field}['"\`]`),
];

function reachesPastTheSupply(file: string, source: string): string[] {
  const breaches: string[] = [];
  const text = stripComments(source);
  const mayHoldOne = file === REBUILDS_THE_SUPPLY.file;

  // `issue` is the whole of what a `RollIssuer` is for, so the call is the
  // first detector and the bindings are the rest: a name it was destructured
  // to is called under that name and never under this one.
  if ([/\bissue\s*\(/, ...BOUND_AS('issue', 'RollIssuer')].some((pattern) => pattern.test(text))) {
    breaches.push(`${file} mints a roll provenance`);
  }

  if (!mayHoldOne && BOUND_AS('rng', 'Rng').some((pattern) => pattern.test(text))) {
    breaches.push(`${file} reaches for a generator`);
  }

  // And inside the one file that may hold one: it may build a generator and
  // hand it to a command, and may not read a die off it.
  if (
    mayHoldOne &&
    [/\bint\s*\(/, ...BOUND_AS('int', 'number')].some((pattern) => pattern.test(text))
  ) {
    breaches.push(`${file} reads a face off the generator it may hold`);
  }

  return breaches;
}

/** Every identifier this package imports from `@ie/engine`, file by file. */
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

/**
 * The ways of reaching `@ie/engine` that the name sweep cannot read.
 *
 * A named-import sweep is a guard only while named imports are the only
 * door, and they are not: a namespace import reaches every export through a
 * property, `export * from '@ie/engine'` would republish the external-roll
 * functions on **this package's own** public surface in silence, and a
 * dynamic import is invisible to any regex over the import section. So the
 * second half of the rule is that none of those forms appears at all — a
 * blunt instrument, and the right one, because this package has never needed
 * one and a file that starts needing one should have to say so here.
 */
const OPAQUE_IMPORT_FORMS: readonly { readonly what: string; readonly pattern: RegExp }[] = [
  { what: 'a namespace import', pattern: /import\s+\*\s+as\s+\w+\s+from\s*'@ie\/engine'/ },
  { what: 'a star re-export', pattern: /export\s+\*\s+(?:as\s+\w+\s+)?from\s*'@ie\/engine'/ },
  { what: 'a named re-export', pattern: /export\s+(?:type\s+)?\{[^}]*\}\s*from\s*'@ie\/engine'/ },
  { what: 'a dynamic import', pattern: /import\s*\(\s*'@ie\/engine'\s*\)/ },
];

describe('the surface cannot reach the external-roll functions', () => {
  it('and they are real, so the guard is aimed at something', () => {
    // A guard nothing can reach is not a rule. These exist on the engine's
    // public surface for a human DM, and that is exactly why this matters.
    expect(typeof (engine as Record<string, unknown>)['recordExternalD20']).toBe('function');
    expect(typeof (engine as Record<string, unknown>)['recordExternalDamage']).toBe('function');
  });

  it('imports none of them, in any file of this package', () => {
    const breaches: string[] = [];
    for (const { file, text } of swept()) {
      for (const name of engineImports(text)) {
        if (FORBIDDEN.includes(name) && !mayRebuildTheSupply(file, name)) {
          breaches.push(`${file} imports ${name}`);
        }
      }
    }
    expect(breaches).toEqual([]);
  });

  it('and the one exemption on that sweep is real, and is one file', () => {
    // An exemption nobody uses is a hole held open for nothing, and an
    // exemption nobody checks is a list of names somebody can add to. So
    // `campaign.ts` has to actually make both imports for the sentence
    // excusing it to mean anything.
    const campaign = swept().find(({ file }) => file === REBUILDS_THE_SUPPLY.file);
    expect(campaign, 'the exempt file exists').toBeDefined();
    for (const name of REBUILDS_THE_SUPPLY.names) {
      expect(engineImports(campaign!.text), name).toContain(name);
    }
    // And the exemption is aimed at the list: a name excused here that nothing
    // forbids is a sentence about nothing.
    expect(REBUILDS_THE_SUPPLY.names.filter((name) => !FORBIDDEN.includes(name))).toEqual([]);
  });

  it('reaches the engine only through named imports, which the sweep can read', () => {
    const breaches: string[] = [];
    for (const { file, text } of swept()) {
      for (const { what, pattern } of OPAQUE_IMPORT_FORMS) {
        if (pattern.test(text)) breaches.push(`${file} reaches @ie/engine through ${what}`);
      }
    }
    expect(breaches).toEqual([]);
  });

  it('and between them the two sweeps catch every way of writing it', () => {
    // A detector nobody tested is a guard nobody tested. These are the forms
    // a breach could actually take, written out and fed to the detectors
    // rather than trusted to a reading of the regex.
    //
    // **Every name, not a sample.** Two of the forms below are caught by the
    // shape of the import rather than by the name inside it, so a sample would
    // pass for a name the name sweep could not actually read. The loop is what
    // makes "in every import form" a claim about the list and not about the
    // two entries somebody happened to write out.
    const caught = (text: string) =>
      engineImports(text).some((name) => FORBIDDEN.includes(name)) ||
      OPAQUE_IMPORT_FORMS.some(({ pattern }) => pattern.test(text));

    for (const name of FORBIDDEN) {
      expect(caught(`import { ${name} } from '@ie/engine';`), name).toBe(true);
      expect(caught(`import { ${name} as alias } from '@ie/engine';`), name).toBe(true);
      expect(caught(`import type { ${name} } from '@ie/engine';`), name).toBe(true);
      expect(caught(`export { ${name} } from '@ie/engine';`), name).toBe(true);
      expect(caught(`const { ${name} } = await import('@ie/engine');`), name).toBe(true);
    }
    // And the two forms that name nothing at all, which no loop over names
    // would ever produce.
    expect(caught("import * as anything from '@ie/engine';")).toBe(true);
    expect(caught("export * from '@ie/engine';")).toBe(true);
    // And it does not cry wolf at the imports this package actually makes.
    expect(caught("import { resolveAttack, resolveSpell } from '@ie/engine';")).toBe(false);
    expect(caught("import { resolveAttackDamage, settleDamage } from '@ie/engine';")).toBe(false);
  });

  it('and every name on it says why, in a sentence', () => {
    // `FORBIDDEN_BECAUSE` is the reason and `FORBIDDEN` is the guard; two
    // lists that can drift are one list with a lie in it, so they are held
    // to each other rather than read side by side.
    expect(Object.keys(FORBIDDEN_BECAUSE).sort()).toEqual([...FORBIDDEN].sort());
    expect(Object.values(FORBIDDEN_BECAUSE).filter((why) => why.length <= 20)).toEqual([]);
  });

  it('and every one of them is really on the engine’s surface', () => {
    // A guard aimed at a name the engine does not export is not a guard — the
    // claim `dm/boundary.test.ts` has always made about its own list, and the
    // one this file was missing while it had only two names to make it about.
    for (const name of FORBIDDEN) {
      expect(typeof (engine as Record<string, unknown>)[name], name).toBe('function');
    }
  });

  it('and the list keeps up with the engine: every roller that hands one back is on it', () => {
    // The half of the list that can be derived, derived. A new primitive that
    // throws dice arrives on the engine's surface and fails here, rather than
    // waiting for somebody to notice it — which is the failure this whole
    // addition is a repair of.
    const rollers = rollersThatHandBackARoll();
    // Non-vacuous: the walk really does read the engine and find its rollers,
    // including the one under `commands/` that is not a command.
    expect(rollers).toContain('rollD20Recorded');
    expect(rollers).toContain('rollAttackDamage');
    expect(rollers).toContain('rollInitiativeFor');
    expect(rollers.length).toBeGreaterThan(10);
    expect(rollers.filter((name) => !FORBIDDEN.includes(name))).toEqual([]);
  });

  it('and every public function handed a Supply hands back events', () => {
    // The other half of the criterion. The walk reads a bare `rng: Rng`, so a
    // roller handed a whole `Supply` is invisible to it — and there is one:
    // `rollSpellDice` rolls through `supply.rng` and hands back damage
    // components. What keeps it off the list is that it is not exported from
    // the engine, which is a claim about the barrel and therefore checkable.
    //
    // "Hands back events" is `GameEvent[]` directly, or a named outcome that
    // declares an `events` field — `Result<AttackResolution>` and the two
    // dozen like it.
    const all = engineSources()
      .map(({ text }) => text)
      .join('\n');
    const handsBackEvents = (returnType: string): boolean => {
      if (/\bGameEvent\b/.test(returnType)) return true;
      const named = /Result<\s*(?:readonly\s+)?(\w+)/.exec(returnType);
      if (named === null) return false;
      const body = new RegExp(
        String.raw`interface ${named[1]!}\s*(?:extends [\w\s,<>]*)?\{([\s\S]*?)\n\}`,
      ).exec(all);
      return body !== null && /\bevents\s*[?:]/.test(body[1]!);
    };

    const takers: string[] = [];
    const silent: string[] = [];
    for (const { text } of engineSources()) {
      for (const match of text.matchAll(/export function (\w+)\(([\s\S]*?)\)\s*:\s*([^{\n]*)/g)) {
        if (!/:\s*Supply\b/.test(match[2]!)) continue;
        if (typeof (engine as Record<string, unknown>)[match[1]!] !== 'function') continue;
        takers.push(match[1]!);
        if (!handsBackEvents(match[3]!)) silent.push(`${match[1]!} -> ${match[3]!.trim()}`);
      }
    }
    expect(silent).toEqual([]);
    // Non-vacuous twice over: there really are public `Supply` takers, and the
    // roller this is about really is not one of them.
    expect(takers).toContain('resolveAttack');
    expect(takers.length).toBeGreaterThan(10);
    expect(takers).not.toContain('rollSpellDice');
    expect((engine as Record<string, unknown>)['rollSpellDice']).toBeUndefined();
  });

  it('and it tells a command from a roller by what comes back, not by where it lives', () => {
    // The claim the criterion rests on: under `commands/` there are functions
    // that take a bare generator and *are* commands, and one that is not. If
    // that stopped being true — if every roller lived above `commands/` after
    // all — the sharper reading below would be free, and it is not.
    const commands = engineSources().flatMap(({ text }) =>
      [...text.matchAll(/export function (\w+)\(([\s\S]*?)\)\s*:\s*([^{\n]*)/g)]
        .filter((match) => /\brng\s*:\s*Rng\b/.test(match[2]!) && /\bGameEvent\b/.test(match[3]!))
        .map((match) => match[1]!),
    );
    expect(commands.length).toBeGreaterThan(0);
    // And none of them is forbidden: a command that rolls is the one thing
    // this surface is supposed to reach.
    expect(commands.filter((name) => FORBIDDEN.includes(name))).toEqual([]);
    expect(commands).toContain('recordInitiativeRolls');
  });

  it('and nothing the walk cannot read throws dice: its assumptions, asserted', () => {
    // A derivation that quietly reads less than it used to is worse than a
    // hand list, because a hand list at least does not claim to keep up. Every
    // assumption `rollersThatHandBackARoll` makes about *how* a roller is
    // declared is checked over the engine's own text, at every depth.
    const breaches = engineSources().flatMap(({ file, text }) =>
      shapesTheWalkCannotRead(file, text),
    );
    expect(breaches).toEqual([]);
    // Non-vacuous: it really did read the engine, `commands/` included.
    expect(engineSources().map(({ file }) => file)).toContain('initiative.ts');
  });

  it('and those detectors catch the shapes they are aimed at', () => {
    // A detector nobody tested is a guard nobody tested, and these four are
    // aimed at code that does not exist yet — so the fixtures are the only
    // way to know they would fire. Each is a roller written the way the walk
    // cannot read, and each must come back named.
    const caught = (source: string) => shapesTheWalkCannotRead('probe.ts', source);

    expect(
      caught(
        'export function rollThing(issuer: RollIssuer, generator: Rng): number {\n  return 1;\n}\n',
      ),
    ).toEqual(['probe.ts: rollThing takes an Rng under another name']);

    expect(
      caught('export function rollThing(issuer: RollIssuer, rng: Rng) {\n  return 1;\n}\n'),
    ).toContain('probe.ts: the walk reads 0 of 1 exported functions');

    expect(caught('export const rollThing = (rng: Rng): number => rng.int(20);\n')).toEqual([
      'probe.ts: rollThing is declared with const and takes an Rng',
    ]);

    expect(
      caught('export const rollThing = function (rng: Rng): number {\n  return rng.int(20);\n};\n'),
    ).toEqual(['probe.ts: rollThing is declared with const and takes an Rng']);

    expect(
      caught('export default function rollThing(rng: Rng) {\n  return rng.int(20);\n}\n'),
    ).toContain('probe.ts: rollThing is a default export, which the walk never reads');

    // And it does not cry wolf at the way the engine actually writes one, nor
    // at a short `export const` that holds no generator at all.
    expect(
      caught('export function rollThing(issuer: RollIssuer, rng: Rng): number {\n  return 1;\n}\n'),
    ).toEqual([]);
    expect(caught('export const skillName = (skill: Skill): string => NAMES[skill];\n')).toEqual([]);
    // And a constant standing above a roller is not the roller: the window
    // stops at the semicolon, or the breach comes back under the wrong name.
    expect(
      caught(
        "export const LABEL = 'Initiative';\nfunction rollIt(rng: Rng): number {\n  return rng.int(20);\n}\n",
      ),
    ).toEqual([]);
  });

  it('and mints no roll of its own out of the supply it is handed', () => {
    // Nothing either could produce reaches the log: `Campaign.append` has two
    // call sites and both pass a command result's own events, which is the
    // claim below this one. But a guard that stops at the import line is a
    // guard with a door in it, so the text is swept too.
    const breaches = swept().flatMap(({ file, text }) => reachesPastTheSupply(file, text));
    expect(breaches).toEqual([]);
  });

  it('and that detector catches the way anybody would write it', () => {
    // The detector this file had first read `.rng`, which catches the form
    // nobody uses and misses the one everybody would; the one after that read
    // the plain destructure and missed the rename. These are every shape, fed
    // to it rather than trusted to a reading of the regex — and the ones it
    // must not cry wolf at.
    const caught = (source: string) => reachesPastTheSupply('probe.ts', source);
    const exempt = (source: string) => reachesPastTheSupply(REBUILDS_THE_SUPPLY.file, source);
    const generator = ['probe.ts reaches for a generator'];
    const mint = ['probe.ts mints a roll provenance'];

    expect(caught('const { rng } = campaign.supply();\nrng.int(20);\n')).toEqual(generator);
    expect(caught('const { rng, issuer, content } = campaign.supply();\n')).toEqual(generator);
    expect(caught('const supply = campaign.supply();\nsupply.rng.int(20);\n')).toEqual(generator);
    expect(caught("const g = campaign.supply()['rng'];\n")).toEqual(generator);
    expect(caught('const g = campaign.supply()[`rng`];\n')).toEqual(generator);
    // The rename, in both the shapes it takes.
    expect(caught('const { rng: generator } = campaign.supply();\ngenerator.int(20);\n')).toEqual(
      generator,
    );
    expect(caught('const { supply: { rng: g } } = holder;\ng.int(20);\n')).toEqual(generator);
    // A capitalised rename is still a rename: what tells one from an
    // annotation is the type named, not the case of the name.
    expect(caught('const { rng: Generator } = campaign.supply();\nGenerator.int(20);\n')).toEqual(
      generator,
    );

    expect(caught("campaign.supply().issuer.issue('engine');\n")).toEqual(mint);
    expect(caught("const { issue } = campaign.supply().issuer;\nissue('engine');\n")).toEqual(mint);
    expect(caught("const { issue: mint } = campaign.supply().issuer;\nmint('engine');\n")).toEqual(
      mint,
    );
    expect(caught("const mint = campaign.supply().issuer.issue;\nmint('engine');\n")).toEqual(mint);

    // A type annotation naming the field is not a binding — `doors.test.ts`
    // quotes one inside a string fixture, and a guard that fired on it would
    // be a guard somebody deletes. What tells them apart is the type named:
    // an annotation of this field names the type this field has, and the
    // rename fixtures above show one naming anything else, in either case.
    expect(caught('const declare = (supply: { readonly rng: Rng }): void => undefined;\n')).toEqual(
      [],
    );
    expect(caught('interface Supply {\n  readonly issue: RollIssuer;\n}\n')).toEqual([]);
    // And passing the supply whole, which is the only thing a tool should do
    // with it, is not a breach.
    expect(caught('resolveAttack(state, campaign.supply(), identity(context));\n')).toEqual([]);
    // Nor is the word arriving inside a longer one.
    expect(caught('const spent = state.rollsIssued;\n')).toEqual([]);

    // The exempt file may build both and hand them over, and may not read a
    // face off one.
    expect(exempt('rng: cached.rng === null ? createRng(seed) : restoreRng(cached.rng),\n')).toEqual(
      [],
    );
    expect(exempt("issuer: createRollIssuer('r', cached.rollsIssued),\n")).toEqual([]);
    expect(exempt('const face = createRng(seed).int(20);\n')).toEqual([
      `${REBUILDS_THE_SUPPLY.file} reads a face off the generator it may hold`,
    ]);
    expect(exempt("const face = createRng(seed)['int'](20);\n")).toEqual([
      `${REBUILDS_THE_SUPPLY.file} reads a face off the generator it may hold`,
    ]);
    // And this is why the `int` detectors run *only* there: `z.int()` is all
    // over the schemas and would read as a die everywhere else. The exempt
    // file holds no Zod, so inside it the reading is unambiguous — and the
    // fixture says so rather than leaving the confinement looking arbitrary.
    expect(caught('const n = z.int().min(1);\n')).toEqual([]);
    expect(exempt('const n = z.int().min(1);\n')).toEqual([
      `${REBUILDS_THE_SUPPLY.file} reads a face off the generator it may hold`,
    ]);
    // And it is not exempt from the mint: nothing above the engine stamps.
    expect(exempt("createRollIssuer('r', 0).issue('engine');\n")).toContain(
      `${REBUILDS_THE_SUPPLY.file} mints a roll provenance`,
    );
  });

  it('publishes neither of them on its own surface', () => {
    // The end of the argument. Whatever the source says, what a caller can
    // reach is what `@ie/tools` exports, and neither name is on it.
    const published = Object.keys(tools);
    expect(published.filter((name) => /^record(External|D20)/.test(name))).toEqual([]);
    // Non-vacuous: the barrel does publish things.
    expect(published).toContain('createSurface');
  });

  it('sweeps something: this package does import the engine', () => {
    // The name sweep is vacuous if the regex matches nothing, which is how a
    // guard quietly stops guarding. It has to find the imports that *are*
    // there before its silence means anything.
    const all = swept().flatMap(({ text }) => engineImports(text));
    expect(all).toContain('resolveAttack');
    expect(all).toContain('resolveSpell');
  });

  it('exempts exactly one file, and it is the one holding the detectors', () => {
    expect(sources().map(({ file }) => file)).toContain(GUARD_FILE);
    expect(sources().length - swept().length).toBe(1);
    expect(swept().map(({ file }) => file)).not.toContain(GUARD_FILE);
  });

  it('and the fight is driven without reaching past the surface at all', () => {
    // `fight.test.ts` runs a whole fight through `surface.call`. If it needed
    // the engine, the package would not yet be a door — so its import list is
    // part of the claim rather than a convention.
    //
    // `routes.test.ts` is held to the same claim for the same reason, and it
    // is the sharper of the two: it drives a refusal, the answer to it and the
    // resolution that follows, including the patch of ground that provokes the
    // question. An engine import there would mean the loop closes only for a
    // caller that can reach past the door — which is the defect the file is
    // about.
    for (const file of ['fight.test.ts', 'routes.test.ts']) {
      const driven = sources().find((source) => source.file === file);
      expect(driven).toBeDefined();
      expect(driven!.text).not.toContain("from '@ie/engine'");
    }
  });

  it('publishes no tool whose name suggests one', () => {
    expect(TOOL_NAMES.filter((name) => /external|record_d20|set_hp|deal_damage/.test(name))).toEqual([]);
  });

  it('answers a call to one as an unknown tool, not as a refusal', () => {
    const surface = createSurface(createCampaign({ content: SRD_CONTENT, seed: 'boundary' }));
    for (const tool of ['record_external_d20', 'recordExternalD20', 'record_external_damage']) {
      const outcome = surface.call({ tool, input: {}, commandId: 'toolu_1' });
      expect(outcome.status).toBe('invalid');
      if (outcome.status !== 'invalid') continue;
      expect(outcome.code).toBe('unknown_tool');
    }
  });
});

describe('nothing reaches the log except through an engine command', () => {
  it('has exactly the two append call sites it documents', () => {
    // `Campaign.append` is the only writer, and it cannot check what it is
    // handed. So the discipline is here: two call sites, both passing a
    // `Result`'s own events. A third has to be argued for by moving this
    // number, which is what makes it a decision rather than a drift.
    const definitions = sources().find((source) => source.file === 'definitions.ts')!;
    const sites = definitions.text.match(/campaign\.append\(/g) ?? [];
    expect(sites).toHaveLength(2);
    // And nothing else in the package appends at all.
    for (const { file, text } of swept()) {
      if (file === 'definitions.ts' || file === 'campaign.ts') continue;
      expect(text).not.toContain('.append(');
    }
  });
});

describe('every context request kind has a door', () => {
  it('and the doors are tools on this surface', () => {
    const surface = createSurface(createCampaign({ content: SRD_CONTENT, seed: 'boundary' }));
    const missing = CONTEXT_REQUEST_KINDS.filter((kind) => surface.doorsFor(kind).length === 0);
    expect(missing).toEqual([]);
    for (const kind of CONTEXT_REQUEST_KINDS) {
      for (const door of surface.doorsFor(kind)) expect(TOOL_NAMES).toContain(door);
    }
  });

  it('declares no kind the engine does not have', () => {
    const declared = new Set(TOOLS.flatMap((definition) => definition.establishes));
    for (const kind of declared) expect(CONTEXT_REQUEST_KINDS).toContain(kind);
  });
});

describe('a refusal is a value', () => {
  const table = () => {
    const campaign = createCampaign({ content: SRD_CONTENT, seed: 'boundary' });
    const surface = createSurface(campaign);
    let calls = 0;
    const call = (tool: string, input: unknown = {}): ToolOutcome =>
      surface.call({ tool, input, commandId: `toolu_${++calls}` });
    return { campaign, surface, call };
  };

  it('a rules refusal comes back as a refusal, with a code and a reason', () => {
    const t = table();
    t.call('set_scene', { width: 30, depth: 30, height: 10 });
    // The room is thirty feet across and the landmark is a hundred feet out.
    // Nothing the caller could declare makes that fit, so it is a verdict and
    // not homework — and it arrives as a value either way.
    const outcome = t.call('add_landmark', { name: 'the far tree', at: { x: 100, y: 100 } });
    expect(outcome.status).toBe('refused');
    if (outcome.status !== 'refused') return;
    expect(outcome.code.length).toBeGreaterThan(0);
    expect(outcome.reason.length).toBeGreaterThan(0);
  });

  it('a missing fact comes back as a question naming what would settle it', () => {
    const t = table();
    // No scene has been set, so where a creature stands is not a thing the
    // engine can be wrong about — it has not been told.
    const outcome = t.call('place_creature', { who: 'kessa', fromLandmark: 'the bar', feet: 0 });
    expect(outcome.status).toBe('needs-context');
    if (outcome.status !== 'needs-context') return;
    expect(outcome.establish.length).toBeGreaterThan(0);
    const asked = outcome.establish[0]!;
    expect(asked.kind).toBe('scene');
    expect(asked.need.length).toBeGreaterThan(0);
    expect(asked.because.length).toBeGreaterThan(0);
    // The engine's own prose, untouched — and the doors on *this* surface.
    expect(asked.satisfyWith).toContain('setScene');
    expect(asked.tools).toContain('set_scene');
  });

  it('a refusal writes nothing and spends no die', () => {
    const t = table();
    const before = { log: t.campaign.log().length, rolls: t.campaign.state().rollsIssued };
    expect(t.call('place_creature', { who: 'kessa', fromLandmark: 'the bar', feet: 0 }).status).toBe(
      'needs-context',
    );
    expect(t.campaign.log()).toHaveLength(before.log);
    expect(t.campaign.state().rollsIssued).toBe(before.rolls);
  });
});

describe('the campaign cache is the fold', () => {
  it('agrees with a fresh fold after every call', () => {
    const campaign = createCampaign({ content: SRD_CONTENT, seed: 'boundary' });
    const surface = createSurface(campaign);
    let calls = 0;
    const call = (tool: string, input: unknown = {}) => {
      surface.call({ tool, input, commandId: `toolu_${++calls}` });
      expect(JSON.stringify(campaign.state())).toBe(
        JSON.stringify(fold(campaign.seed, campaign.log())),
      );
    };

    call('set_scene', { width: 30, depth: 30, height: 10 });
    call('add_landmark', { name: 'the well', at: { x: 5, y: 5 } });
    call('place_creature', { who: 'nobody', fromLandmark: 'the well', feet: 5 });
    call('look');
  });
});

describe('a campaign draws exactly one thing nobody chose', () => {
  it('uses the seed it was given', () => {
    expect(createCampaign({ content: SRD_CONTENT, seed: 'chosen' }).seed).toBe('chosen');
  });

  it('draws one when it is not given, and two campaigns do not share it', () => {
    const a = createCampaign({ content: SRD_CONTENT });
    const b = createCampaign({ content: SRD_CONTENT });
    expect(a.seed).not.toBe(b.seed);
    expect(a.seed.length).toBeGreaterThan(0);
  });
});
