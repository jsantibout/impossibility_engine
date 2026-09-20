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
import {
  advanceTime,
  eligibleTargets,
  resolveDeclaredCast,
  resolveSpell,
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

    const after = fold('seed', [...ticked, ...settled.events]);
    expect(remaining(after.creatures[CASTER]!.resources, spellSlotKey(3))).toBe(3);
  });
});
