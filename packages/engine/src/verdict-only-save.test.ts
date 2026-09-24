import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { extendContent } from './content.js';
import { fold, type GameEvent } from './events.js';
import { declaredCasting } from './spellcasting.js';
import { resolveSpell } from './commands.js';
import { checkSpellDefinitionValue } from './spell-schema.js';

/**
 * A saving throw whose whole content is its verdict.
 *
 * SRD Animal Messenger: "A Tiny Beast of your choice that you can see within
 * range **must succeed on a Charisma saving throw**, or it attempts to deliver
 * a message for you." The failure imposes no condition, hangs no rider and
 * moves nobody — what it decides is whether the beast goes, which is an errand
 * only the table can run.
 *
 * Two refusals stood between that sentence and a definition, and both were
 * right about the case they were written for:
 *
 * | Refusal | What it was protecting |
 * |---|---|
 * | `save_imposes_nothing` | a die thrown for nothing, whose answer reaches no reader at the table or in the rules |
 * | `verdict_before_the_record` | `recordsOutcome` in the casting's own list, which would write onto an `OngoingSpell` the fold has never heard of |
 *
 * **The ruling is a third door rather than a hole in either.** A save may say
 * `verdictOnly` when the verdict *is* the content: the die is rolled, the
 * answer is published through the casting's result and stands in the log as
 * the D20 Test it was, and nothing is written onto a record that need not
 * exist. `save_imposes_nothing` lifts for that mark alone — a save that
 * neither imposes anything nor claims the mark is still a die thrown for
 * nothing — and the mark is refused beside every rider and beside
 * `recordsOutcome`, because a save that decided something else is not a save
 * whose whole content is its verdict.
 */

const id = (s: string) => asCharacterId(s);
const DRUID = id('druid');
const SPARROW = id('sparrow');

const BASE = {
  id: 'homebrew-errand',
  name: 'Homebrew Errand',
  level: 2,
  school: 'enchantment',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 60 },
  targets: { count: 1 },
} as const;

/** The definition the ruling describes, and the one every refusal below bends. */
const errand = (save: Record<string, unknown>) => ({
  ...BASE,
  effects: [{ kind: 'save', ability: 'cha', ...save }],
  dmDecides: ['The beast attempts to deliver a message for you.'],
});

const codes = (value: unknown): readonly string[] =>
  checkSpellDefinitionValue(value).map((p) => `${p.field}:${p.code}`);

describe('what the validator holds a verdict to', () => {
  it('refuses a save that imposes nothing and does not claim the mark', () => {
    // Unchanged, and this is the assertion that keeps the lift from being a
    // hole: a save that decides nothing and says nothing is still a die thrown
    // for nothing.
    expect(codes(errand({}))).toContain('effects[0].condition:save_imposes_nothing');
  });

  it('accepts a save whose whole content is its verdict', () => {
    expect(codes(errand({ verdictOnly: true }))).toEqual([]);
  });

  it('refuses the mark beside a rider, which is a save that decided something', () => {
    expect(
      codes(errand({ verdictOnly: true, condition: 'charmed' })),
    ).toContain('effects[0].verdictOnly:verdict_is_not_the_whole_content');
    expect(
      codes(
        errand({
          verdictOnly: true,
          modifiers: [
            { kind: 'speed-change', change: 'halve', lasts: 'start-of-casters-next-turn' },
          ],
        }),
      ),
    ).toContain('effects[0].verdictOnly:verdict_is_not_the_whole_content');
    expect(codes(errand({ verdictOnly: true, movement: { feet: 10 } }))).toContain(
      'effects[0].verdictOnly:verdict_is_not_the_whole_content',
    );
  });

  it('refuses the mark beside the record the other door writes onto', () => {
    // **Refused twice over, and the first refusal is the shape pass.** In the
    // casting's own list `recordsOutcome` is refused on its own — the record it
    // would write onto does not exist yet — and `checkShape` reports that and
    // stops, so the pair never reaches the semantic rule.
    expect(codes(errand({ verdictOnly: true, recordsOutcome: true }))).toEqual([
      'effects[0].recordsOutcome:verdict_before_the_record',
    ]);

    // So the pair can never stand, whichever list it is written in: in an
    // areaTrigger or an activation the mark itself is the wrong door and
    // `verdict_after_the_record` answers. The rule that counts a record among
    // the things a save may have decided is reached through the riders
    // instead, which is what the case below and the one above it drive.
    expect(
      codes(errand({ verdictOnly: true, breaksConcentration: true })),
    ).toContain('effects[0].verdictOnly:verdict_is_not_the_whole_content');
  });

  it('refuses the mark on an effect that rolls no saving throw', () => {
    expect(
      codes({
        ...BASE,
        effects: [{ kind: 'heal', dice: '1d8', verdictOnly: true }],
        unmodelled: ['a fixture'],
      }),
    ).toContain('effects[0].verdictOnly:verdict_without_save');
  });

  it('refuses the mark where a record already exists to be written onto', () => {
    // An area trigger and an activation both fire off a casting the cast has
    // already written, so the verdict has somewhere to be kept and
    // `recordsOutcome` is the field that keeps it.
    expect(
      codes({
        ...BASE,
        targets: { count: 0 },
        concentration: true,
        durationSeconds: 60,
        area: { kind: 'sphere', radius: 20, origin: 'point' },
        effects: [],
        areaTrigger: {
          at: 'end-of-turn',
          effects: [{ kind: 'save', ability: 'cha', verdictOnly: true }],
        },
        unmodelled: ['a fixture'],
      }),
    ).toContain('areaTrigger.effects[0].verdictOnly:verdict_after_the_record');
  });

  it('refuses a value other than true, which is how absence says nothing', () => {
    expect(codes(errand({ verdictOnly: false }))).toContain('effects[0].verdictOnly:malformed_field');
  });
});

// — and the die is really thrown ————————————————————————————————————————

const sheet = (): CharacterSheet => ({
  level: 5,
  abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 16, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'wis',
});

const added = (who: CharacterId): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(),
  maxHp: 20,
  diesAtZero: false,
  creatureType: 'Beast',
});

const SETUP: readonly GameEvent[] = [
  added(DRUID),
  added(SPARROW),
  {
    type: 'spellcasting-declared',
    id: DRUID,
    spellcasting: declaredCasting({ ability: 'wis', prepared: ['homebrew-errand'] }),
  },
  ...[1, 2].map(
    (level): GameEvent => ({
      type: 'resource-pool-declared',
      id: DRUID,
      pool: { key: `spell-slot:${level}`, label: `level ${level}`, max: 4, recovers: 'long-rest' },
    }),
  ),
  { type: 'scene-set', extent: { width: 200, depth: 200, height: 40 } },
  { type: 'creature-placed', id: DRUID, placement: { from: { point: { x: 50, y: 50, z: 0 } }, feet: 0 } },
  {
    type: 'creature-placed',
    id: SPARROW,
    placement: { from: { point: { x: 60, y: 50, z: 0 } }, feet: 0 },
  },
  { type: 'sight-declared', from: DRUID, to: SPARROW, seen: true },
];

const content = unwrap(
  extendContent(SRD_CONTENT, { spells: [errand({ verdictOnly: true }) as never] }),
  'the homebrew errand',
);

describe('a casting whose whole content is a verdict', () => {
  it('rolls the die, publishes the answer and writes no ongoing record', () => {
    const state = fold('seed', SETUP);
    const cast = unwrap(
      resolveSpell(
        state,
        DRUID,
        { spellId: 'homebrew-errand', targets: [SPARROW], slotLevel: 2 },
        { issuer: createRollIssuer('r'), rng: createRng('errand') as Rng, content },
      ),
      'the errand',
    );

    // The verdict, published through the casting's result: the engine rolled
    // it and the caller is told which way it went.
    const outcome = cast.outcomes.find((one) => one.target === SPARROW);
    expect(outcome?.save).toBeDefined();
    expect(typeof outcome?.save?.success).toBe('boolean');

    // And it stands in the log as the D20 Test it was, which is what makes the
    // answer survive a replay without a record to be written onto.
    const after = fold('seed', [...SETUP, ...cast.events]);
    expect(cast.events.some((e) => e.type === 'roll-recorded')).toBe(true);
    expect(Object.keys(after.ongoing)).toEqual([]);

    // And the errand itself is the table's, handed over in the book's words.
    const recorded = cast.events.find((e) => e.type === 'spell-cast');
    expect((recorded as { dmDecides?: readonly string[] }).dmDecides).toContain(
      'The beast attempts to deliver a message for you.',
    );
  });
});
