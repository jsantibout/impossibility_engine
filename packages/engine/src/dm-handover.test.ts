import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { asCharacterId, isErr, expect as unwrap, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { checkSpellDefinition } from './spell-schema.js';
import {
  DM_DECIDES,
  dmDecisionsIn,
  handedOver,
  ranged,
  type SpellDefinition,
} from './spell-definitions.js';
import { loadContent, type Content } from './content.js';
import { alteredCasting } from './commands/casting-options.js';
import type { CastingOption } from './standing.js';
import {
  advanceTime,
  eligibleTargets,
  resolveAttack,
  resolveAttackDamage,
  resolveDeclaredCast,
  resolveSpell,
  takeReady,
} from './commands.js';
import { createRng, type Rng } from './dice.js';
import { fold, type GameEvent } from './events.js';
import { declaredCasting } from './spellcasting.js';
import { remaining, spellSlotKey } from './resources.js';
import { createRollIssuer } from './rolls.js';

/**
 * Text only the DM can decide, handed over rather than adjudicated.
 *
 * The owner's ruling, verbatim: "**Some text is the DM's alone.** Commune,
 * Dream's Range `Special`, Mirage Arcane's `Sight`: the casting hands the
 * printed text to whoever is running the table, human or model, marked
 * explicitly as a thing only the DM can decide. Not a format arm to invent, a
 * handover to make visible."
 *
 * So this is one vocabulary with two halves, and neither is a rule the engine
 * executes. `dmDecides` is the printed text itself, carried out of the casting
 * word for word under a mark nothing else writes; `range: { kind: 'dm' }` is
 * the one place the format *had* to say something — a Range is a required
 * field — and it says the book printed something only the DM can answer,
 * rather than inventing a distance the book declined to print.
 *
 * Everything the casting really owns still happens around it: the slot, the
 * action, the Concentration, the clock and the ongoing record.
 */

const id = (s: string): CharacterId => asCharacterId(s);
const CASTER = id('caster');
const TARGET = id('target');

const sheet = (): CharacterSheet => ({
  level: 9,
  abilities: { str: 10, dex: 10, con: 10, int: 18, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'int',
});

const added = (who: CharacterId): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(),
  maxHp: 100,
  diesAtZero: false,
  creatureType: 'Humanoid',
});

/**
 * A homebrew spell whose Range the book declines to print and whose whole
 * effect is a question for the table — written as the JSON a DM's file holds.
 *
 * It concentrates and it costs a slot, because the claim under test is that a
 * handover does **not** short-circuit the parts the engine owns.
 */
const FAR_WHISPER = JSON.stringify({
  id: 'far-whisper',
  name: 'Far Whisper',
  level: 3,
  school: 'divination',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'dm' },
  targets: { count: 1 },
  durationSeconds: 600,
  effects: [],
  dmDecides: [
    'Range: Special',
    'The listener hears whatever the winds have carried to them, and the GM decides what that is.',
  ],
});

/** The same spell as a rite of a minute, so the declaration reaches the log. */
const LONG_WHISPER = JSON.stringify({
  ...(JSON.parse(FAR_WHISPER) as object),
  id: 'long-whisper',
  name: 'Long Whisper',
  castingTime: 'long',
  castingSeconds: 60,
});

/**
 * And the same spell with a Range the book *did* print, so the claim below is
 * about the handover rather than about a scene nobody measured.
 */
const NEAR_WHISPER = JSON.stringify({
  ...(JSON.parse(FAR_WHISPER) as object),
  id: 'near-whisper',
  name: 'Near Whisper',
  range: { kind: 'ranged', feet: 60 },
  dmDecides: ['The listener hears whatever the winds have carried, and the GM decides what.'],
});

/** Far enough that any range the book prints would refuse it. */
const A_LONG_WAY = 500;

const table = (content: Content): readonly GameEvent[] => [
  added(CASTER),
  added(TARGET),
  {
    type: 'resource-pool-declared',
    id: CASTER,
    pool: { key: spellSlotKey(3), label: 'level 3 spell slot', max: 4, recovers: 'long-rest' },
  },
  { type: 'scene-set', extent: { width: 2000, depth: 2000, height: 40 } },
  { type: 'landmark-added', name: 'here', at: { x: 100, y: 100, z: 0 } },
  { type: 'creature-placed', id: CASTER, placement: { from: { landmark: 'here' }, feet: 0 } },
  {
    type: 'creature-placed',
    id: TARGET,
    placement: { from: { creature: CASTER }, feet: A_LONG_WAY, bearing: 0 },
  },
  {
    type: 'spellcasting-declared',
    id: CASTER,
    spellcasting: declaredCasting({
      ability: 'int',
      cantrips: [],
      prepared: content.spells.map((spell) => spell.id),
    }),
  },
];

const supply = (content: Content) => ({
  issuer: createRollIssuer('r'),
  rng: createRng('whisper') as Rng,
  content,
});

const homebrew = unwrap(
  loadContent({
    spells: [JSON.parse(FAR_WHISPER), JSON.parse(LONG_WHISPER), JSON.parse(NEAR_WHISPER)],
  }),
  'load',
);

describe('a definition declares what only the DM can decide', () => {
  it('marks every handed-over sentence with something nothing else writes', () => {
    const line = handedOver('Far Whisper', 'Range: Special');
    expect(line).toContain(DM_DECIDES);
    expect(line).toContain('Far Whisper');
    expect(line).toContain('Range: Special');
  });

  it('reads the handovers back out of the lines the table was handed', () => {
    const lines = [
      'Far Whisper: the wind is not modelled',
      handedOver('Far Whisper', 'Range: Special'),
    ];
    expect(dmDecisionsIn(lines)).toEqual(['Range: Special']);
  });

  /**
   * Null, and the same null `self` answers: **no distance is stated**, which
   * is what a casting reads before it looks at a target. Asserted beside the
   * three that do answer, because "not a number" is the claim rather than the
   * particular absence.
   */
  it('measures no distance for a Range the book left to the DM', () => {
    expect(ranged({ kind: 'dm' })).toBeNull();
    expect(ranged({ kind: 'self' })).toBeNull();
    expect(ranged({ kind: 'touch' })).toBe(5);
    expect(ranged({ kind: 'ranged', feet: 60 })).toBe(60);
  });

  /**
   * The handover is never silent. A Range the format cannot state is exactly
   * the text the ruling is about, so a definition claiming one must print it.
   */
  it('refuses a DM Range that hands nothing over', () => {
    const naked = JSON.parse(FAR_WHISPER) as Record<string, unknown>;
    delete naked['dmDecides'];
    expect(checkSpellDefinition(naked as unknown as SpellDefinition).map((p) => p.code)).toContain(
      'silent_dm_range',
    );
  });

  /**
   * The mark means one thing, so only one thing may write it.
   *
   * `unverified` is a single list of strings carrying two different claims,
   * and {@link DM_DECIDES} is the whole of what tells them apart — so a note
   * that forged it would read as a handover to every reader of that list, and
   * a handed-over sentence carrying its own copy would reach the table with
   * the mark still in the text `dmDecisionsIn` gave back.
   */
  it('refuses a definition that forges the mark in either list', () => {
    const asGap = {
      ...(JSON.parse(FAR_WHISPER) as object),
      unmodelled: [`the wind ${DM_DECIDES} is not modelled`],
    };
    expect(checkSpellDefinition(asGap as unknown as SpellDefinition).map((p) => p.code)).toContain(
      'forged_dm_mark',
    );
    const twice = {
      ...(JSON.parse(FAR_WHISPER) as object),
      dmDecides: [`${DM_DECIDES} Range: Special`],
    };
    expect(checkSpellDefinition(twice as unknown as SpellDefinition).map((p) => p.code)).toContain(
      'forged_dm_mark',
    );
  });

  /**
   * And the mark is **spelled out once in the whole engine**.
   *
   * A guard over the source, because the claim is about the package rather
   * than about any one call. `spell-definitions.ts` declares the constant and
   * composes it; everything else that needs it — the validator that refuses a
   * forgery, the resolver that writes the line — names the constant. A second
   * literal would be a second thing to change, and the file that forgot would
   * go on writing a mark the reader no longer looks for.
   */
  it('spells the mark out in exactly one engine file', () => {
    const root = fileURLToPath(new URL('.', import.meta.url));
    const named = readdirSync(root, { recursive: true, encoding: 'utf8' })
      .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
      .filter((name) => readFileSync(join(root, name), 'utf8').includes(DM_DECIDES));
    expect([...named].sort().map((name) => name.replaceAll('\\', '/'))).toEqual([
      'spell-definitions.ts',
    ]);
  });

  /**
   * **And an option that doubles a range has nothing here to double.**
   *
   * SRD Distant Spell doubles the distance a casting reaches, and a Range the
   * DM decides is not a distance — so the option is refused rather than
   * charged for nothing, which is the arm a Range of Self already takes.
   * Refusing matters more than it looks: the alternative is a casting that
   * pays a Sorcery Point and reaches exactly as far as it did, and the one
   * after that is an engine that made a number up to double.
   *
   * Driven pure over a definition, because nothing in the catalogue can reach
   * it — Metamagic is the Sorcerer's and neither SRD spell with this Range is
   * on the Sorcerer list — which is the move `castingOf`'s docstring already
   * makes for a branch no content can get to.
   */
  it('refuses an option that would double a Range the DM decides', () => {
    const distant: CastingOption = {
      feature: 'metamagic',
      featureName: 'Metamagic',
      option: 'distant-spell',
      name: 'Distant Spell',
      pool: 'sorcery-points',
      cost: 1,
      perCasting: 1,
      alters: { kind: 'range', multiplier: 2 },
    };
    const definition = homebrew.spell('far-whisper')!;
    const refused = alteredCasting(
      definition,
      { castLevel: 3, castingTime: 'action' },
      [distant],
    );
    expect(isErr(refused) && refused.code).toBe('option_does_not_reach');

    // And the same option on the same spell with a Range in feet is allowed,
    // so the refusal is the Range rather than the fixture.
    const allowed = alteredCasting(
      homebrew.spell('near-whisper')!,
      { castLevel: 3, castingTime: 'action' },
      [distant],
    );
    expect(unwrap(allowed, 'distant on a printed range').reachFeet).toBe(120);
  });

  it('refuses a handover that is not a list of printed sentences', () => {
    const wrong = { ...(JSON.parse(FAR_WHISPER) as object), dmDecides: 'Range: Special' };
    const problems = checkSpellDefinition(wrong as unknown as SpellDefinition);
    expect(problems.map((p) => p.code)).toContain('malformed_field');
    expect(problems.map((p) => p.field)).toContain('dmDecides');
    const blank = { ...(JSON.parse(FAR_WHISPER) as object), dmDecides: ['   '] };
    expect(checkSpellDefinition(blank as unknown as SpellDefinition).map((p) => p.code)).toContain(
      'empty_note',
    );
  });

  /**
   * A tracked definition may say what it leaves to the table either way. What
   * it may not do is resolve to a casting and silence.
   */
  it('counts a handover as saying what the DM adjudicates', () => {
    const codes = checkSpellDefinition(JSON.parse(FAR_WHISPER) as SpellDefinition).map(
      (p) => p.code,
    );
    expect(codes).not.toContain('silent_gap');
  });
});

describe('a casting hands the text over and adjudicates the rest', () => {
  it('spends the slot, holds the Concentration, and hands the text over verbatim', () => {
    const log = table(homebrew);
    const cast = unwrap(
      resolveSpell(
        fold('seed', log),
        CASTER,
        { spellId: 'far-whisper', targets: [TARGET], slotLevel: 3 },
        supply(homebrew),
      ),
      'far whisper',
    );

    // The handover, word for word and under the mark.
    expect(dmDecisionsIn(cast.unverified)).toEqual([
      'Range: Special',
      'The listener hears whatever the winds have carried to them, and the GM decides what that is.',
    ]);

    // And nothing the engine owns was short-circuited by it.
    const after = fold('seed', [...log, ...cast.events]);
    expect(remaining(after.creatures[CASTER]!.resources, spellSlotKey(3))).toBe(3);
    expect(after.creatures[CASTER]!.concentration?.castingId).toBe(cast.castingId);
    expect(Object.keys(after.ongoing)).toEqual([cast.castingId!]);
    expect(cast.outcomes).toEqual([]);
  });

  /**
   * A Range the DM decides is a Range the engine measures nothing against.
   *
   * The target is five hundred feet away, which the same spell with a printed
   * Range refuses in as many words — so the pass below is the handover and not
   * a scene nobody measured.
   */
  it('checks no distance against a Range the book left to the DM', () => {
    const state = fold('seed', table(homebrew));
    const far = resolveSpell(
      state,
      CASTER,
      { spellId: 'far-whisper', targets: [TARGET], slotLevel: 3 },
      supply(homebrew),
    );
    expect(isErr(far)).toBe(false);

    const near = resolveSpell(
      state,
      CASTER,
      { spellId: 'near-whisper', targets: [TARGET], slotLevel: 3 },
      supply(homebrew),
    );
    expect(isErr(near)).toBe(true);
    if (isErr(near)) expect(near.code).toBe('out_of_range');
  });

  /**
   * **And the shortlist a model is shown says the same thing.**
   *
   * `eligibleTargets` bounds its list by the spell's Range, and its fallback
   * for a Range that is not a number in feet was **five** — so a Range the
   * engine has just declared is the DM's would have been narrowed to a
   * distance the engine invented, and the shortlist would have excluded a
   * target `resolveSpell` goes on to accept. The two have to answer one
   * question the same way; this is that, driven from both ends.
   */
  it('offers the shortlist a target no printed Range would reach', () => {
    const state = fold('seed', table(homebrew));
    const far = eligibleTargets(state, homebrew, CASTER, 'far-whisper', 3);
    expect(far.eligible).toContain(TARGET);
    expect(far.excluded).toEqual([]);

    // The same table, the same five hundred feet, and a Range in feet: the
    // exclusion is the Range rather than the fixture.
    const near = eligibleTargets(state, homebrew, CASTER, 'near-whisper', 3);
    expect(near.eligible).not.toContain(TARGET);
    expect(near.excluded.map((out) => out.target)).toContain(TARGET);
  });

  /**
   * And the text is in the **log**, so replaying it never reopens the book.
   *
   * A rite of a minute is declared and settled, and the declaration is where a
   * casting writes down what it read from the catalogue. The folds below are
   * handed no content at all.
   */
  it('carries the handover into the log, and folds it back with no catalogue open', () => {
    const log = table(homebrew);
    const declared = unwrap(
      resolveSpell(
        fold('seed', log),
        CASTER,
        { spellId: 'long-whisper', targets: [TARGET], slotLevel: 3 },
        supply(homebrew),
      ),
      'the rite begins',
    );
    expect(declared.events.some((e) => e.type === 'spell-declared')).toBe(true);

    const open = fold('seed', [...log, ...declared.events]);
    expect(dmDecisionsIn(open.pendingCastings[declared.castingId!]!.unverified)).toContain(
      'Range: Special',
    );

    const tick = unwrap(advanceTime(open, 60, 'the rite'), 'a minute passes');
    const ticked = [...log, ...declared.events, ...tick];
    const settled = unwrap(
      resolveDeclaredCast(fold('seed', ticked), declared.castingId!, supply(homebrew)),
      'the rite ends',
    );
    expect(dmDecisionsIn(settled.unverified)).toContain('Range: Special');

    // **And the settling event does not repeat it.** The declaration is where
    // this casting wrote down what it read from the catalogue, so the
    // `spell-cast` that ends the rite carries no text at all: one sentence in
    // two events of one log is the second place to get it wrong. Pinned here
    // rather than only claimed in a docstring, because nothing else would
    // notice a later hand adding the second copy.
    const record = settled.events.find((event) => event.type === 'spell-cast');
    expect(record?.type).toBe('spell-cast');
    expect(record !== undefined && 'dmDecides' in record).toBe(false);

    const after = fold('seed', [...ticked, ...settled.events]);
    expect(remaining(after.creatures[CASTER]!.resources, spellSlotKey(3))).toBe(3);
  });
});

/**
 * **And an atomic casting writes it down too.**
 *
 * A rite of a minute pins its handover onto `spell-declared`, because a
 * declaration is where a casting writes down what it read from the catalogue.
 * An Action casting has no declaration: its handover reached the caller's
 * `unverified` and nothing else, so a log replayed a year later — with this
 * year's book, or with no book at all — had lost the one sentence the table
 * still had to answer. CLAUDE.md's rule 5 holds for every casting or for none.
 *
 * So `spell-cast` carries the printed text, the book's own words and nothing
 * paraphrased, exactly as the definition stated them. None of the three SRD
 * spells that hand text over is an Action, which is why the spell under test
 * is homebrew loaded through `loadContent` — and that is the second claim
 * here: the shape needs no engine change to be used, only the one that put the
 * field on the event.
 */
describe('an atomic casting pins its handover into the log', () => {
  const whisper = (log: readonly GameEvent[], spellId = 'far-whisper') =>
    unwrap(
      resolveSpell(
        fold('seed', log),
        CASTER,
        { spellId, targets: [TARGET], slotLevel: 3 },
        supply(homebrew),
      ),
      spellId,
    );

  /** The event that records the casting, out of whatever a command emitted. */
  const recordIn = (events: readonly GameEvent[]) => {
    const cast = events.find((event) => event.type === 'spell-cast');
    if (cast?.type !== 'spell-cast') throw new Error('the casting wrote no spell-cast');
    return cast;
  };

  it('carries the printed text on the event, word for word', () => {
    const log = table(homebrew);
    const cast = whisper(log);

    expect(cast.events.some((event) => event.type === 'spell-declared')).toBe(false);
    expect(recordIn(cast.events).dmDecides).toEqual([
      'Range: Special',
      'The listener hears whatever the winds have carried to them, and the GM decides what that is.',
    ]);
    // The same words the caller was handed, so the log and the report cannot
    // drift: one of them is not a paraphrase of the other.
    expect(recordIn(cast.events).dmDecides).toEqual(dmDecisionsIn(cast.unverified));
  });

  /**
   * And a reader of the log gets them back with no catalogue open at all —
   * which is the whole of rule 5, asked of the path that did not keep it.
   */
  it('folds back with no content, and reads as the table would be shown it', () => {
    const log = table(homebrew);
    const cast = whisper(log);
    const replayed = [...log, ...cast.events];

    // The fold takes no content, so this *is* the replay a year later.
    const after = fold('seed', replayed);
    expect(after.creatures[CASTER]!.concentration?.castingId).toBe(cast.castingId);

    const record = recordIn(replayed);
    expect(record.dmDecides?.map((printed) => handedOver(record.spell, printed))).toEqual([
      `Far Whisper: ${DM_DECIDES} Range: Special`,
      `Far Whisper: ${DM_DECIDES} The listener hears whatever the winds have carried to them, and the GM decides what that is.`,
    ]);
  });

  /**
   * A casting that hands nothing over writes nothing, so every log this engine
   * has ever written folds to exactly the state it always did.
   *
   * The spell it is driven with carries an `unmodelled` line instead, which is
   * the second half of the claim: a **debt** is not pinned. One of those is a
   * clause somebody will build, after which the line goes — a log that had
   * frozen it would report a gap the engine had long since closed — and the
   * other is a question nobody will ever answer for the table.
   */
  it('writes no field for a spell with nothing to hand over', () => {
    const plain = unwrap(
      loadContent({
        spells: [
          {
            ...(JSON.parse(FAR_WHISPER) as object),
            id: 'quiet-whisper',
            range: { kind: 'ranged', feet: 600 },
            dmDecides: [],
            unmodelled: ['The winds carry nothing this engine has a shape for.'],
          },
        ],
      }),
      'load',
    );
    const log = table(plain);
    const cast = unwrap(
      resolveSpell(
        fold('seed', log),
        CASTER,
        { spellId: 'quiet-whisper', targets: [TARGET], slotLevel: 3 },
        { issuer: createRollIssuer('r'), rng: createRng('whisper') as Rng, content: plain },
      ),
      'quiet whisper',
    );
    expect(cast.unverified).toHaveLength(1);
    expect('dmDecides' in recordIn(cast.events)).toBe(false);
  });

  /** And a retry of the casting is the casting: one event, one handover. */
  it('pins it once under a repeated command id', () => {
    const log = table(homebrew);
    const first = unwrap(
      resolveSpell(
        fold('seed', log),
        CASTER,
        { spellId: 'far-whisper', targets: [TARGET], slotLevel: 3, commandId: 'whisper' },
        supply(homebrew),
      ),
      'the whisper',
    );
    const after = [...log, ...first.events];
    const again = unwrap(
      resolveSpell(
        fold('seed', after),
        CASTER,
        { spellId: 'far-whisper', targets: [TARGET], slotLevel: 3, commandId: 'whisper' },
        supply(homebrew),
      ),
      'again',
    );

    expect(again.events).toEqual([]);
    expect(
      [...after, ...again.events].filter((event) => event.type === 'spell-cast'),
    ).toHaveLength(1);
    expect(remaining(fold('seed', after).creatures[CASTER]!.resources, spellSlotKey(3))).toBe(3);
  });
});

/**
 * **The two atomic paths that handed it only to their caller.**
 *
 * A spell cast at a Ready and a spell cast on a hit are both atomic castings —
 * neither writes a `spell-declared` — and both went through the low-level door
 * with a definition already in hand and did not pass the handover down. Rule 5
 * is about what a command *read from content*, so both were a sentence the log
 * lost: the printed text reached the caller and nowhere else.
 *
 * **No SRD spell reaches either**, which is why the spells here are homebrew
 * loaded through `loadContent` — a Ready takes a spell cast with an action and
 * all three SRD handovers take a minute or more, and a spell cast on a hit must
 * print an `attack-damage` effect. That nothing in the catalogue was losing
 * text is the reason this was a limit rather than a bug, and a homebrew
 * definition reaching both is the reason it is closed.
 */
describe('the two atomic paths that did not keep their handover', () => {
  const recordIn = (events: readonly GameEvent[]) => {
    const cast = events.find((event) => event.type === 'spell-cast');
    if (cast?.type !== 'spell-cast') throw new Error('the casting wrote no spell-cast');
    return cast;
  };

  /**
   * SRD Ready: "you cast it as normal (expending any resources used to cast
   * it) but hold its energy." The slot goes at the Ready and so does the
   * `spell-cast` — a turn before the spell takes effect — so that event is the
   * only place the handover could be written down.
   */
  describe('a spell cast at a Ready', () => {
    const inCombat = (content: Content): readonly GameEvent[] => [
      ...table(content),
      {
        type: 'combat-started',
        combatants: [
          { id: CASTER, initiative: 20, speed: 30 },
          { id: TARGET, initiative: 1, speed: 30 },
        ],
      },
    ];

    const ready = (content: Content, spellId: string) => {
      const log = inCombat(content);
      const events = unwrap(
        takeReady(
          fold('seed', log),
          CASTER,
          {
            trigger: 'when the door opens',
            response: { kind: 'spell', spellId, slotLevel: 3 },
          },
          content,
        ),
        'the Ready',
      );
      return { log: [...log, ...events], events };
    };

    it('pins the printed text onto the casting the Ready writes', () => {
      const { events } = ready(homebrew, 'far-whisper');

      expect(events.some((event) => event.type === 'spell-declared')).toBe(false);
      expect(recordIn(events).dmDecides).toEqual([
        'Range: Special',
        'The listener hears whatever the winds have carried to them, and the GM decides what that is.',
      ]);
    });

    /** And a reader of the log gets it back with no catalogue open. */
    it('folds back with no content at all', () => {
      const { log } = ready(homebrew, 'far-whisper');
      const record = recordIn(log);

      expect(fold('seed', log).creatures[CASTER]!.readied?.response.kind).toBe('spell');
      expect(record.dmDecides?.map((printed) => handedOver(record.spell, printed))).toEqual([
        `Far Whisper: ${DM_DECIDES} Range: Special`,
        `Far Whisper: ${DM_DECIDES} The listener hears whatever the winds have carried to them, and the GM decides what that is.`,
      ]);
    });

    /** A spell that hands nothing over writes no field, so nothing else moved. */
    it('writes no field for a spell with nothing to hand over', () => {
      const quiet = unwrap(
        loadContent({
          spells: [
            {
              ...(JSON.parse(FAR_WHISPER) as object),
              id: 'quiet-whisper',
              range: { kind: 'ranged', feet: 600 },
              dmDecides: [],
              unmodelled: ['The winds carry nothing this engine has a shape for.'],
            },
          ],
        }),
        'load',
      );
      const { events } = ready(quiet, 'quiet-whisper');
      expect('dmDecides' in recordIn(events)).toBe(false);
    });
  });

  /**
   * SRD Divine Smite is cast in the window a hit opens, so its `spell-cast` is
   * written by the command that settles the blow. The spell here is a homebrew
   * smite, because the shape a cast-on-hit must print — an `attack-damage`
   * effect — is printed by no SRD spell that also hands text over.
   */
  describe('a spell cast on a hit', () => {
    const SMITE = JSON.stringify({
      id: 'whispered-smite',
      name: 'Whispered Smite',
      level: 3,
      school: 'evocation',
      castingTime: 'bonus-action',
      concentration: false,
      range: { kind: 'self' },
      targets: { count: 0 },
      effects: [
        { kind: 'attack-damage', damage: { dice: '2d8' }, damageType: 'radiant' },
      ],
      dmDecides: ['The winds answer the blow, and the GM decides what they say.'],
    });

    const armed = (content: Content): readonly GameEvent[] => [
      ...table(content).map((event) =>
        event.type === 'creature-placed' && event.id === TARGET
          ? {
              ...event,
              placement: { from: { creature: CASTER }, feet: 5, bearing: 0 },
            }
          : event,
      ),
    ];

    /** A hit held open, with the damage still to roll — the smite's own window. */
    const held = (content: Content) => {
      const log = armed(content);
      const swing = unwrap(
        resolveAttack(
          fold('seed', log),
          CASTER,
          {
            target: TARGET,
            // An Unarmed Strike: the content under test is a spell file and
            // holds no weapons, which is the point of loading it alone.
            weapon: null,
            hold: true,
            free: true,
            attackBonuses: [{ source: 'the test insists', flat: 40 }],
          },
          supply(content),
        ),
        'the swing',
      );
      return [...log, ...swing.events];
    };

    const smite = (content: Content, spellId: string) => {
      const log = held(content);
      const out = unwrap(
        resolveAttackDamage(
          fold('seed', log),
          CASTER,
          { smite: { spellId, slotLevel: 3 } },
          supply(content),
        ),
        'the smite',
      );
      return { log: [...log, ...out.events], events: out.events };
    };

    const smiting = unwrap(loadContent({ spells: [JSON.parse(SMITE)] }), 'load');

    it('pins the printed text onto the casting the blow writes', () => {
      const { events } = smite(smiting, 'whispered-smite');

      expect(events.some((event) => event.type === 'spell-declared')).toBe(false);
      expect(recordIn(events).dmDecides).toEqual([
        'The winds answer the blow, and the GM decides what they say.',
      ]);
    });

    it('folds back with no content at all', () => {
      const { log } = smite(smiting, 'whispered-smite');
      const record = recordIn(log);

      expect(fold('seed', log).pendingAttack).toBeNull();
      expect(record.dmDecides?.map((printed) => handedOver(record.spell, printed))).toEqual([
        `Whispered Smite: ${DM_DECIDES} The winds answer the blow, and the GM decides what they say.`,
      ]);
    });

    it('writes no field for a smite with nothing to hand over', () => {
      const plain = unwrap(
        loadContent({
          spells: [
            { ...(JSON.parse(SMITE) as object), id: 'plain-smite', name: 'Plain Smite', dmDecides: [] },
          ],
        }),
        'load',
      );
      const { events } = smite(plain, 'plain-smite');
      expect('dmDecides' in recordIn(events)).toBe(false);
    });
  });
});
