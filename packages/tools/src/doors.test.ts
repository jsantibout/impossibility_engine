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
 * declarations out of every `declare*` the engine exports, the codes out of
 * the `err` literals the engine actually writes. A guard over a hand-written list stops guarding the
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
  DM_ONLY_TOOL_NAMES,
  DM_TOOL_NAMES,
  createCampaign,
  createSurface,
  TOOLS,
  TOOL_NAMES,
  type ContextRequestKind,
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

/**
 * The little a call needs before a probe can reach the field it is aimed at.
 *
 * **A discriminated union is a wall the bare probe cannot get through.**
 * `nest` builds a single-key object, so a probe at `take_ready.response.
 * damageType` arrives as `{ response: { damageType: … } }` — and Zod rejects
 * that at `response.kind`, because no branch has been chosen, without ever
 * looking at the field. The probe then reports "no such field" about a field
 * that is certainly there, which is the direction of error this whole file
 * exists to prevent: a door reported shut is argued about, and a door reported
 * open when it is shut is the gap nobody finds. `take_ready`'s five fields
 * were left out of the tables below for exactly that reason.
 *
 * So a tool may record the *discriminator* a probe has to send, and nothing
 * else. It is hand-written because which branch a field lives in is a fact
 * about meaning, exactly as {@link ESTABLISHING_FIELDS} is — and it cannot
 * manufacture a false positive in either case: a key no schema has heard of is
 * stripped in silence whatever else the call carries, so a scaffold can only
 * ever let the probe **reach** a field, never invent one. The detector's own
 * tests below assert both halves.
 */
const SCAFFOLDS: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {
  // The four facts a readied casting states live in the `spell` branch, and
  // naming the branch is the whole of what this supplies.
  take_ready: { response: { kind: 'spell' } },
};

/** The scaffold under the probe, deeply, so the probe's own leaf survives. */
function merged(base: unknown, over: unknown): unknown {
  const plain = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);
  if (!plain(base) || !plain(over)) return over;
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(over)) out[key] = merged(base[key], value);
  return out;
}

/** Whether the tool's schema has this field, proved by it refusing one. */
const hasField = (tool: string, path: string): boolean =>
  PROBES.some((probe) =>
    issuePaths(tool, merged(SCAFFOLDS[tool] ?? {}, nest(path, probe))).includes(path),
  );

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
   * And it can see inside a discriminated union now, which it could not.
   *
   * The second assertion is the one that matters: it is the *old* probe,
   * written out, failing on a field that is really there. That is why
   * `take_ready`'s fields were unlisted, and it is what the scaffold buys.
   */
  it('reaches a field inside a discriminated union, given the branch', () => {
    expect(hasField('take_ready', 'response.damageType')).toBe(true);
    expect(hasField('take_ready', 'response.fought')).toBe(true);
  });

  it('because the bare probe is turned away at the discriminator', () => {
    const bare = issuePaths('take_ready', nest('response.damageType', -1));
    expect(bare).not.toContain('response.damageType');
    expect(bare).toContain('response.kind');
  });

  /** And a scaffold cannot conjure a field: an unknown key is still stripped. */
  it('and still finds nothing inside that branch that is not there', () => {
    expect(hasField('take_ready', 'response.flavour')).toBe(false);
    expect(hasField('take_ready', 'response.payment')).toBe(false);
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
  // The second door onto `creature`, and the whole of what it takes: what to
  // call the monster, and which stat block it is. Every other fact about it
  // — Armour Class, hit points, size, defences — is read out of the book by
  // the engine, which is why `monsterId` is the only field and why
  // `unknown_monster` is answerable at it.
  'add_creature:creature': ['id', 'monsterId'],
  // The third, and the same two fields plus whose it is: a summons is a stat
  // block read out of the book exactly as `add_creature` reads one, put on the
  // summoner's side by a casting. No number of the caller's, here either.
  'summon_creature:creature': ['id', 'monsterId', 'by'],
  // The fourth, and the one with no book behind it at all: a thing a feature
  // makes reads every number off that feature — the Armour Class, the hit
  // point, the size — so what the caller says is whose feature it is, what to
  // call the thing and which of the effects the feature prints it does.
  'create_device:creature': ['who', 'feature', 'device', 'name', 'function'],
  'declare_creature_type:creature-type': ['who', 'creatureType'],
  // Its twin, differing only in being re-declarable: a type is what a
  // creature is and a side is who it is fighting, and the second changes in
  // play. The same two fields carry it.
  'declare_side:side': ['who', 'side'],
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

// — guard two and a half: a tool that answers its own question ——————————————

/**
 * And the same question of `selfAnswers`, which is the other way a kind gets
 * a door: not a second call that establishes the fact, but **this call again**
 * with a field on it.
 *
 * It is the same failure mode as gap one, one turn further round. A tool that
 * declares it answers a kind on itself takes the caller's answer away from
 * whatever the surface-wide mapping would have said — so if the field it means
 * does not exist, a caller told to re-send has nothing to re-send *with*, and
 * the honest wrong answer has been replaced by a confident one. The pairing is
 * written out for the same reason as {@link ESTABLISHING_FIELDS}'s and the
 * left-hand side derived for the same reason.
 */
const SELF_ANSWERED_FIELDS: Readonly<Record<string, readonly string[]>> = {
  // SRD Alert's "one **willing** ally". The engine tags the request `route`
  // because it is the re-send kind, and the two tools that establish a route
  // for everybody else — a path through a room — are no help at all to a
  // caller being asked whether its friend agreed.
  'swap_initiative:route': ['willing'],
  // SRD Mage Armor's "a **willing** creature", which is the same question over
  // a list rather than a boolean: the engine asks rather than refusing when
  // nobody has said, and the answer is this call again with the creature
  // named.
  'cast_spell:route': ['willing'],
  // The second place's way back. SRD Blink's "an unoccupied space of your
  // choice … within 10 feet of the space you vanished from" is a `position`
  // the engine asks for and will not pick, and the three calls that bring a
  // creature back each carry the answer on themselves: the boundary that
  // returns a Blink caster, the command for a creature whose way back is
  // open, and a summoner's recall.
  'end_turn:position': ['returns'],
  'recall_familiar:position': ['to'],
  'return_from_elsewhere:position': ['to'],
};

describe('every kind a tool answers on itself has a field to carry it', () => {
  const selfAnsweredPairs = (): readonly string[] =>
    TOOLS.flatMap((tool) => tool.selfAnswers.map((kind) => `${tool.name}:${kind}`)).sort();

  it('records exactly the ones the surface declares', () => {
    expect(Object.keys(SELF_ANSWERED_FIELDS).sort()).toEqual([...selfAnsweredPairs()]);
  });

  it('names fields that really exist, proved at their own path', () => {
    const shut: string[] = [];
    for (const [pair, fields] of Object.entries(SELF_ANSWERED_FIELDS)) {
      const tool = pair.slice(0, pair.lastIndexOf(':'));
      shut.push(...shutDoors(fields.map((field) => `${tool}.${field}`)));
    }
    expect(shut).toEqual([]);
  });

  /**
   * And the narrowing stays a narrowing: a tool answering a kind on itself
   * changes nobody else's door. `doorsFor` is the surface's own answer and is
   * untouched — the substitution happens inside the one tool that declared it.
   */
  it('takes no kind away from the surface-wide mapping', () => {
    const doors = surface();
    for (const pair of Object.keys(SELF_ANSWERED_FIELDS)) {
      const kind = pair.slice(pair.lastIndexOf(':') + 1) as ContextRequestKind;
      const tool = pair.slice(0, pair.lastIndexOf(':'));
      expect(doors.doorsFor(kind).length).toBeGreaterThan(0);
      expect(doors.doorsFor(kind)).not.toContain(tool);
    }
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
 * **A recorded exclusion is an answer and a shut door is not.** Three of these
 * are deliberately on neither surface, each for a reason the surface's own
 * rule already gives, and the reason is written here rather than left to be
 * re-derived by whoever next wonders. The test checks the exclusions too: a
 * tool that starts calling one of them fails this file until the line moves.
 *
 * **And the reason has to survive being read again.** `declareDawn` was a
 * fourth exclusion until the batch that opened it, and the entry it left
 * behind is what a table checked in both directions buys: the line had to be
 * deleted deliberately, in the same commit as the door, rather than quietly
 * ceasing to be true while nobody looked. Both halves of its reason — that the
 * rest slice was a later batch's, and that it rolls — had stopped holding.
 *
 * **And which surface holds the door is part of the answer.** `dmOnly` says a
 * declaration is on the human DM's surface and not the model's, which is a
 * third state rather than a softer withholding: the fact can be stated, and
 * not by a model. `declareCreatureHeads` is the one — how many heads a Hydra
 * still has is a number, and the ruling that put it here is that a number the
 * *engine* produces is a fabrication while a number the *table* states is a
 * fact. The tests below check the door is on the surface the entry names and
 * absent from the other, so a tool that drifted across would fail here.
 */
const DECLARATIONS: Readonly<
  Record<
    string,
    { readonly tool: string; readonly dmOnly?: true } | { readonly withheld: string }
  >
> = {
  declareCreatureSide: { tool: 'declare_side' },
  declareCreatureType: { tool: 'declare_creature_type' },
  declareSightBetween: { tool: 'declare_sight' },
  declareCoverBetween: { tool: 'declare_cover' },
  declareDifficultTerrain: { tool: 'declare_difficult_terrain' },
  declareFalling: { tool: 'declare_falling' },
  // The fifth and sixth declared facts, and the pair that gave Darkvision
  // something to be a rule about. Both are the room, which is the DM's to
  // describe; both take a word out of the glossary and a radius, which is the
  // class of number `declare_difficult_terrain` already takes here.
  declareLight: { tool: 'declare_light' },
  declareObscurement: { tool: 'declare_obscurement' },
  // The first door on either surface that takes a number, and the DM's alone:
  // the count sizes an Attack action, so a model stating it would be writing
  // itself attacks, while the table stating it is reporting the creature in
  // front of it. The engine still derives the Bites, which is what makes the
  // door safe to open.
  declareCreatureHeads: { tool: 'declare_heads', dmOnly: true },
  /**
   * **The third on the DM's surface alone, and the one the book hands over by
   * name.** SRD Half-Dragon's Draconic Origin ends "(GM's choice)", and what
   * is chosen is a *word* rather than a number — which is why it looks like it
   * belongs on the wider surface and does not. The choice decides which damage
   * the party is about to take, and a model making it would be picking the
   * type after reading the party's Resistances. A table describing the dragon
   * in front of it is stating a fact; a model choosing what its own monster
   * deals is writing the encounter.
   */
  declareDamageType: { tool: 'declare_damage_type', dmOnly: true },
  /**
   * **The second door on the DM's surface alone, and the widest fact either
   * of them states: that a thing is in the room.** "There is a barred oak
   * door here" is precisely what this table is for — something the engine
   * cannot work out and has to be told — and it is on this surface for the
   * reason `award_items` is: what is in the room is the DM's to say, and a
   * model that could declare an adamantine wall between itself and the party
   * would be writing the world rather than playing in it.
   *
   * It takes one mechanical number and that is what the `dmOnly` is really
   * about: a damage threshold, which the SRD names ("often have extra
   * resilience represented by a damage threshold") and prints no table for.
   * Everything else the call carries is fiction, and the Armour Class and the
   * hit points come back out of the book.
   */
  declareObject: { tool: 'declare_object', dmOnly: true },
  /**
   * **Withheld until this batch, and the reason it gave has stopped being
   * true.** The line here read "the clock and what a morning refills, which is
   * the rest slice `definitions.ts` says is left for a later batch. It also
   * rolls recovery, so it is a command that spends dice on everybody at once."
   * The rest slice landed — `begin_rest`, `end_rest` and `advance_time` are
   * doors — and a command that rolls is what nearly every door on this surface
   * already is; the dice are the engine's in exactly the way an attack's are.
   *
   * What was left was worse than either half: a pool nothing refills is the
   * mirror of the pool a caller can spend for no effect, which is the rule
   * that kept Action Surge shut. Every SRD line that gives back "daily at
   * dawn" — and a monster's `N/Day` with it — was given back never, because
   * nothing in a session could say the sun had come up.
   *
   * It carries no number and names nobody: the whole of the call is `{}`.
   */
  declareDawn: { tool: 'declare_dawn' },

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
      'the same: it writes an NPC’s spell list and the ability its save DC comes from, which is authorship of a stat block rather than a fact the table observed. It is the one withholding a *refusal* waits on — see `UNDECLARABLE` below, where `unknown_spellcasting` is recorded as a question this surface cannot be given a door to.',
  },
};

/**
 * Every `declare*` the engine exports, split by what it returns.
 *
 * **The split is the whole engine's, not a directory's.** A declaration a
 * session can make is a *command*: it hands back the engine's own
 * `GameEvent`s, and a caller reaches it or does not. Beneath several of them
 * is a pure function of the same name over one region of state —
 * `declareCover` under `declareCoverBetween`, `declarePool` under
 * `declareResourcePool` — which returns a `PositionState` or a
 * `ResourceState`, emits nothing, and is not a door at all. Sweeping only
 * `commands/` would have told the two apart by where somebody filed them,
 * and file placement is a convention a future declaration can break in
 * silence.
 *
 * **The test is whether `GameEvent` is in the return type at all**, not
 * whether it is spelled the way today's ten spell it. `Result<readonly
 * GameEvent[]>` is a form the engine already writes elsewhere, and an exact
 * match on `Result<GameEvent[]>` would have filed the next command written
 * that way under *state-level* — leaving a door nothing guards, which is the
 * failure this widening exists to end and in the direction that hurts. So the
 * predicate is loose, and the two assertions below are what keep it honest:
 * every name the coarse sweep sees is classified, and every state-level entry
 * has to show a `Result` of something that is not a `GameEvent`.
 */
interface Declaration {
  readonly file: string;
  readonly returns: string;
}

function declarationsIn(sources: readonly { file: string; text: string }[]): {
  readonly commands: ReadonlyMap<string, Declaration>;
  readonly stateLevel: ReadonlyMap<string, Declaration>;
} {
  const commands = new Map<string, Declaration>();
  const stateLevel = new Map<string, Declaration>();
  let seen = 0;
  for (const { file, text } of sources) {
    seen += [...text.matchAll(/^export function declare[A-Z]/gm)].length;
    for (const match of text.matchAll(
      /^export function (declare[A-Z]\w*)\([\s\S]*?\):\s*([\w<>[\]|, ]+?)\s*\{/gm,
    )) {
      const returns = match[2]!.trim();
      const bucket = /\bGameEvent\b/.test(returns) ? commands : stateLevel;
      bucket.set(match[1]!, { file, returns });
    }
  }
  // A regex that stopped matching would empty both buckets and pass
  // everything below in silence. Every export the coarse sweep found has to
  // have been classified by the fine one.
  expect(commands.size + stateLevel.size).toBe(seen);
  return { commands, stateLevel };
}

const engineDeclarations = (): ReturnType<typeof declarationsIn> =>
  declarationsIn(engineSources());

describe('the classifier can tell a command from the state beneath it', () => {
  /**
   * The detector's own test, in `boundary.test.ts`'s form: a detector nobody
   * tested is a guard nobody tested. These are the shapes a declaration could
   * actually be written in, fed to the classifier rather than trusted to a
   * reading of the regex — and the misclassification that matters is a
   * *command* filed as state-level, because that is a door nothing would
   * guard.
   */
  const classify = (source: string): 'command' | 'state-level' | 'unread' => {
    const found = declarationsIn([{ file: 'fixture.ts', text: source }]);
    if (found.commands.size === 1) return 'command';
    if (found.stateLevel.size === 1) return 'state-level';
    return 'unread';
  };

  it('reads the ten spellings of a command the engine might write', () => {
    expect(classify('export function declareX(s: GameState): Result<GameEvent[]> {')).toBe(
      'command',
    );
    // The form the engine already uses elsewhere, and the one an exact match
    // on `Result<GameEvent[]>` filed under state-level.
    expect(classify('export function declareX(s: GameState): Result<readonly GameEvent[]> {')).toBe(
      'command',
    );
    expect(classify('export function declareX(s: GameState): Result<GameEvent[] | null> {')).toBe(
      'command',
    );
    // A multi-line signature with a nested object parameter and a default —
    // `declareDawn`'s actual shape.
    expect(
      classify(
        'export function declareX(\n  state: GameState,\n  supply: { readonly rng: Rng },\n  command: CommandIdentity = {},\n): Result<GameEvent[]> {',
      ),
    ).toBe('command');
  });

  it('reads a state-level half as one', () => {
    expect(classify('export function declareX(s: PositionState): Result<PositionState> {')).toBe(
      'state-level',
    );
  });

  it('and reads nothing into a file that declares nothing', () => {
    expect(classify('export function somethingElse(s: GameState): Result<GameEvent[]> {')).toBe(
      'unread',
    );
  });
});

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
   *
   * **Each has to show what it returns instead.** A signature the regex read
   * wrongly, or one it read past into somebody else's, would land a real
   * command here and be quietly excused; requiring a `Result` of something
   * that is not a `GameEvent` means such an entry has to look like a
   * state-level function to be treated as one.
   */
  it('finds the state-level halves too, and does not count them as doors', () => {
    const stateLevel = [...engineDeclarations().stateLevel.entries()];
    expect(stateLevel.length).toBeGreaterThan(0);
    expect(stateLevel.map(([name]) => name)).toContain('declareCover');
    for (const [name, declaration] of stateLevel) {
      expect(Object.keys(DECLARATIONS)).not.toContain(name);
      expect(declaration.returns, name).toMatch(/^Result<[\w ]+>$/);
      expect(declaration.returns, name).not.toContain('GameEvent');
    }
  });

  it('answers each with a tool on the surface it names, that calls that command', () => {
    const shut: string[] = [];
    const bySurface = {
      model: { names: TOOL_NAMES, source: stripComments(definitionsText()) },
      dm: { names: DM_ONLY_TOOL_NAMES, source: stripComments(dmDefinitionsText()) },
    };
    for (const [command, answer] of Object.entries(DECLARATIONS)) {
      if (!('tool' in answer)) continue;
      const { names, source } = bySurface[answer.dmOnly === true ? 'dm' : 'model'];
      if (!names.includes(answer.tool)) shut.push(`${command}: there is no ${answer.tool}`);
      // The tool has to be the one that *calls* it. A name that happens to
      // match would be a door painted on a wall.
      if (!new RegExp(`\\b${command}\\(`).test(source)) {
        shut.push(`${command}: no tool calls it`);
      }
    }
    expect(shut).toEqual([]);
  });

  /**
   * And a door the DM alone holds is on the DM's surface **and nowhere else**.
   * The claim is two-sided on purpose: a `dmOnly` entry whose tool had drifted
   * onto the model's list would read above exactly as a door correctly placed,
   * and which surface holds it is the whole of what the entry says.
   */
  it('keeps a DM-only door off the model’s surface', () => {
    const dmOnly = Object.values(DECLARATIONS).filter(
      (answer): answer is { readonly tool: string; readonly dmOnly?: true } =>
        'tool' in answer && answer.dmOnly === true,
    );
    // Non-vacuous: there is one, and it is the head count.
    expect(dmOnly.map((answer) => answer.tool)).toContain('declare_heads');
    for (const answer of dmOnly) {
      expect(DM_ONLY_TOOL_NAMES).toContain(answer.tool);
      expect(DM_TOOL_NAMES).toContain(answer.tool);
      expect(TOOL_NAMES).not.toContain(answer.tool);
      // And the model's own definitions do not so much as name it: that list
      // is what `createSurface` dispatches over, so a definition written there
      // would reach a model whatever this table said.
      expect(stripComments(definitionsText())).not.toContain(`'${answer.tool}'`);
    }
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
  // Three callers now, and the third is the one the probe could not see: a
  // casting that prints a choice of types, a feature's pool option that does —
  // SRD Divine Spark's "Necrotic or Radiant damage (your choice)" — and a
  // *readied* casting, which states the same four facts at the Ready because
  // SRD spends the slot there. `take_ready`'s fields were unlisted here for as
  // long as the probe was turned away at `response.kind`; they are listed now,
  // which is what the scaffold was for.
  damage_type_required: {
    fields: ['cast_spell.damageType', 'use_pool_option.damageType', 'take_ready.response.damageType'],
  },
  // The fifth stated fact, and the same two callers: a casting that prints a
  // choice — a condition, an ability, a skill — and a readied one, which
  // states it at the Ready because that is where SRD spends the slot.
  choice_required: { fields: ['cast_spell.choice', 'take_ready.response.choice'] },
  // The tenth, and it has **one** caller rather than two. A branch is stated
  // through `cast_spell.option`; a Ready cannot state one at all, because
  // `ReadyResponse` carries the facts a release reads back and a branch is not
  // among them — so readying SRD Command is refused at the Ready, before the
  // slot, with the same code and the list of words in the reason.
  option_required: { fields: ['cast_spell.option'] },
  // The eleventh, and one caller for the reason a branch has one: a Ready
  // cannot state a list of creature types either. SRD Magic Circle's "one or
  // more" is a list and not a value, so it is `types` beside `choice`.
  types_required: { fields: ['cast_spell.types'] },
  fought_fact_required: { fields: ['cast_spell.fought', 'take_ready.response.fought'] },
  // The second place's way back: SRD Blink's "an unoccupied space of your
  // choice … within 10 feet", the space a Rope Trick's climber drops to, the
  // corpse a swallowed creature climbs out of. Three doors, because three
  // moments bring a creature back — the boundary, a command of its own, and
  // its summoner's recall — and each carries the same placement.
  return_space_required: {
    fields: ['end_turn.returns', 'return_from_elsewhere.to', 'recall_familiar.to'],
  },
  destination_required: {
    fields: [
      'activate_spell.to',
      'cast_spell.teleportTo',
      'take_ready.response.teleportTo',
      // And the third host of an effect list, now that one of its options
      // teleports: SRD Cloud's Jaunt names a space the same way a casting does.
      'use_pool_option.teleportTo',
    ],
  },
  // The sixth stated fact, and the only one a **feature** asks as well as a
  // casting. SRD Shillelagh's "A Club or Quarterstaff you are holding", SRD
  // Magic Weapon's "You touch a nonmagical weapon" and SRD Sacred Weapon's
  // "one Melee weapon that you are holding" each name one object out of what
  // the holder is carrying, and a Paladin holding two Longswords has two
  // answers the engine will not pick between.
  weapon_required: {
    fields: ['activate_feature.weapon', 'cast_spell.weapon', 'take_ready.response.weapon'],
  },
  // The weapon's neighbour, and one caller. Two clauses ask: SRD Remove Curse
  // breaks "its owner's Attunement to the object", and SRD Heat Metal heats a
  // thing and makes its holder drop it. Either way a creature carrying three
  // things has three answers. A readied casting does not carry it —
  // `ReadyResponse` holds the four facts a readied spell states and this is not
  // one of them — so the field is `cast_spell`'s alone.
  object_required: { fields: ['cast_spell.object'] },
  // The seventh stated fact, and one caller: SRD Find Familiar's "an animal
  // form you choose" names the stat block the summons raises, and the engine
  // refuses to pick one. A readied casting does not carry it — nothing in the
  // book readies a summons — so the field is `cast_spell`'s alone.
  form_required: { fields: ['cast_spell.form'] },
  // The two a **later action** states rather than a casting, and the only
  // stated facts on this surface that belong to an activation: SRD Levitate's
  // "you can change the target's altitude by up to 20 feet in either
  // direction" and SRD Gust of Wind's "you can change the direction in which
  // the Line blasts from you". Each is required by the one activation that
  // prints it and refused by every other, and neither is a number the caller
  // produced — one is a distance on the lattice and the other is a space to
  // point at.
  altitude_required: { fields: ['activate_spell.altitude'] },
  direction_required: {
    fields: [
      'activate_spell.towards',
      'activate_spell.towardsCreature',
      'activate_spell.towardsLandmark',
    ],
  },
  // The eighth stated fact, and the only one whose answer is a list of
  // creatures: SRD Sleep's "each creature **of your choice** in a
  // 5-foot-radius Sphere". The area says who could be caught and the caster
  // says which of them are, and the field is the one target list a casting
  // already has rather than a second place to name the same creatures.
  //
  // `cast_spell`'s alone: `ReadyResponse` carries the four facts a readied
  // casting states and no target list, because a Ready names *what* it
  // answers rather than whom — which the probe says out loud rather than by
  // omission, the way `payment_required` does one row down.
  area_choice_required: { fields: ['cast_spell.targets'] },

  // — and three questions about what pays for it ———————————————————————————
  slot_kind_required: { fields: ['cast_spell.slotKind', 'take_ready.response.slotKind'] },
  // Not `take_ready`'s: `choosePayment` is reached only from `resolveSpell`,
  // so a readied casting cannot raise this one, and `ReadyResponse` has no
  // field for it — which the probe now says out loud rather than by omission.
  payment_required: { fields: ['cast_spell.payment'] },
  class_required: { fields: ['cast_spell.source', 'take_ready.response.source'] },

  // — creation, where the refusal names the choice at fault ————————————————
  subclass_required: { fields: ['create_character.choices.subclassId'] },
  missing_feature_choice: { fields: ['create_character.choices.featureChoices'] },
  // The other thing a feature may ask for, on the origin traits that grant a
  // spell to somebody with no class to cast it: SRD Fiendish Legacy's
  // "Intelligence, Wisdom, or Charisma is your spellcasting ability for the
  // spells you cast with this trait".
  // Two doors, for `missing_dm_grants`'s reason one row down: a character made
  // before their species asked this answers it on the way to their next level,
  // so the advance takes the field too.
  missing_feature_spellcasting: {
    fields: [
      'create_character.choices.featureSpellcasting',
      'advance_character.featureSpellcasting',
    ],
  },
  // Two doors, because the rules ask for it at every level above the first
  // and a character created at level 1 states it for the first time on its
  // way to level 2. `advance_character` was written without the field and
  // this row was what would have caught it: the probe is aimed at a schema,
  // and a door left off the list is a door nothing aims at.
  missing_dm_grants: {
    fields: ['create_character.choices.dmGrants', 'advance_character.dmGrants'],
  },
  // The four that live *inside* a feat's choice, which is the level gap three
  // was at: `feats` existed, and the answer goes one field deeper.
  missing_feat_choice: { fields: ['create_character.choices.feats.the-slot.featId'] },
  missing_ability_choice: { fields: ['create_character.choices.feats.the-slot.abilities'] },
  missing_spell_list: { fields: ['create_character.choices.feats.the-slot.spellList'] },
  missing_level_one_spell: { fields: ['create_character.choices.feats.the-slot.levelOneSpell'] },
  missing_spellcasting_ability: {
    fields: ['create_character.choices.feats.the-slot.spellcastingAbility'],
  },

  // — a trade the caster pays for, where only they can say with what ———————
  // The entry that said "not a field **yet**", moved up with the rest the day
  // a door opened onto `tradeResource`. SRD Font of Inspiration and Wild
  // Resurgence both write "expend a spell slot" and leave the level to the
  // caster; the engine picks between candidates nowhere, so it asks, and
  // `trade_resource` is where the answer goes.
  slot_level_required: { fields: ['trade_resource.slotLevel'] },

  // — a use that mints hit points for the holder to divide ————————————————
  // SRD Preserve Life's "divide those Hit Points among them", which is a list
  // of creatures and amounts the Cleric chooses and nothing here could choose
  // for them. It is the one field on this surface that carries numbers, and it
  // is not the rule bending: no die is thrown by this option at all, the budget
  // is five times the Cleric level read off the sheet, and every share is
  // refused rather than trusted — against the budget, against thirty feet,
  // against half each creature's maximum and against the types the option will
  // not touch. `holdings.test.ts` drives both halves.
  division_required: { fields: ['use_pool_option.among'] },
  // The one option in the book that prints two templates and gives the choice
  // to its holder — SRD Breath Weapon's "a 15-foot Cone or a 30-foot Line
  // that is 5 feet wide (choose the shape each time)". `damage_type_required`
  // one field along, and answered the same way: the engine names the shapes
  // and will not pick between them.
  shape_required: { fields: ['use_pool_option.shape'] },

  // — a creature named for a roll that the split never gave one ——————————————
  // SRD Scorching Ray's "at one target within range or at several" with the
  // lopsided middle said out loud: a count beside each creature named. A
  // target left out of the split was named for nothing, and the answer is the
  // same call with that creature's share filled in. Two doors, because a
  // readied casting chooses its creatures at the release rather than at the
  // Ready, so the split is stated there too.
  missing_roll_count: { fields: ['cast_spell.rollsAt', 'release_ready.rollsAt'] },

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

// — guard five: a request's kind is the kind of the fact it asks for ————————

/**
 * Which `ContextRequest.kind` each of the engine's declarations settles, or
 * `null` for a fact no kind names.
 *
 * **This is the guard the fifth gap needed, and it is the general form of it.**
 * `attuneItem` raised a request tagged `creature` whose `satisfyWith` said
 * `declareSpellcasting` — so `doorsFor('creature')` answered `create_character`
 * and `add_creature`, and an orchestrator following the request was told to
 * create a creature that was standing in front of it. Every other guard in
 * this file passed: the kind had doors, the doors had fields, the declaration
 * was recorded. What nothing asked was whether the kind and the command were
 * the *same fact*, and they were not.
 *
 * The left-hand side is derived exactly as {@link DECLARATIONS}'s is — every
 * `declare*` command the engine exports — so a new declaration has to say
 * which kind it settles, or say `null` and mean it.
 *
 * **`null` is not a hole to be filled in later.** Several of these are facts
 * the engine can be told and *no kind names*, and they are `null` because no
 * command stops on them: `declareCoverBetween`, `declareDifficultTerrain` and
 * `declareFalling` are declared before the command that would want them, the
 * three withheld ones are never asked for at all, and `declareDawn` — a door
 * now — is the case that shows a door and a kind are different things: no
 * command in the engine stops because nobody has said it is morning, so a kind
 * for it would be a kind nothing raises. The doctrine's rule is
 * the reason — "a kind is added the first time a command must stop on a fact
 * that already has a declaring command" — and adding one before that is how a
 * kind ends up with no door.
 */
const KIND_SETTLED_BY: Readonly<Record<string, ContextRequestKind | null>> = {
  declareCreatureSide: 'side',
  // Null, and not a hole: no command stops on a head count. The swing proceeds
  // with one attack and reports the assumption, which is the doctrine's own
  // rule for a fact a command can proceed past conservatively — so adding a
  // kind here would be adding one nothing raises.
  declareCreatureHeads: null,
  declareCreatureType: 'creature-type',
  // **`creature` and not a kind of its own**, which is the doctrine's rule
  // read the way `declareCreatureHeads` above reads it: a kind is added the
  // first time a command must stop on a fact, and what is missing here is a
  // fact *about one creature* that somebody has to supply — the same shape
  // `forcePrintedSave` already asks for when nobody has said who a Cone
  // caught. A `damage-type` kind would be a kind with one asker and one door,
  // which is a structure named after its only instance.
  declareDamageType: 'creature',
  declareSightBetween: 'visibility',
  declareCoverBetween: null,
  declareDifficultTerrain: null,
  // Null, and not a hole: no command stops because nobody has said how bright
  // it is. That *is* the "no default ambient" ruling read from this end — an
  // undeclared room answers exactly as it always did, so there is nothing for
  // a command to stop on and a kind here would be one nothing raises.
  declareLight: null,
  declareObscurement: null,
  declareFalling: null,
  declareCreatureDead: null,
  declareResourcePool: null,
  declareSpellcasting: null,
  declareDawn: null,
  // Nothing asks to be told a door exists: a command that needed one would be
  // a command that knew what it was missing, and "there might be something
  // here worth hitting" is not a fact with a shape. So it settles no kind, in
  // the reading `declareLight` above already takes.
  declareObject: null,
};

/**
 * Every request raised in these sources, as the kind it is tagged and the
 * prose.
 *
 * **A line ends at either line ending.** The capture stops at `\r` as well as
 * at `\n`, which is this file's share of the same fix every sweep that reads
 * source needs: a carriage return swept up into `satisfyWith` is a character
 * the detector below then has to match past, and a repository with one CRLF
 * file in it is a repository where that happens on that file alone. There is
 * no line *split* here to share a helper with — the "nearest kind above" is
 * found by offset rather than by line — so the fix is the character class.
 */
function requestsIn(
  sources: readonly { file: string; text: string }[],
): readonly { readonly file: string; readonly kind: string; readonly satisfyWith: string }[] {
  const found: { file: string; kind: string; satisfyWith: string }[] = [];
  for (const { file, text } of sources) {
    for (const match of text.matchAll(/satisfyWith\s*:\s*([^\r\n]*)/g)) {
      const above = [...text.slice(0, match.index).matchAll(/kind\s*:\s*'([a-z-]+)'/g)];
      const nearest = above[above.length - 1];
      expect(nearest, `a request in ${file} with no kind above it`).toBeDefined();
      found.push({ file, kind: nearest![1]!, satisfyWith: match[1]! });
    }
  }
  return found;
}

const raisedRequests = (): ReturnType<typeof requestsIn> => requestsIn(engineSources());

/**
 * Every request in these sources whose tag is not the fact it asks for.
 *
 * The detector, hoisted so that the guard below and the test *of* the guard
 * run the same code — a detector tested through a second copy of its own regex
 * is a guard nobody tested, which is the mistake this file names twice
 * already.
 */
function mistaggedIn(sources: readonly { file: string; text: string }[]): readonly string[] {
  const mistagged: string[] = [];
  for (const request of requestsIn(sources)) {
    const named = /\b(declare[A-Z]\w*)/.exec(request.satisfyWith);
    if (named === null) continue;
    const command = named[1]!;
    if (!(command in KIND_SETTLED_BY)) continue;
    const settles = KIND_SETTLED_BY[command]!;
    if (settles === request.kind) continue;
    mistagged.push(
      `${request.file}: a request tagged '${request.kind}' is answered by ${command}, which settles ${
        settles === null ? 'no kind at all' : `'${settles}'`
      }`,
    );
  }
  return mistagged;
}

describe('a request asks for the fact its kind names', () => {
  it('records exactly the declarations the engine exports, kind by kind', () => {
    expect(Object.keys(KIND_SETTLED_BY).sort()).toEqual(
      [...engineDeclarations().commands.keys()].sort(),
    );
  });

  it('names a kind the vocabulary really has, for every one it does name', () => {
    const settled = Object.values(KIND_SETTLED_BY).filter((kind) => kind !== null);
    expect(settled.length).toBeGreaterThan(0);
    for (const kind of settled) expect(CONTEXT_REQUEST_KINDS).toContain(kind);
  });

  it('sweeps something: the engine raises requests naming a declaration', () => {
    const naming = raisedRequests().filter((one) => /\bdeclare[A-Z]/.test(one.satisfyWith));
    expect(naming.length).toBeGreaterThan(0);
    expect(naming.map((one) => one.kind)).toContain('creature-type');
  });

  /**
   * The claim. A request that names a declaration is asking for *that fact*,
   * so its kind must be the kind that declaration settles — and a request that
   * names a declaration settling **no** kind is asking a question this surface
   * has no door for, which belongs in {@link UNDECLARABLE} rather than wearing
   * somebody else's tag.
   */
  it('tags a request that names a declaration with the kind that declaration settles', () => {
    expect(mistaggedIn(engineSources())).toEqual([]);
  });

  /**
   * And the detector finds the breaches it was written about, fed to the
   * detector itself rather than to a second copy of its regex.
   *
   * The first fixture is the bug, transcribed from the source it was removed
   * from: a request tagged `creature` answered by a command that settles no
   * kind. The second is the other direction — a tag that is a real kind and
   * the wrong one — because a guard that only caught `null` would pass a
   * request tagged `side` and answered by `declareCreatureType`.
   */
  it('and the detector catches a mis-tag, in both of the shapes one takes', () => {
    const caught = (text: string) => mistaggedIn([{ file: 'fixture.ts', text }]);

    expect(
      caught("kind: 'creature',\nsatisfyWith: `a declareSpellcasting command for ${id}`,"),
    ).toHaveLength(1);
    expect(
      caught("kind: 'side',\nsatisfyWith: `declareCreatureType(${id}, …)`,"),
    ).toHaveLength(1);
    // And it does not cry wolf at a request that is tagged correctly, or at
    // one whose prose names no declaration at all.
    expect(caught("kind: 'creature-type',\nsatisfyWith: `declareCreatureType(${id}, …)`,")).toEqual(
      [],
    );
    expect(caught("kind: 'position',\nsatisfyWith: `a placeCreatureInScene command`,")).toEqual([]);
  });
});

// — the gaps: a question this surface cannot be given a door to ————————————

/**
 * Every refusal that is **homework with no door**, and what it carries instead.
 *
 * The doctrine's rule ends with the case this table is: "…or for one no
 * command can declare (that is a gap in the doors, and `doors.test.ts` is
 * where it is recorded)". This is that record, widened by one word — the
 * command exists, and it is the *door* that cannot, which lands in the same
 * place for a caller.
 *
 * **A gap is recorded rather than tagged.** The temptation with
 * `unknown_spellcasting` was to give it a `spellcasting` kind, and that is the
 * move this file exists to refuse: a kind must have a door on *this* surface
 * — `boundary.test.ts` iterates the whole union against the model's tools —
 * and the only door onto this fact is `declareSpellcasting`, which writes an
 * NPC's spell list and the ability its save DC comes from. A model may not
 * author a stat block, so the kind would arrive shut on the one surface that
 * has to answer for it. Tagging it `creature` instead is what was there, and
 * it was worse than nothing: it sent an orchestrator to `create_character` for
 * a creature already in the game.
 *
 * So the refusal keeps its `needs-context` kind — the fact really is merely
 * missing, and a table running the engine directly can settle it — carries no
 * `ContextRequest` at all, which `result.ts` allows in as many words
 * ("optional even there ... the reason says so"), and says in its prose what
 * would settle it. `inventory.test.ts` drives it through a `Campaign` and
 * asserts each half.
 */
const UNDECLARABLE: Readonly<Record<string, { readonly command: string; readonly why: string }>> = {
  unknown_spellcasting: {
    command: 'declareSpellcasting',
    why: 'a monster arrives through `add_creature` with an empty spellcasting state whatever its block prints, so "does this creature cast anything" is a question nobody has put — and the only command that answers it writes a spell list and a save DC ability, which is authorship of a stat block and is withheld from both surfaces. A kind here would be a kind with no door, which `boundary.test.ts` refuses by construction.',
  },
};

describe('a question with no door is recorded as one, and carries its answer in prose', () => {
  it('names a command the engine really exports and really withholds', () => {
    const declarations = engineDeclarations().commands;
    for (const [code, gap] of Object.entries(UNDECLARABLE)) {
      expect([...declarations.keys()], code).toContain(gap.command);
      const answer = DECLARATIONS[gap.command];
      expect(answer, `${code}: ${gap.command} is a recorded declaration`).toBeDefined();
      // A gap is only a gap while the door is shut. The day one opens, this
      // entry has to be deleted deliberately rather than left to rot.
      expect('withheld' in answer!, `${code}: ${gap.command} is withheld`).toBe(true);
      expect(gap.why.length).toBeGreaterThan(40);
    }
  });

  it('is a code the engine really writes, and it settles no kind', () => {
    const raised = new Set(engineSources().flatMap(({ text }) => [
      ...text.matchAll(/'(unknown_[a-z0-9_]+)'/g),
    ].map((match) => match[1]!)));
    for (const [code, gap] of Object.entries(UNDECLARABLE)) {
      expect([...raised], code).toContain(code);
      expect(KIND_SETTLED_BY[gap.command], code).toBeNull();
    }
  });

  /**
   * And the whole of the record is honest: the engine raises no request at all
   * beside a gap's command, on either tag. This is what stops the entry above
   * from being a sentence somebody wrote while the mis-tag went on shipping.
   */
  it('and no request anywhere names a command that settles no kind', () => {
    const naming: string[] = [];
    for (const request of raisedRequests()) {
      const named = /\b(declare[A-Z]\w*)/.exec(request.satisfyWith);
      if (named === null) continue;
      if (KIND_SETTLED_BY[named[1]!] === null) naming.push(`${request.file}: ${named[1]!}`);
    }
    expect(naming).toEqual([]);
  });
});
