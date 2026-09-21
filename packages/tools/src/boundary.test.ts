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
 * sentence true, so it is four groups rather than two names, and the reason
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
 * 4. **The rollers that are not commands.** A command emits `rolls-issued`,
 *    which is the only event that moves the generator in the log. A roller
 *    called directly moves a generator, emits nothing, and hands the face to
 *    its caller. `rollAttackDamage` was on the DM list alone for this reason
 *    and is on both now: a name forbidden the wider surface and allowed the
 *    narrower one is a hole rather than an asymmetry.
 *
 * The fourth group is **derived** below rather than trusted — every public
 * engine function outside `commands/` that takes an `Rng` must be on this
 * list, so the next roller somebody exports fails this file instead of
 * slipping past it. The first three take no generator and cannot be derived,
 * which is why they are written out and why the derivation is not the whole
 * guard.
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
  // — rollers that are not commands: dice thrown outside the log ————————————
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
  'rollDeathSave',
];

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
  rollDeathSave: 'throws a death save with no command to put it in the log',
};

/** The engine's own source, for the one guard that asks what it exports. */
const ENGINE = fileURLToPath(new URL('../../engine/src/', import.meta.url));

/**
 * Every public engine function that takes an `Rng` and is not a command.
 *
 * The fourth group of {@link FORBIDDEN} written down by hand would be a list
 * that stops guarding the day somebody adds to it — which is exactly how
 * `resolveStatedD20` came to sit on the engine's surface and on neither sweep.
 * So it is read out of the engine instead, on the one criterion that separates
 * a roller from a command: a command lives under `commands/` and is handed a
 * `Supply`, while the primitives it is built from take a bare `Rng` and live
 * in the modules above. `readdirSync` is not recursive and the directory entry
 * for `commands/` is skipped, so this walk sees the primitives and nothing
 * else.
 *
 * Comments are stripped first: the engine's prose names its own rollers
 * constantly, and a sweep that read `rollAttackDamage` out of a sentence about
 * `rollAttackDamage` would find functions that do not exist.
 */
function rollersOutsideACommand(): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(ENGINE, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.ts') || entry.name.includes('.test.')) continue;
    const text = readFileSync(ENGINE + entry.name, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const match of text.matchAll(/export function (\w+)\(([\s\S]*?)\)\s*:/g)) {
      if (/\brng\s*:\s*Rng\b/.test(match[2]!)) found.push(match[1]!);
    }
  }
  return found.sort();
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
        if (FORBIDDEN.includes(name)) breaches.push(`${file} imports ${name}`);
      }
    }
    expect(breaches).toEqual([]);
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

  it('and the list keeps up with the engine: every roller outside a command is on it', () => {
    // The half of the list that can be derived, derived. A new primitive that
    // throws dice arrives on the engine's surface and fails here, rather than
    // waiting for somebody to notice it — which is the failure this whole
    // addition is a repair of.
    const rollers = rollersOutsideACommand();
    // Non-vacuous: the walk really does read the engine and find its rollers.
    expect(rollers).toContain('rollD20Recorded');
    expect(rollers).toContain('rollAttackDamage');
    expect(rollers.length).toBeGreaterThan(10);
    expect(rollers.filter((name) => !FORBIDDEN.includes(name))).toEqual([]);
  });

  it('and mints no roll of its own out of the supply it is handed', () => {
    // The sweeps above read import lines, and this route needs none.
    // `campaign.supply()` hands back a live `RollIssuer` and a live `Rng`, so
    // `supply().issuer.issue('engine')` forges the stamp `CLAUDE.md` says only
    // `rolls.ts` applies, and `supply().rng.int(20)` is a face — with no
    // forbidden name anywhere in the file.
    //
    // Nothing either produced could reach the log: `Campaign.append` has two
    // call sites and both pass a command result's own events, which is the
    // claim below this one. But a guard that stops at the import line is a
    // guard with a door in it, so the text is swept too. `campaign.ts` is the
    // one file that may name a generator, because rebuilding one per call from
    // `state.rng` is what it is for.
    const breaches: string[] = [];
    for (const { file, text } of swept()) {
      if (/\.issue\(/.test(text)) breaches.push(`${file} mints a roll provenance`);
      if (file !== 'campaign.ts' && /\.rng\b/.test(text)) {
        breaches.push(`${file} reaches for a generator`);
      }
    }
    expect(breaches).toEqual([]);
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
