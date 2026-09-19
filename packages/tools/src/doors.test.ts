/**
 * A door for every fact the engine can be told, swept rather than remembered.
 *
 * Four times in two sessions a room was finished in the engine and the door
 * above it left shut, and each was found by accident: `move` declared
 * `establishes: ['route']` with no `route` field to receive one; `cast_spell`
 * had nowhere to name a damage type, so Spirit Guardians was uncastable;
 * `featChoice` had no `abilities`, so the Ability Score Improvement this
 * repository publishes could not be taken; and `declareFalling` landed in the
 * engine reachable from no tool, so Feather Fall was uncastable from the
 * surface that exists to cast it. Three of the four were patched one at a
 * time as they were stumbled over. This file is the sweep.
 *
 * ## What each guard proves, and why it is derived rather than listed
 *
 * | Guard | Claim |
 * |---|---|
 * | *a kind, a door* | every `ContextRequest.kind` the engine can **raise** has a tool that declares it |
 * | *a declaration, a field* | every `establishes` on a tool names fields that tool's schema really has |
 * | *a fact, a tool* | every `declare*` command the engine exports is either a tool or a recorded exclusion |
 * | *a refusal, an answer* | every refusal naming a fact the caller must supply is answerable through a field, or a recorded exclusion |
 *
 * **Every set on the left of those claims is read out of the engine's own
 * source**, never retyped here: the kinds out of `ContextRequest`, the
 * declarations out of `commands/`, the codes out of the `err` literals the
 * engine actually writes. A guard over a hand-written list stops guarding the
 * day somebody adds the thirteenth item and does not think to come here,
 * which is precisely how the four gaps above were able to land. The tables in
 * this file are *answers*, and each is asserted to cover exactly the derived
 * set — so a new kind, a new declaration or a new refusal fails here until
 * somebody says which door answers it, or says in writing that none does.
 *
 * **A field is proved to exist by sending it a malformed value.** Zod objects
 * strip unknown keys in silence, so a call carrying a field the schema has
 * never heard of *succeeds*, and asserting that it succeeds proves nothing at
 * all. An issue raised **at that path** can only come from a schema that has
 * the field and checked it. `routes.test.ts` established the technique for
 * `route`; this file generalises it.
 *
 * It imports no engine, which costs nothing here — every claim is about the
 * engine's *source text* or about this surface's behaviour.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import {
  CONTEXT_REQUEST_KINDS,
  DM_TOOL_NAMES,
  createCampaign,
  createSurface,
  TOOLS,
  TOOL_NAMES,
  type InvalidOutcome,
} from '@ie/tools';

// — reading the packages below this one ————————————————————————————————————

const HERE = fileURLToPath(new URL('.', import.meta.url));
const ENGINE = join(HERE, '..', '..', 'engine', 'src');
const SHARED = join(HERE, '..', '..', 'shared', 'src');

/**
 * Source with its comments removed.
 *
 * Every sweep below reads code, and this package's prose quotes its own
 * vocabulary constantly — `satisfyWith`, `route_required` and half the
 * declaration names appear in doc comments explaining them. A sweep that
 * counted those would find doors that do not exist, which is the failure mode
 * opposite to the one this file is about and just as useless.
 */
const stripComments = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

/** Every non-test source file under a package, recursively. */
function sourcesUnder(dir: string): { file: string; text: string }[] {
  const found: { file: string; text: string }[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) found.push(...sourcesUnder(path));
    else if (entry.endsWith('.ts') && !entry.includes('.test.')) {
      found.push({ file: entry, text: stripComments(readFileSync(path, 'utf8')) });
    }
  }
  return found;
}

const engineSources = (): { file: string; text: string }[] => sourcesUnder(ENGINE);

/** The surface's own source, for the two guards that ask what it calls. */
const definitionsText = (): string => readFileSync(join(HERE, 'definitions.ts'), 'utf8');
const dmDefinitionsText = (): string => readFileSync(join(HERE, 'dm', 'definitions.ts'), 'utf8');

// — the probe: does this tool really have this field? ——————————————————————

const surface = () => createSurface(createCampaign({ content: SRD_CONTENT, seed: 'doors' }));

/**
 * `{ a: { b: value } }` from `'a.b'`.
 *
 * A dotted path is how an `InvalidOutcome` reports a field, so it is what the
 * tables below are written in, and a probe has to be able to build one. A
 * record's key is a path segment like any other: `choices.feats.the-slot.
 * abilities` builds the entry a feat choice lives in, which is the level the
 * Ability Score Improvement gap was at.
 */
function nest(path: string, value: unknown): unknown {
  const segments = path.split('.');
  let built: unknown = value;
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    built = { [segments[index]!]: built };
  }
  return built;
}

/**
 * Two values, between them wrong for every field on this surface.
 *
 * A string is not a number, a boolean, an object or an array; a number is not
 * a string. So one of the two is rejected by any field a schema really has —
 * and a field it does not have takes both in silence.
 */
const PROBES: readonly unknown[] = ['not a value of this kind', -1];

/** Every path Zod complained about, for one call. */
function issuePaths(tool: string, input: unknown): readonly string[] {
  const outcome = surface().call({ tool, input, commandId: `probe:${tool}` });
  if (outcome.status !== 'invalid') return [];
  return (outcome as InvalidOutcome).issues.map((issue) => issue.path);
}

/** Whether the tool's schema has this field, proved by it refusing one. */
const hasField = (tool: string, path: string): boolean =>
  PROBES.some((probe) => issuePaths(tool, nest(path, probe)).includes(path));

/** `move.route` → the tool and the path inside its arguments. */
function split(reference: string): { tool: string; path: string } {
  const at = reference.indexOf('.');
  return { tool: reference.slice(0, at), path: reference.slice(at + 1) };
}

/** Every `tool.path` that is not really there, with what was wrong. */
function shutDoors(references: readonly string[]): string[] {
  const shut: string[] = [];
  for (const reference of references) {
    const { tool, path } = split(reference);
    if (!TOOL_NAMES.includes(tool)) shut.push(`${reference}: there is no tool ${tool}`);
    else if (!hasField(tool, path)) shut.push(`${reference}: ${tool} has no field ${path}`);
  }
  return shut;
}

// — the probe, aimed at something ——————————————————————————————————————————

describe('the probe can tell a field that exists from one that does not', () => {
  /**
   * The detector's own test, and the reason the rest of this file means
   * anything. A guard built on `hasField` is worth exactly what `hasField` is
   * worth, and "Zod strips unknown keys" is a claim about a library rather
   * than something this repository decides — so it is asserted here, both
   * ways, against fields that are known to exist and a name that cannot.
   */
  it('finds a field the schema has', () => {
    expect(hasField('move', 'route')).toBe(true);
    expect(hasField('cast_spell', 'damageType')).toBe(true);
    expect(hasField('create_character', 'choices.feats.the-slot.abilities')).toBe(true);
  });

  it('does not find one it has not', () => {
    expect(hasField('move', 'the_way_they_went')).toBe(false);
    expect(hasField('cast_spell', 'flavour')).toBe(false);
    expect(hasField('create_character', 'choices.feats.the-slot.vibes')).toBe(false);
  });

  /**
   * And the thing that makes the probe necessary rather than fussy: a call
   * carrying a field nothing has heard of is not refused. It succeeds as far
   * as the schema is concerned, and whatever the caller meant by it is gone.
   */
  it('because a field the schema has not is accepted and thrown away', () => {
    const outcome = surface().call({
      tool: 'set_scene',
      input: { width: 30, depth: 30, height: 10, ceilingIsGlass: true },
      commandId: 'probe:silence',
    });
    expect(outcome.status).toBe('ok');
  });
});

// — guard one: a kind, and a door ——————————————————————————————————————————

/**
 * The vocabulary, read out of `@ie/shared` rather than remembered.
 *
 * `outcome.ts` holds a `Record<ContextRequestKind, true>` whose totality the
 * compiler checks, which catches a kind the *type* grows. This catches the
 * other direction — a list that has quietly stopped being the union it claims
 * to mirror — and costs one regex.
 */
function declaredKinds(): readonly string[] {
  const text = stripComments(readFileSync(join(SHARED, 'result.ts'), 'utf8'));
  const union = /readonly kind:([^;]*);/.exec(text);
  expect(union).not.toBeNull();
  return [...union![1]!.matchAll(/'([a-z-]+)'/g)].map((match) => match[1]!);
}

/**
 * The kinds the engine can actually **raise**, by where it writes them.
 *
 * Every `ContextRequest` literal ends in `satisfyWith`, so each occurrence of
 * that word is one request, and the `kind` nearest above it is that request's.
 * Reading the kinds this way rather than off the union is the difference
 * between "the type permits it" and "some command emits it" — and the latter
 * is what a caller meets.
 */
function raisedKinds(): ReadonlyMap<string, string> {
  const raised = new Map<string, string>();
  for (const { file, text } of engineSources()) {
    for (const found of text.matchAll(/satisfyWith\s*:/g)) {
      const above = [...text.slice(0, found.index).matchAll(/kind\s*:\s*'([a-z-]+)'/g)];
      const nearest = above[above.length - 1];
      expect(nearest, `a request in ${file} with no kind above it`).toBeDefined();
      if (!raised.has(nearest![1]!)) raised.set(nearest![1]!, file);
    }
  }
  return raised;
}

describe('every kind of fact the engine can ask for has a door', () => {
  it('holds the vocabulary `@ie/shared` declares, and not a copy of it', () => {
    expect([...CONTEXT_REQUEST_KINDS].sort()).toEqual([...declaredKinds()].sort());
  });

  it('sweeps something: the engine raises most of the kinds it declares', () => {
    // A sweep that matched nothing would pass every assertion below it in
    // silence, which is how a guard stops guarding. The engine raises every
    // kind it declares today; the assertion is deliberately the weaker one,
    // because a kind declared before the command that raises it is a
    // legitimate order to build things in.
    const raised = raisedKinds();
    expect(raised.size).toBeGreaterThan(declaredKinds().length / 2);
    expect([...raised.keys()]).toContain('route');
  });

  it('raises no kind the vocabulary does not declare', () => {
    const declared = declaredKinds();
    const strays = [...raisedKinds().entries()].filter(([kind]) => !declared.includes(kind));
    expect(strays).toEqual([]);
  });

  /**
   * The claim `docs/design/claude-integration.md` makes — "a kind with no door
   * is the failure to test for" — asked of the kinds the engine *raises*
   * rather than of a list. `boundary.test.ts` asks it of the list, which is
   * the same question one remove further from the engine.
   */
  it('has a tool declaring every kind a command can raise', () => {
    const doors = surface();
    const shut = [...raisedKinds().entries()].filter(
      ([kind]) => doors.doorsFor(kind as (typeof CONTEXT_REQUEST_KINDS)[number]).length === 0,
    );
    expect(shut).toEqual([]);
    for (const [kind] of raisedKinds()) {
      for (const door of doors.doorsFor(kind as (typeof CONTEXT_REQUEST_KINDS)[number])) {
        expect(TOOL_NAMES).toContain(door);
      }
    }
  });
});

// — guard two: a declaration, and the fields that carry it —————————————————

/**
 * Which fields carry the fact each tool declares it establishes.
 *
 * `establishes` is a list of kinds and a Zod schema is a value nothing
 * compares it against, so the two halves can disagree in total silence: that
 * was gap one, where `move` promised `route` and had no field for it, and a
 * model told by a refusal to send a route sent one into nothing.
 *
 * The pairing is written out because it cannot be derived — which field of a
 * call carries which fact is a fact about meaning. What *is* derived is the
 * left-hand side: the set of `(tool, kind)` pairs below is asserted to be
 * exactly the set the surface declares, so a new door with no field fails
 * here rather than in a session.
 */
const ESTABLISHING_FIELDS: Readonly<Record<string, readonly string[]>> = {
  'create_character:creature': ['id', 'choices'],
  'declare_creature_type:creature-type': ['who', 'creatureType'],
  'set_scene:scene': ['width', 'depth', 'height'],
  'add_landmark:scene': ['name', 'at'],
  'place_creature:position': ['who', 'feet'],
  'declare_sight:visibility': ['from', 'to', 'seen'],
  'roll_initiative:turn-order': ['combatants'],
  // The two odd ones out, and the reason this guard exists: a `route` is
  // established by re-sending the *same* call with a field filled in rather
  // than by a declaration of its own, so the field is the whole of the door.
  'move:route': ['route'],
  'activate_spell:route': ['via'],
};

describe('every kind a tool declares it establishes has fields to carry it', () => {
  const declaredPairs = (): readonly string[] =>
    TOOLS.flatMap((tool) => tool.establishes.map((kind) => `${tool.name}:${kind}`)).sort();

  it('records exactly the declarations the surface makes', () => {
    expect(Object.keys(ESTABLISHING_FIELDS).sort()).toEqual([...declaredPairs()]);
  });

  it('names fields that really exist, proved at their own path', () => {
    const shut: string[] = [];
    for (const [pair, fields] of Object.entries(ESTABLISHING_FIELDS)) {
      const tool = pair.slice(0, pair.lastIndexOf(':'));
      shut.push(...shutDoors(fields.map((field) => `${tool}.${field}`)));
    }
    expect(shut).toEqual([]);
  });
});

// — guard three: a fact the engine can be told, and a tool that tells it ————

/**
 * Every `declare*` command the engine exports, and what answers it here.
 *
 * A declaration is the engine asking to be told something it cannot work out
 * — a creature's type, where the ground is rough, that somebody is falling.
 * Each one that reaches no tool is a fact a session cannot state, and
 * `declareFalling` was exactly that: it landed in `commands/facts.ts`, no
 * tool called it, and Feather Fall — which the engine casts, with a Reaction
 * window, a slot and a minute on the clock — was uncastable from the only
 * surface that exists to cast spells.
 *
 * **A recorded exclusion is an answer and a shut door is not.** Four of these
 * are deliberately on neither surface, each for a reason the surface's own
 * rule already gives, and the reason is written here rather than left to be
 * re-derived by whoever next wonders. The test checks the exclusions too: a
 * tool that starts calling one of them fails this file until the line moves.
 */
const DECLARATIONS: Readonly<Record<string, { readonly tool: string } | { readonly withheld: string }>> = {
  declareCreatureSide: { tool: 'declare_side' },
  declareCreatureType: { tool: 'declare_creature_type' },
  declareSightBetween: { tool: 'declare_sight' },
  declareCoverBetween: { tool: 'declare_cover' },
  declareDifficultTerrain: { tool: 'declare_difficult_terrain' },
  declareFalling: { tool: 'declare_falling' },

  declareCreatureDead: {
    withheld:
      'a death that is not hit-point loss is a ruling, not a declaration of fact: it asserts an outcome the rules otherwise decide, which is the line that keeps setExhaustionLevel off this surface. A human DM may want it; a model may not have it.',
  },
  declareResourcePool: {
    withheld:
      'it takes a pool’s maximum, which is a mechanically authoritative number the caller would be producing, and it writes a stat block rather than stating a fact about the fiction.',
  },
  declareSpellcasting: {
    withheld:
      'the same: it writes an NPC’s spell list and the ability its save DC comes from, which is authorship of a stat block rather than a fact the table observed.',
  },
  declareDawn: {
    withheld:
      'the clock and what a morning refills, which is the rest slice `definitions.ts` says is left for a later batch. It also rolls recovery, so it is a command that spends dice on everybody at once.',
  },
};

/**
 * Every `declare*` the engine exports, split by what it returns.
 *
 * **The split is the whole engine's, not a directory's.** A declaration a
 * session can make is a *command*: it returns `Result<GameEvent[]>`, and a
 * caller reaches it or does not. Beneath several of them is a pure function
 * of the same name over one region of state — `declareCover` under
 * `declareCoverBetween`, `declarePool` under `declareResourcePool` — which
 * emits nothing and is not a door at all. Sweeping only `commands/` would
 * have told the two apart by where somebody filed them, and file placement is
 * a convention a future declaration can break silently; the return type is
 * what the engine actually says.
 */
function engineDeclarations(): {
  readonly commands: ReadonlyMap<string, string>;
  readonly stateLevel: ReadonlyMap<string, string>;
} {
  const commands = new Map<string, string>();
  const stateLevel = new Map<string, string>();
  let seen = 0;
  for (const { file, text } of engineSources()) {
    seen += [...text.matchAll(/^export function declare[A-Z]/gm)].length;
    for (const match of text.matchAll(
      /^export function (declare[A-Z]\w*)\([\s\S]*?\):\s*([\w<>[\] ]+?)\s*\{/gm,
    )) {
      const emitsEvents = /^Result<\s*GameEvent\[\]\s*>$/.test(match[2]!.trim());
      (emitsEvents ? commands : stateLevel).set(match[1]!, file);
    }
  }
  // A regex that stopped matching would empty the tables and pass everything
  // below in silence. Every export the coarse sweep found has to have been
  // classified by the fine one.
  expect(commands.size + stateLevel.size).toBe(seen);
  return { commands, stateLevel };
}

describe('every fact the engine can be told has a tool that tells it', () => {
  it('records exactly the declaration commands the engine exports', () => {
    expect(Object.keys(DECLARATIONS).sort()).toEqual([...engineDeclarations().commands.keys()].sort());
  });

  it('sweeps something: the engine does export declarations', () => {
    expect(engineDeclarations().commands.size).toBeGreaterThan(5);
    expect([...engineDeclarations().commands.keys()]).toContain('declareCreatureType');
  });

  /**
   * And the other half of the split is real, so the classifier is doing work
   * rather than putting everything in one bucket. These write no event and
   * are reached only through the commands above them, which is why they are
   * not doors and are not in the table.
   */
  it('finds the state-level halves too, and does not count them as doors', () => {
    const stateLevel = [...engineDeclarations().stateLevel.keys()];
    expect(stateLevel.length).toBeGreaterThan(0);
    expect(stateLevel).toContain('declareCover');
    for (const name of stateLevel) expect(Object.keys(DECLARATIONS)).not.toContain(name);
  });

  it('answers each with a tool on this surface that calls that command', () => {
    const shut: string[] = [];
    const surfaceSource = stripComments(definitionsText());
    for (const [command, answer] of Object.entries(DECLARATIONS)) {
      if (!('tool' in answer)) continue;
      if (!TOOL_NAMES.includes(answer.tool)) shut.push(`${command}: there is no ${answer.tool}`);
      // The tool has to be the one that *calls* it. A name that happens to
      // match would be a door painted on a wall.
      if (!new RegExp(`\\b${command}\\(`).test(surfaceSource)) {
        shut.push(`${command}: no tool calls it`);
      }
    }
    expect(shut).toEqual([]);
  });

  /**
   * And the exclusions are excluded, on both surfaces. The reason a withheld
   * declaration is safe to leave in a table is that the table is checked in
   * both directions: the day one of these gets a tool, this fails and the
   * reason above it has to be deleted deliberately.
   */
  it('calls none of the ones it records as withheld, from either surface', () => {
    const both = definitionsText() + dmDefinitionsText();
    const called: string[] = [];
    for (const [command, answer] of Object.entries(DECLARATIONS)) {
      if ('tool' in answer) continue;
      if (new RegExp(`\\b${command}\\(`).test(stripComments(both))) called.push(command);
      expect(answer.withheld.length).toBeGreaterThan(40);
    }
    expect(called).toEqual([]);
    // Non-vacuous: the DM's surface is real and has tools of its own.
    expect(DM_TOOL_NAMES.length).toBeGreaterThan(0);
  });
});

// — guard four: a refusal that names a fact, and the field that answers it ——

/**
 * Every refusal whose code says a fact is **missing**, and where a caller
 * puts it.
 *
 * This is the general form of three of the four gaps. `damage_type_required`
 * was unanswerable because `cast_spell` had no `damageType`;
 * `missing_ability_choice` was unanswerable because `featChoice` had no
 * `abilities`, and Zod stripped the key so silently that every attempt came
 * back as the *wrong answer* rather than a missing field; `route_required`
 * was unanswerable because `move` had no `route`. In each case the engine
 * said precisely what it wanted and the surface had nowhere to put it.
 *
 * **The scope is what can be derived honestly.** The codes below are every
 * string literal in the engine matching `missing_*` or `*_required` — the two
 * shapes the engine uses for "you have not told me something you must". A
 * refusal that names a field in its *prose* and not in its code is outside
 * this sweep, because prose cannot be read reliably; that limit is real and
 * is recorded here rather than papered over with a regex that would sometimes
 * be wrong.
 *
 * A value is either the fields that answer it — `tool.path`, probed — or a
 * written reason why nothing on this surface does.
 */
type Answer = { readonly fields: readonly string[] } | { readonly unanswerable: string };

const ANSWERS: Readonly<Record<string, Answer>> = {
  // — the two the split in `commands/command.ts` is about ——————————————————
  route_required: { fields: ['move.route', 'activate_spell.via'] },
  single_steps_required: {
    unanswerable:
      'not a field: the remedy is the same walk re-sent as several calls of one space each, each settled before the next. `routes.test.ts` drives that loop end to end.',
  },

  // — a casting states four facts, and each is refused until it does ———————
  damage_type_required: { fields: ['cast_spell.damageType'] },
  fought_fact_required: { fields: ['cast_spell.fought'] },
  destination_required: { fields: ['activate_spell.to', 'cast_spell.teleportTo'] },

  // — and three questions about what pays for it ———————————————————————————
  slot_kind_required: { fields: ['cast_spell.slotKind'] },
  payment_required: { fields: ['cast_spell.payment'] },
  class_required: { fields: ['cast_spell.source'] },

  // — creation, where the refusal names the choice at fault ————————————————
  subclass_required: { fields: ['create_character.choices.subclassId'] },
  missing_feature_choice: { fields: ['create_character.choices.featureChoices'] },
  missing_dm_grants: { fields: ['create_character.choices.dmGrants'] },
  // The four that live *inside* a feat's choice, which is the level gap three
  // was at: `feats` existed, and the answer goes one field deeper.
  missing_feat_choice: { fields: ['create_character.choices.feats.the-slot.featId'] },
  missing_ability_choice: { fields: ['create_character.choices.feats.the-slot.abilities'] },
  missing_spell_list: { fields: ['create_character.choices.feats.the-slot.spellList'] },
  missing_level_one_spell: { fields: ['create_character.choices.feats.the-slot.levelOneSpell'] },
  missing_spellcasting_ability: {
    fields: ['create_character.choices.feats.the-slot.spellcastingAbility'],
  },

  // — and two that are not a caller's to answer at all —————————————————————
  missing_field: {
    unanswerable:
      '`spell-schema.ts` reporting on a homebrew `SpellDefinition`: the field is a field of *content*, answered by fixing the definition before `createContent` is called, and never by a tool argument.',
  },
  missing_damage_type: {
    unanswerable:
      'the same validator, on a definition whose effect deals damage and names no type. Content again, and not a casting’s refusal — `damage_type_required` is that one.',
  },
};

/** Every `missing_*` / `*_required` code the engine writes, by its file. */
function statedFactCodes(): ReadonlyMap<string, string> {
  const found = new Map<string, string>();
  for (const { file, text } of engineSources()) {
    for (const match of text.matchAll(/'(missing_[a-z0-9_]+|[a-z0-9_]+_required)'/g)) {
      if (!found.has(match[1]!)) found.set(match[1]!, file);
    }
  }
  return found;
}

describe('every refusal that says a fact is missing is answerable through a field', () => {
  it('records exactly the codes of that shape the engine can return', () => {
    expect(Object.keys(ANSWERS).sort()).toEqual([...statedFactCodes().keys()].sort());
  });

  it('sweeps something: the engine does refuse in this shape', () => {
    const codes = [...statedFactCodes().keys()];
    expect(codes.length).toBeGreaterThan(10);
    expect(codes).toContain('damage_type_required');
    expect(codes).toContain('missing_ability_choice');
  });

  it('names a field that really exists for every one it says is answerable', () => {
    const shut = Object.entries(ANSWERS).flatMap(([code, answer]) =>
      'fields' in answer ? shutDoors(answer.fields).map((line) => `${code}: ${line}`) : [],
    );
    expect(shut).toEqual([]);
  });

  it('gives a reason for every one it says is not', () => {
    for (const [code, answer] of Object.entries(ANSWERS)) {
      if ('fields' in answer) continue;
      expect(answer.unanswerable.length, code).toBeGreaterThan(40);
    }
  });
});

/**
 * And the same question asked of creation's own report, which names its field
 * in a field rather than in prose.
 *
 * `planCharacter` answers with `problem(code, field, why)`, so *which choice
 * is at fault* is structured data the engine hands out — and a field it can
 * name that the surface cannot carry is a refusal a caller can read and not
 * act on. This derives the whole set and probes every one.
 */
function creationFields(): readonly string[] {
  const text = stripComments(readFileSync(join(ENGINE, 'creation.ts'), 'utf8'));
  const named = new Set<string>();
  for (const match of text.matchAll(/problem\(\s*'[a-z0-9_]+',\s*'(\w+)'/g)) named.add(match[1]!);
  return [...named].sort();
}

describe('every choice a creation refusal names can be sent through the door', () => {
  it('sweeps something: creation names its fields', () => {
    expect(creationFields().length).toBeGreaterThan(10);
    expect(creationFields()).toContain('feats');
  });

  it('is a field of `create_character`, every one', () => {
    expect(
      shutDoors(creationFields().map((field) => `create_character.choices.${field}`)),
    ).toEqual([]);
  });
});
