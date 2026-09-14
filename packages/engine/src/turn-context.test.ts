import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  asCharacterId,
  contextRequestsOf,
  err,
  isErr,
  isNeedsContext,
  expect as unwrap,
  type CharacterId,
  type Result,
} from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { remaining, spellSlotKey } from './resources.js';
import { declaredCasting } from './spellcasting.js';
import { speedOf } from './standing.js';
import {
  type Duration,
  startOfNextTurn,
  endOfCurrentTurn,
  endOfNextTurn,
  resolveDuration,
} from './duration.js';
import { turnContextFor } from './commands/command.js';
import {
  applyConditionTo,
  beginCombat,
  castSpell,
  resolveSpell,
  resolveTurn,
} from './commands.js';

/**
 * A turn-anchored moment outside combat is a **thin record**, not a rule
 * saying no.
 *
 * SRD Ray of Frost: "its Speed is reduced by 10 feet **until the start of your
 * next turn**." Outside combat there is no turn whose start that names, so
 * `resolveDuration` refuses — and it must go on refusing, because the one
 * thing this engine may never do here is quietly call the moment six seconds.
 * Where the moment falls depends on where the anchor sits in the Initiative
 * order and on whose turn the effect began: anything from the very next
 * instant to a full round away.
 *
 * What was wrong was not the refusal but **who it was addressed to**. A
 * cantrip that cannot be cast in a corridor is a hole the layer above cannot
 * repair, because a bare `no_turns` does not say what would repair it. The
 * engine holds every fact needed to say *what is missing* — there is no
 * Initiative order, or this creature is not in the one there is — and the
 * three-state discipline it already applies to a creature nobody has typed and
 * a room nobody has described applies here unchanged: **the rules say no, the
 * record is thin, or fine.**
 *
 * So the *command layer* asks and the *conversion* still refuses. The engine
 * does not start the fight, roll Initiative or invent an order; it says which
 * command would, and the caller casts again exactly as it meant to.
 */

const id = (s: string) => asCharacterId(s);
const CASTER = id('caster');
const TARGET = id('target');
const BYSTANDER = id('bystander');

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 11,
  abilities: { str: 10, dex: 10, con: 10, int: 20, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'int',
  ...over,
});

const added = (who: CharacterId, over: Partial<CharacterSheet> = {}): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(over),
  maxHp: 300,
  diesAtZero: false,
  creatureType: 'Humanoid',
});

const slots: readonly GameEvent[] = [1, 2, 3].map((level) => ({
  type: 'resource-pool-declared',
  id: CASTER,
  pool: {
    key: spellSlotKey(level),
    label: `level ${level} spell slot`,
    max: 4,
    recovers: 'long-rest',
  },
}));

/** No `combat-started`: the whole point of the fixture. */
const PLACED: readonly GameEvent[] = [
  added(CASTER),
  added(TARGET),
  added(BYSTANDER),
  ...slots,
  {
    type: 'spellcasting-declared',
    id: CASTER,
    spellcasting: declaredCasting({
      ability: 'int',
      cantrips: ['ray-of-frost'],
      prepared: ['ray-of-frost', 'color-spray', 'hypnotic-pattern', 'acid-arrow', 'shield'],
    }),
  },
  { type: 'scene-set', extent: { width: 600, depth: 600, height: 40 } },
  { type: 'landmark-added', name: 'here', at: { x: 100, y: 100, z: 0 } },
  { type: 'landmark-added', name: 'there', at: { x: 125, y: 125, z: 0 } },
  { type: 'creature-placed', id: CASTER, placement: { from: { landmark: 'here' }, feet: 0 } },
  { type: 'creature-placed', id: TARGET, placement: { from: { landmark: 'there' }, feet: 0 } },
  {
    type: 'creature-placed',
    id: BYSTANDER,
    placement: { from: { landmark: 'there' }, feet: 10, bearing: 90 },
  },
  { type: 'sight-declared', from: CASTER, to: TARGET, seen: true },
  { type: 'sight-declared', from: CASTER, to: BYSTANDER, seen: true },
];

const supply = (seed: string) => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
});

const must = <T,>(result: Result<T>): T => unwrap(result, 'turn context');

const ray = (state: GameState, dice = supply('hit')) =>
  resolveSpell(state, CASTER, { spellId: 'ray-of-frost', targets: [TARGET] }, dice);

describe('a turn-anchored rider outside combat asks for a turn order', () => {
  /**
   * The headline case. Ray of Frost is a cantrip, so its casting owns nothing
   * and the deadline is the only thing that could ever take the reduction
   * away — which is why `riderDurations` gathers it in the pre-flight, before
   * the slot, the action and the first die.
   */
  it('names beginCombat, and costs nothing at all', () => {
    const before = fold('seed', PLACED);
    const dice = supply('hit');
    const snapshot = { rng: dice.rng.snapshot(), rolls: dice.issuer.count };

    const out = ray(before, dice);

    expect(isNeedsContext(out)).toBe(true);
    const requests = contextRequestsOf(out);
    expect(requests.map((r) => r.kind)).toEqual(['turn-order']);
    expect(requests[0]?.subject).toBe(CASTER);
    // The printed clause is the rule that wanted the fact, which is what
    // `because` is for everywhere else in this vocabulary.
    expect(requests[0]?.because).toContain('until the start of your next turn');
    expect(requests[0]?.satisfyWith).toContain('beginCombat');

    // **Asserted on the state, not only on the `Result`.** A refusal that came
    // back after the slot had gone would leave a caster paying for a spell
    // that never happened, and the `Result` alone cannot tell the two apart.
    const after = fold('seed', PLACED);
    expect(after).toEqual(before);
    expect(remaining(after.creatures.caster!.resources, spellSlotKey(1))).toBe(4);
    expect(after.creatures.target!.speedModifiers).toEqual([]);
    expect(dice.rng.snapshot()).toEqual(snapshot.rng);
    expect(dice.issuer.count).toBe(snapshot.rolls);
  });

  /**
   * And the fact repairs it. This is the half that makes the request worth
   * having: the caller establishes the timeline through the command the
   * request named and sends *the same casting* again.
   */
  it('resolves once beginCombat has been called, and lifts at the moment it names', () => {
    const begun: readonly GameEvent[] = [
      ...PLACED,
      ...must(
        beginCombat(fold('seed', PLACED), [
          { id: CASTER, initiative: 20, speed: 30 },
          { id: TARGET, initiative: 10, speed: 30 },
        ]),
      ),
    ];

    const cast = must(ray(fold('seed', begun)));
    const hit: readonly GameEvent[] = [...begun, ...cast.events];
    expect(speedOf(fold('seed', hit), TARGET)).toBe(20);

    // "Until the start of your next turn": the target's own turn comes first
    // and the reduction stands through it, then the caster's turn begins.
    const oneTurn = [...hit, ...must(resolveTurn(fold('seed', hit), supply('turn'))).events];
    expect(speedOf(fold('seed', oneTurn), TARGET)).toBe(20);

    const round = [...oneTurn, ...must(resolveTurn(fold('seed', oneTurn), supply('turn'))).events];
    expect(fold('seed', round).creatures[TARGET]?.speedModifiers).toEqual([]);
    expect(speedOf(fold('seed', round), TARGET)).toBe(30);
  });

  /**
   * SRD Color Spray blinds "until the end of your next turn" — the other
   * anchored member, on a levelled spell whose slot the pre-flight must not
   * have spent.
   */
  it('asks for the same fact for "the end of your next turn"', () => {
    const dice = supply('spray');
    const out = resolveSpell(
      fold('seed', PLACED),
      CASTER,
      { spellId: 'color-spray', targets: [], towards: { x: 300, y: 300, z: 0 }, slotLevel: 1 },
      dice,
    );

    expect(isNeedsContext(out)).toBe(true);
    expect(contextRequestsOf(out)[0]?.because).toContain('until the end of your next turn');
    expect(remaining(fold('seed', PLACED).creatures.caster!.resources, spellSlotKey(1))).toBe(4);
  });

  /**
   * The second, distinct thin record: the fight exists and the anchor is not
   * in it. Nothing about beginning combat would repair that, so the request
   * names the command that gives this creature a number instead.
   */
  it('asks for the anchor’s Initiative where the fight exists without them', () => {
    const elsewhere: readonly GameEvent[] = [
      ...PLACED,
      ...must(
        beginCombat(fold('seed', PLACED), [
          { id: TARGET, initiative: 10, speed: 30 },
          { id: BYSTANDER, initiative: 5, speed: 30 },
        ]),
      ),
    ];

    const out = ray(fold('seed', elsewhere));

    expect(isNeedsContext(out)).toBe(true);
    const requests = contextRequestsOf(out);
    expect(requests.map((r) => r.kind)).toEqual(['turn-order']);
    expect(requests[0]?.subject).toBe(CASTER);
    expect(requests[0]?.satisfyWith).toContain('rollInitiativeFor');
    // And it is *not* the first request wearing the same clothes: beginning a
    // fight that is already running is not what this caller has to do.
    expect(requests[0]?.need).not.toEqual(contextRequestsOf(ray(fold('seed', PLACED)))[0]?.need);
  });

  /**
   * A condition applied straight by a DM is the same fact through a different
   * door, and `schedule` is the single door — so it asks rather than refusing
   * without `applyConditionTo` knowing anything about turns.
   *
   * **The anchor and the holder are deliberately different creatures here**,
   * which is the whole of what this case is for. SRD Color Spray blinds its
   * targets "until the end of **your** next turn", so the condition sits on
   * one creature and the moment it ends at belongs to another — and it is that
   * other creature whose Initiative the caller has to go and roll. Every
   * fixture in which the two coincide passes under *either* reading, which is
   * the multiclass fixture and the Rogue who resisted nothing, met again.
   */
  it('asks about the anchor, not about whoever the condition sits on', () => {
    const out = applyConditionTo(
      fold('seed', PLACED),
      TARGET,
      'blinded',
      'a thrown cloak',
      [],
      endOfNextTurn(CASTER),
    );

    expect(isNeedsContext(out)).toBe(true);
    const requests = contextRequestsOf(out);
    expect(requests.map((r) => r.kind)).toEqual(['turn-order']);
    // The anchor is the creature the *moment* is about, which the duration
    // names — not whoever the condition is being hung on.
    expect(requests[0]?.subject).toBe(CASTER);
    expect(requests[0]?.subject).not.toBe(TARGET);
    expect(fold('seed', PLACED).creatures[TARGET]?.conditions.instances).toEqual([]);
  });

  /**
   * The member IE-043 added, and the one that names no anchor at all: SRD
   * "until the end of the current turn" is a moment in the order rather than a
   * fact about a creature. It is covered by the same conversion, and its
   * subject falls back to whoever the effect is being hung on, because there
   * is no anchor for it to be about.
   *
   * It is the other half of the branch the case above pins: that one has an
   * anchor and it is **not** the holder, this one has none and the holder is
   * all there is, so between them neither reading survives.
   */
  it('covers "the end of the current turn", which names no anchor', () => {
    const out = applyConditionTo(
      fold('seed', PLACED),
      TARGET,
      'poisoned',
      'a bad oyster',
      [],
      endOfCurrentTurn,
    );

    expect(isNeedsContext(out)).toBe(true);
    const requests = contextRequestsOf(out);
    expect(requests.map((r) => r.kind)).toEqual(['turn-order']);
    expect(requests[0]?.subject).toBe(TARGET);
    expect(requests[0]?.because).toContain('until the end of the current turn');
  });

  /**
   * The low-level half beneath `resolveSpell` reaches the same conversion, so
   * a caller reconstructing a log is told the same thing.
   */
  it('asks from the casting’s own Duration, not only from a rider', () => {
    const out = castSpell(fold('seed', PLACED), CASTER, {
      spell: 'Shield',
      level: 1,
      slotLevel: 1,
      duration: startOfNextTurn(CASTER),
    });

    expect(isNeedsContext(out)).toBe(true);
    expect(contextRequestsOf(out).map((r) => r.kind)).toEqual(['turn-order']);
    expect(remaining(fold('seed', PLACED).creatures.caster!.resources, spellSlotKey(1))).toBe(4);
  });

  /**
   * **The conversion is unchanged, and that is the point.** `resolveDuration`
   * is a pure helper and goes on handing back a bare refusal; the command that
   * knows which rule wanted the fact is what attaches the request. That is the
   * rule this engine already states for every other request kind — the pure
   * helpers beneath a command return the bare kind.
   */
  it('leaves the pure conversion refusing', () => {
    const bare = resolveDuration({ elapsed: 0, combat: null }, startOfNextTurn(CASTER));
    expect(isErr(bare)).toBe(true);
    expect(isNeedsContext(bare)).toBe(false);
    if (isErr(bare)) expect(bare.requests).toBeUndefined();
  });

  /**
   * And a duration that is simply wrong stays a refusal. Nothing a caller can
   * declare makes minus six seconds a span, so offering to go and find a fact
   * would be an orchestrator loop rather than a repair.
   */
  it('leaves a malformed span a refusal', () => {
    const out = applyConditionTo(fold('seed', PLACED), TARGET, 'poisoned', 'a bad oyster', [], {
      kind: 'seconds',
      seconds: -6,
    });

    expect(isErr(out)).toBe(true);
    expect(isNeedsContext(out)).toBe(false);
    if (isErr(out)) expect(out.code).toBe('bad_duration');
  });
});

/**
 * **Every** command-layer site that resolves a duration asks rather than
 * refusing, and it is derived rather than listed.
 *
 * The value of this rule is that no site is left refusing, and a site left
 * refusing is invisible until a caller meets it — there is no symptom, no
 * failing test and no wrong number, just an orchestrator that gives up on a
 * legal cantrip. A one-time reading of the source cannot say that about the
 * *next* site, so this reads the source instead: every `resolveDuration` in
 * the command layer is converted, or carries a written reason it is not.
 *
 * Two things the exemptions are held to, which is the shape every exemption
 * list in this repository takes. Each must name a site that still exists, so a
 * converted one fails as a stale licence; and each must name the **fact** that
 * ends it rather than an opinion, so the two whose duration is a span are
 * checked against the argument the source passes and the one that reports
 * instead of refusing is checked against what it actually does.
 */
describe('no command-layer duration site is left refusing', () => {
  const SRC = fileURLToPath(new URL('.', import.meta.url));
  const MODULES = [
    ...readdirSync(`${SRC}commands`)
      .filter((file) => file.endsWith('.ts'))
      .map((file) => `commands/${file}`),
    'rest.ts',
  ];
  const SOURCE: Readonly<Record<string, string>> = Object.fromEntries(
    MODULES.map((file) => [file, readFileSync(`${SRC}${file}`, 'utf8')]),
  );

  /**
   * Each `resolveDuration(` call, with the line it is on and the lines that
   * follow it.
   *
   * The window is what says whether the refusal was converted, and six lines
   * is the whole of a call and its guard in this repository's formatting — a
   * conversion further away than that is one a reader would not see either.
   */
  const callsIn = (
    sources: Readonly<Record<string, string>>,
  ): readonly { readonly file: string; readonly at: string; readonly follows: string }[] => {
    const found: { file: string; at: string; follows: string }[] = [];
    for (const [file, source] of Object.entries(sources)) {
      const lines = source.split('\n');
      lines.forEach((line, index) => {
        // A call, never a mention: `{@link resolveDuration}` and the prose
        // around it name the function far more often than the code calls it,
        // and a sweep that counted a docstring would report that everything is
        // converted and check nothing.
        if (!/(?:^|[^.\w])resolveDuration\(/.test(line) || line.trimStart().startsWith('*')) return;
        found.push({ file, at: line.trim(), follows: lines.slice(index, index + 6).join('\n') });
      });
    }
    return found;
  };

  const unconverted = (sources: Readonly<Record<string, string>>): readonly string[] =>
    callsIn(sources)
      .filter((call) => !call.follows.includes('turnContextFor'))
      .map((call) => `${call.file}: ${call.at}`)
      .sort();

  /**
   * The two whose duration is a **span** and the one that reports rather than
   * refusing. Each says the fact that ends it, and each fact is checked below.
   */
  const EXEMPT: Readonly<Record<string, string>> = {
    'commands/casting.ts: const done = resolveDuration(timeView(state), forSeconds(command.castingSeconds!));':
      'a casting time is a span of seconds and never a moment in the turn order, so no turn-anchored refusal can arrive; the argument itself says so, which is what the assertion below reads',
    'commands/casting.ts: const pinned = resolveDuration(timeView(state), duration);':
      '`mustResolve`, which throws rather than returning: the span was resolved and read back off an `elapsed` deadline at the declaration, so a refusal here is programmer error rather than a thin record',
    'commands/spell-resolution.ts: const deadline = resolveDuration(timeView(state), endOfNextTurn(target));':
      'the delayed hit is not scheduled and is reported in `unverified` rather than refused — SRD Acid Arrow lands its first damage either way, so the casting succeeds and there is nothing for a caller to repair; converting it would change what that spell does, which is out of IE-046 by the owner',
  };

  /**
   * Not vacuous. An extractor that matched nothing would report no problems
   * and check nothing — what `animals.md` taught every parser here.
   */
  it('reads every resolveDuration call in the command layer', () => {
    const calls = callsIn(SOURCE);
    expect(calls.length).toBeGreaterThanOrEqual(6);
    expect(calls.map((call) => call.file)).toContain('commands/conditions.ts');
    expect(calls.map((call) => call.file)).toContain('commands/spell-resolution.ts');
    // And it is a call it reads, not a mention. The command layer's own prose
    // names this function repeatedly, which must not be counted.
    expect(callsIn({ 'm.ts': ' * {@link resolveDuration} is the one conversion.' })).toEqual([]);
  });

  it('catches a site that hands back the bare refusal', () => {
    const sources = {
      'm.ts': 'const pinned = resolveDuration(view, lasts);\nif (!pinned.ok) return pinned;',
    };
    expect(unconverted(sources)).toEqual(['m.ts: const pinned = resolveDuration(view, lasts);']);
  });

  it('passes a site that converts', () => {
    const sources = {
      'm.ts':
        'const pinned = resolveDuration(view, lasts);\nif (!pinned.ok) return turnContextFor(pinned, lasts, who);',
    };
    expect(unconverted(sources)).toEqual([]);
  });

  it('leaves no site refusing that is not written down', () => {
    expect(unconverted(SOURCE)).toEqual(Object.keys(EXEMPT).sort());
  });

  /**
   * And the other direction, so an exemption cannot outlive the site it
   * excuses: a converted site would leave its licence naming nothing.
   */
  it('keeps no stale exemption, and none that says nothing', () => {
    for (const [site, reason] of Object.entries(EXEMPT)) {
      expect(unconverted(SOURCE)).toContain(site);
      expect(reason.length).toBeGreaterThan(40);
    }
  });

  /**
   * The first two exemptions claim their argument is a span, and that is read
   * off the source rather than believed. A turn-anchored duration appearing in
   * either argument fails here rather than in a fight.
   */
  it('checks the span claim against the argument the source passes', () => {
    const spans = Object.keys(EXEMPT).filter((site) => site.startsWith('commands/casting.ts'));
    expect(spans).toHaveLength(2);
    for (const site of spans) {
      expect(site).not.toMatch(/startOfNextTurn|endOfNextTurn|endOfCurrentTurn|durationUntil/);
    }
    // `forSeconds` on one; the other is `mustResolve`'s parameter, whose only
    // caller passes `forSeconds(pending.lastsSeconds)`.
    expect(SOURCE['commands/casting.ts']).toContain('mustResolve(state, forSeconds(');
  });

  /**
   * And the third's claim is behaviour, so it is driven. SRD Acid Arrow: "the
   * target takes 4d4 Acid damage and 2d4 Acid damage **at the end of its next
   * turn**." Outside combat the first half still lands.
   */
  it('checks that the delayed hit reports rather than refusing', () => {
    const out = resolveSpell(
      fold('seed', PLACED),
      CASTER,
      { spellId: 'acid-arrow', targets: [TARGET], slotLevel: 2 },
      supply('arrow'),
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.value.unverified.join(' ')).toMatch(/there are no turns outside combat/);
    expect(out.value.events.some((e) => e.type === 'damage-scheduled')).toBe(false);
    // The first hit happened, which is why there is nothing to ask for.
    expect(out.value.events.some((e) => e.type === 'damage-taken')).toBe(true);
  });
});

/**
 * Every turn-anchored `Duration` member reaches the conversion, and it is
 * derived from `resolveDuration` rather than listed.
 *
 * `turnContextFor` reads the printed clause off the duration's own kind, so a
 * member the clause table does not know falls straight through to the bare
 * refusal — **a site left refusing with no symptom, which is exactly the
 * failure the call-site sweep above exists to end, arriving one level down.**
 * That is a live pattern rather than a hypothetical: IE-043 added the fifth
 * `Duration` member in this very tranche, and a sixth would be written by
 * somebody who has never read this file.
 *
 * So the population is the kinds `resolveDuration` can refuse with `no_turns`,
 * read out of its own `switch`, and every one of them is driven through the
 * conversion. A member added to the union and answered with `no_turns` and not
 * written into the table fails here rather than in a corridor.
 */
describe('every turn-anchored duration member reaches the conversion', () => {
  const SRC = fileURLToPath(new URL('.', import.meta.url));
  const DURATION_SOURCE = readFileSync(`${SRC}duration.ts`, 'utf8');

  /**
   * The kinds `resolveDuration` answers `no_turns` for.
   *
   * **Fall-through is the whole difficulty**, and it is live: `start-of-next-turn`
   * and `end-of-next-turn` share one block, so a label with nothing under it
   * takes the answer of the next label that has something. Reading each label
   * in isolation would report one turn-anchored member where there are two.
   */
  const refusedForNoTurns = (source: string): readonly string[] => {
    const body = source.slice(source.indexOf('export function resolveDuration'));
    const parts = body.split(/^\s*case '([^']+)':/m);
    // `split` with one capture group gives [before, kind, segment, kind, …].
    const labelled: { kind: string; segment: string }[] = [];
    for (let i = 1; i < parts.length; i += 2) {
      labelled.push({ kind: parts[i]!, segment: parts[i + 1] ?? '' });
    }
    // Walk backwards so an empty segment inherits the block it falls into.
    const anchored: string[] = [];
    let inherited = '';
    for (let i = labelled.length - 1; i >= 0; i -= 1) {
      const { kind, segment } = labelled[i]!;
      const effective = segment.trim() === '' ? inherited : segment;
      inherited = effective;
      if (effective.includes('no_turns')) anchored.unshift(kind);
    }
    return anchored;
  };

  /**
   * Not vacuous, and the fall-through case is what says so: a reader that
   * stopped at the first label would report two members rather than three.
   */
  it('reads the members out of the conversion', () => {
    expect(refusedForNoTurns(DURATION_SOURCE)).toEqual([
      'start-of-next-turn',
      'end-of-next-turn',
      'end-of-current-turn',
    ]);
  });

  /** And it sees a member somebody adds, which is the case it exists for. */
  it('sees a sixth member added to the conversion', () => {
    const invented = DURATION_SOURCE.replace(
      "    case 'end-of-current-turn': {",
      [
        "    case 'until-the-moon-rises': {",
        "      if (view.combat === null) {",
        "        return err('no_turns', 'there are no turns outside combat');",
        '      }',
        '    }',
        '',
        "    case 'end-of-current-turn': {",
      ].join('\n'),
    );
    expect(refusedForNoTurns(invented)).toContain('until-the-moon-rises');
  });

  /**
   * The behavioural half. A kind the clause table does not know converts
   * nothing, so this is what a member added and not written in would look
   * like — asserted directly, so the loop below is a guard rather than a
   * hopeful sweep.
   */
  it('hands back the bare refusal for a kind the clause table does not know', () => {
    const unknown = { kind: 'until-the-moon-rises' } as unknown as Duration;
    const out = turnContextFor(err('no_turns', 'there are no turns'), unknown, CASTER);
    expect(isNeedsContext(out)).toBe(false);
  });

  it('converts every member the conversion can refuse', () => {
    for (const kind of refusedForNoTurns(DURATION_SOURCE)) {
      // Only `kind` and the presence of an anchor are read, so the bare shape
      // is the whole of what the conversion needs and a fixture per member
      // would be five spellings of one question.
      const duration = { kind, of: CASTER } as unknown as Duration;
      for (const code of ['no_turns', 'not_in_combat']) {
        const out = turnContextFor(err(code, 'no turns here'), duration, CASTER);
        expect(isNeedsContext(out)).toBe(true);
        expect(contextRequestsOf(out).map((r) => r.kind)).toEqual(['turn-order']);
        // And it says which clause wanted it, rather than an empty string the
        // table would hand back for a member somebody half-added.
        expect(contextRequestsOf(out)[0]?.because.length).toBeGreaterThan(20);
      }
    }
  });
});
