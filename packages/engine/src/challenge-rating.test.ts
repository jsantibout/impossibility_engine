import { SRD_CONTENT } from '@ie/content';
import { describe, expect, it } from 'vitest';
import {
  asCharacterId,
  contextRequestsOf,
  isNeedsContext,
  expect as unwrap,
  type CharacterId,
  type Result,
} from '@ie/shared';
import { addCreature, resolveSpell } from './commands.js';
import { extendContent } from './content.js';
import { createRng, type Rng } from './dice.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { spellSlotKey } from './resources.js';
import { createRollIssuer } from './rolls.js';
import { declaredCasting } from './spellcasting.js';
import type { SpellDefinition } from './spell-definitions.js';
import { checkSpellDefinitionValue } from './spell-schema.js';
import type { CharacterSheet } from './character.js';

/**
 * A Challenge Rating the creature carries, and the rule that reads one.
 *
 * `adaptMonster` has parsed a rating off every stat block since the bestiary
 * landed and `creature-added` carried it nowhere, so SRD Animal Messenger's
 * parenthesis — "if the target's Challenge Rating isn't 0, it automatically
 * succeeds" — had nothing to ask. The rating is pinned at the arrival now,
 * beside the size and the creature type and for their reason: the book answers
 * it, so nobody above the engine is asked to.
 *
 * **Null is a real state and is not a zero.** A player character has no
 * Challenge Rating at all, and zero is the one answer that would always pass
 * this gate — so a creature nobody has rated is asked about rather than
 * spared.
 *
 * **The reader is exercised over a definition written here**, and that is
 * deliberate rather than convenient: SRD Animal Messenger is the book's one
 * writer of this clause and it cannot be written yet — what its failure buys
 * is an errand, so the only thing left for the die to decide is its own
 * verdict, and `verdict_before_the_record` refuses `recordsOutcome` in a
 * casting's own effect list. The same move `castingOf`'s docstring already
 * makes for an arithmetic no registered spell could reach: being pure over a
 * definition is what lets the rule be asked at all.
 */

const id = (s: string): CharacterId => asCharacterId(s);
const DRUID = id('druid');
const RAVEN = id('raven');
const SNAKE = id('snake');
const IMPOSTOR = id('impostor');

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 9,
  abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 20, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'wis',
  ...over,
});

const supply = () => ({
  issuer: createRollIssuer('r'),
  rng: createRng('messenger') as Rng,
  content: SRD_CONTENT,
});

/** The druid, a level 2 slot, and the errand spell prepared. */
const DRUID_ARRIVES: readonly GameEvent[] = [
  {
    type: 'creature-added',
    id: DRUID,
    name: 'Bera',
    sheet: sheet(),
    maxHp: 60,
    diesAtZero: false,
    creatureType: 'Humanoid',
  },
  {
    type: 'spellcasting-declared',
    id: DRUID,
    spellcasting: declaredCasting({
      ability: 'wis',
      classId: 'druid',
      prepared: ['animal-messenger'],
    }),
  },
  {
    type: 'resource-pool-declared',
    id: DRUID,
    pool: { key: spellSlotKey(2), label: 'level 2 spell slot', max: 4, recovers: 'long-rest' },
  },
  { type: 'scene-set', extent: { width: 200, depth: 200, height: 40 } },
  { type: 'landmark-added', name: 'the hedge', at: { x: 50, y: 50, z: 0 } },
  { type: 'creature-placed', id: DRUID, placement: { from: { landmark: 'the hedge' }, feet: 0 } },
];

const beside = (who: CharacterId): GameEvent => ({
  type: 'creature-placed',
  id: who,
  placement: { from: { landmark: 'the hedge' }, feet: 10 },
});

const seeing = (who: CharacterId): GameEvent => ({
  type: 'sight-declared',
  from: DRUID,
  to: who,
  seen: true,
});

const table = (): { log: GameEvent[]; state: () => GameState } => {
  const log: GameEvent[] = [...DRUID_ARRIVES];
  return { log, state: () => fold('messenger', log) };
};

const push = <T extends { readonly events: readonly GameEvent[] }>(
  log: GameEvent[],
  step: string,
  result: Result<T>,
): T => {
  const value = unwrap(result, step);
  log.push(...value.events);
  return value;
};

describe('a Challenge Rating the creature carries', () => {
  it('pins the rating the block prints onto the arrival and onto the creature', () => {
    const { log, state } = table();
    const arrival = push(log, 'the raven arrives', addCreature(state(), SRD_CONTENT, RAVEN, 'raven'));
    const added = arrival.events.find((event) => event.type === 'creature-added');
    expect(added).toMatchObject({ cr: 0 });
    expect(state().creatures[RAVEN]?.cr).toBe(0);

    push(log, 'the snake arrives', addCreature(state(), SRD_CONTENT, SNAKE, 'venomous-snake'));
    // The book prints 1/8, which the parser reads as the number it is.
    expect(state().creatures[SNAKE]?.cr).toBe(0.125);
  });

  /**
   * A character has no Challenge Rating at all, which is a fact about the SRD
   * rather than a gap in the fold — so the field stays null and every rule
   * that reads one has to cope with that.
   */
  it('leaves a creature nobody rated with no rating', () => {
    const { state } = table();
    expect(state().creatures[DRUID]?.cr).toBeNull();
  });
});

/**
 * SRD Animal Messenger's sentence with a failure the engine can hold, so the
 * rule the spell is waiting on can be asked of something.
 *
 * "A Tiny Beast … must succeed on a Charisma saving throw, or it attempts to
 * deliver a message for you (if the target's Challenge Rating isn't 0, it
 * automatically succeeds)" — with the errand written as the one thing a rider
 * can honestly say about a Beast that trots off: its Speed is the spell's for
 * the hour. Everything about the *save* is the book's.
 */
const AN_ERRAND: SpellDefinition = {
  id: 'an-errand-for-a-beast',
  name: 'An Errand for a Beast',
  level: 2,
  school: 'enchantment',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 30 },
  targets: { count: 1, mustBeType: 'Beast' },
  effects: [
    {
      kind: 'save',
      ability: 'cha',
      autoSucceedIf: { challengeRatingAbove: 0 },
      modifiers: [{ kind: 'speed-change', change: 'halve' }],
    },
  ],
  durationSeconds: 3600,
};

const CONTENT = unwrap(extendContent(SRD_CONTENT, { spells: [AN_ERRAND] }), 'the errand');

const errandSupply = () => ({
  issuer: createRollIssuer('r'),
  rng: createRng('errand') as Rng,
  content: CONTENT,
});

const ERRAND_PREPARED: GameEvent = {
  type: 'spellcasting-declared',
  id: DRUID,
  spellcasting: declaredCasting({
    ability: 'wis',
    classId: 'druid',
    prepared: ['an-errand-for-a-beast'],
  }),
};

describe('a save the target’s Challenge Rating decides', () => {
  it('is a definition the validator accepts', () => {
    expect(checkSpellDefinitionValue(AN_ERRAND)).toEqual([]);
  });

  /**
   * Both members in one clause is two sentences under one field, and the book
   * writes one per spell — so it is refused at authoring rather than settled by
   * whichever the reader happens to check first.
   */
  it('refuses a clause that spares two ways at once', () => {
    expect(
      checkSpellDefinitionValue({
        ...AN_ERRAND,
        effects: [
          {
            kind: 'save',
            ability: 'cha',
            autoSucceedIf: { challengeRatingAbove: 0, immuneTo: 'charmed' },
            modifiers: [{ kind: 'speed-change', change: 'halve' }],
          },
        ],
      }).map((one) => one.code),
    ).toContain('two_reasons_to_spare');
  });

  it('refuses a rating that is not one', () => {
    expect(
      checkSpellDefinitionValue({
        ...AN_ERRAND,
        effects: [
          {
            kind: 'save',
            ability: 'cha',
            autoSucceedIf: { challengeRatingAbove: -1 },
            modifiers: [{ kind: 'speed-change', change: 'halve' }],
          },
        ],
      }).map((one) => one.code),
    ).toContain('bad_challenge_rating');
  });

  /** A Raven is rated at nothing, so the parenthesis spares it of nothing. */
  it('rolls the save for a Beast the book rates at nothing', () => {
    const { log, state } = table();
    log.push(ERRAND_PREPARED);
    push(log, 'the raven arrives', addCreature(state(), CONTENT, RAVEN, 'raven'));
    log.push(beside(RAVEN), seeing(RAVEN));

    const cast = unwrap(
      resolveSpell(
        state(),
        DRUID,
        { spellId: 'an-errand-for-a-beast', targets: [RAVEN] },
        errandSupply(),
      ),
      'the errand at the raven',
    );
    const outcome = cast.outcomes.find((one) => one.target === RAVEN);
    expect(outcome?.save?.autoSucceeded).toBeNull();
    expect(outcome?.save?.roll).toBeDefined();
  });

  /**
   * A Venomous Snake is rated 1/8, so the clause decides the save before the
   * die is read — and the die is still thrown and still says what it showed,
   * which is the reading the Immunity arm already took.
   */
  it('spares a Beast the book rates above nothing, and says why', () => {
    const { log, state } = table();
    log.push(ERRAND_PREPARED);
    push(log, 'the snake arrives', addCreature(state(), CONTENT, SNAKE, 'venomous-snake'));
    log.push(beside(SNAKE), seeing(SNAKE));

    const cast = unwrap(
      resolveSpell(
        state(),
        DRUID,
        { spellId: 'an-errand-for-a-beast', targets: [SNAKE] },
        errandSupply(),
      ),
      'the errand at the snake',
    );
    const outcome = cast.outcomes.find((one) => one.target === SNAKE);
    expect(outcome?.save?.success).toBe(true);
    expect(outcome?.save?.autoSucceeded).toContain('Challenge Rating');
    expect(outcome?.save?.roll).toBeDefined();
  });

  /**
   * And a Beast nobody rated is **asked** about rather than read as a zero —
   * the difference between a fact that is missing and one that is wrong, and
   * the reason the field is nullable at all. Nothing is spent by the asking: a
   * casting is one `Result`, so a resolver that refuses leaves no events.
   */
  it('asks for a Challenge Rating nobody has stated rather than assuming one', () => {
    const { log, state } = table();
    log.push(
      ERRAND_PREPARED,
      {
        type: 'creature-added',
        id: IMPOSTOR,
        name: 'the thing in the hedge',
        sheet: sheet({ level: 1 }),
        maxHp: 4,
        diesAtZero: false,
        creatureType: 'Beast',
      },
      beside(IMPOSTOR),
      seeing(IMPOSTOR),
    );

    const asked = resolveSpell(
      state(),
      DRUID,
      { spellId: 'an-errand-for-a-beast', targets: [IMPOSTOR] },
      errandSupply(),
    );
    expect(isNeedsContext(asked)).toBe(true);
    expect(asked.ok ? null : asked.code).toBe('undeclared_challenge_rating');
    expect(contextRequestsOf(asked).map((one) => one.subject)).toEqual([IMPOSTOR]);
  });
});

