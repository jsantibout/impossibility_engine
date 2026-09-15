import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap, type CharacterId, type Result } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { applyEvent, fold, type GameEvent, type GameState } from './events.js';
import { spellSlotKey } from './resources.js';
import { declaredCasting } from './spellcasting.js';
import type { SpellDefinition } from './spell-definitions.js';
import { resolveEffects } from './commands/spell-resolution.js';
import { ongoingSpellOf, ongoingSpellsOn, resolveSpell } from './commands.js';

/**
 * Two of the three mutations the whole suite could not see.
 *
 * When `resolveEffects` was split into one resolver per effect kind, the
 * oracle was byte-identity rather than the suite — and the reason that
 * mattered is recorded in CLAUDE.md: **three mutations survived every test in
 * the repository.** Each was a line that looks exactly like the lines around
 * it and means something else, and each was left as a named hazard rather than
 * fixed, because a behaviour-preserving refactor whose diff also contains a
 * fix cannot be verified by its own oracle.
 *
 * | Mutation | What it costs | Where the fixture is |
 * |---|---|---|
 * | Dispel Magic's inner `continue` | a Dispel stops at the first spell whose check it fails | here |
 * | the effect loop's `current = done.value` | an effect cannot read the world its predecessor left | here |
 * | the `from` wiring | the Prone rule is read from the caster rather than from the force | `spell-origins.test.ts` |
 *
 * A hazard named in prose is one somebody has to remember; these are three
 * tests, and each of them goes red under exactly one mutation.
 */

const id = (s: string) => asCharacterId(s);
const CASTER = id('caster');
const ALLY = id('ally');

const sheet = (): CharacterSheet => ({
  level: 11,
  abilities: { str: 10, dex: 14, con: 16, int: 10, wis: 18, cha: 10 },
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
  maxHp: 120,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side: 'party',
});

const PREPARED = ['true-seeing', 'stoneskin', 'dispel-magic'];

const SETUP: readonly GameEvent[] = [
  added(CASTER),
  added(ALLY),
  ...[1, 2, 3, 4, 5, 6].map(
    (level): GameEvent => ({
      type: 'resource-pool-declared',
      id: CASTER,
      pool: {
        key: spellSlotKey(level),
        label: `level ${level}`,
        max: 4,
        recovers: 'long-rest',
      },
    }),
  ),
  { type: 'scene-set', extent: { width: 200, depth: 200, height: 40 } },
  { type: 'landmark-added', name: 'the vestry', at: { x: 100, y: 100, z: 0 } },
  { type: 'creature-placed', id: CASTER, placement: { from: { landmark: 'the vestry' }, feet: 0 } },
  {
    type: 'creature-placed',
    id: ALLY,
    placement: { from: { creature: CASTER }, feet: 5, bearing: 0 },
  },
  { type: 'sight-declared', from: CASTER, to: ALLY, seen: true },
  {
    type: 'spellcasting-declared',
    id: CASTER,
    spellcasting: declaredCasting({
      ability: 'wis',
      classId: 'cleric',
      cantrips: [],
      prepared: PREPARED,
    }),
  },
];

const base = (): GameState => fold('effect-resolvers', SETUP);

const must = <T,>(result: Result<T>): T => unwrap(result, 'effect resolvers');

const supply = (seed: string) => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

const applyAll = (state: GameState, events: readonly GameEvent[]): GameState =>
  events.reduce(applyEvent, state);

// — Dispel Magic walks the whole list ——————————————————————————————————————————

/**
 * SRD Dispel Magic: "**any** ongoing spell of level 3 or lower on the target
 * ends", and above that "make an ability check ... for each spell". *Each* is
 * the word this is about: a check that fails ends nothing and the next spell
 * is still asked.
 *
 * The resolver walks `ongoingSpellsOn` with an inner `for`, and the `continue`
 * in its failed-check branch belongs to **that** loop rather than to the
 * effect loop outside it — so it is the one `continue` the resolver split
 * deliberately did not rewrite as a `return`. Rewriting it stops a Dispel
 * Magic at the first spell it fails to shift, which no fixture could see:
 * every Dispel in the suite was aimed at a creature carrying one spell.
 *
 * **Two spells above the slot's level, on one creature, and the first check
 * fails.** True Seeing is level 6 and Stoneskin level 4, so a level 3 Dispel
 * has to roll for both — DC 16 and DC 14, on a bare Wisdom check with a +4
 * modifier and no proficiency. The seed is chosen so the first roll misses
 * its DC and the second makes its own.
 */
describe('a Dispel Magic that fails one check goes on to the next spell', () => {
  /** True Seeing first, because `ongoingSpellsOn` walks in casting order. */
  const twoSpellsOn = (): { state: GameState; seeing: string; skin: string } => {
    const first = must(
      resolveSpell(base(), CASTER, { spellId: 'true-seeing', targets: [ALLY], slotLevel: 6 }, supply('a')),
    );
    const afterFirst = applyAll(base(), first.events);
    const second = must(
      resolveSpell(afterFirst, CASTER, { spellId: 'stoneskin', targets: [ALLY], slotLevel: 4 }, supply('b')),
    );
    return {
      state: applyAll(afterFirst, second.events),
      seeing: first.castingId,
      skin: second.castingId,
    };
  };

  it('has two dispellable spells on one creature to begin with', () => {
    const { state, seeing, skin } = twoSpellsOn();
    expect(ongoingSpellsOn(state, ALLY).map((o) => o.castingId)).toEqual([seeing, skin]);
    // Both above a level 3 slot, so both need a check rather than ending flat.
    expect(ongoingSpellsOn(state, ALLY).map((o) => o.level)).toEqual([6, 4]);
  });

  it('rolls for the second spell after failing the check for the first', () => {
    const { state, seeing, skin } = twoSpellsOn();

    const dispel = must(
      resolveSpell(
        state,
        CASTER,
        { spellId: 'dispel-magic', targets: [ALLY], slotLevel: 3 },
        supply('s7'),
      ),
    );
    const after = applyAll(state, dispel.events);

    // Two checks, in casting order, and the log says which spell each was for.
    const checks = dispel.events.filter(
      (event) => event.type === 'roll-recorded' && event.label.startsWith('Dispel Magic vs'),
    );
    expect(checks.map((event) => (event.type === 'roll-recorded' ? event.outcome : null))).toEqual([
      'held',
      'dispelled',
    ]);

    // The first survived its failed check; the second did not survive its own.
    expect(ongoingSpellOf(after, seeing)).not.toBeNull();
    expect(ongoingSpellOf(after, skin)).toBeNull();

    // And the outcome list reports both, rather than stopping at the failure.
    expect(dispel.outcomes.map((outcome) => outcome.affected)).toEqual([false, true]);
    expect(dispel.outcomes[1]?.dispelled).toBe(skin);
  });
});

// — an effect reads the world its predecessor left ————————————————————————————

/**
 * The effect loop threads state: `current = done.value` after every effect, so
 * the second effect on a target sees what the first did to them.
 *
 * Commenting that line out passed the entire suite, because **effects on one
 * target are near-enough independent in every registered definition** — every
 * catalogue spell's list is a damage roll beside a condition beside a grant,
 * and none of them asks a question the one before it answered.
 *
 * So the fixture is a definition rather than a spell. `resolveEffects` is pure
 * over the definition it is handed and does not consult the catalogue, which
 * is exactly the move this repository already makes for a guard no class can
 * reach — `restoreOn`'s dawn-recovering pool, and the Ritual whose printed
 * casting time is not an Action. A definition that imposes a condition and
 * then ends it is not a spell anybody would print; what it is is the smallest
 * pair of effects whose second reads the first, with **no die thrown on either
 * side**, so the assertion turns on the threading and on nothing else.
 */
describe('an effect sees the world the effect before it left', () => {
  const FIXTURE: SpellDefinition = {
    id: 'a-threading-fixture',
    name: 'A Threading Fixture',
    level: 1,
    school: 'transmutation',
    castingTime: 'action',
    concentration: false,
    range: { kind: 'touch' },
    targets: { count: 1 },
    effects: [
      // Nothing is rolled by either: a condition with no saving throw is the
      // `save` shape minus the roll, and a removal throws nothing at all.
      { kind: 'condition', condition: { name: 'poisoned', outlivesCasting: true } },
      { kind: 'end-condition', conditions: ['poisoned'] },
    ],
    unmodelled: ['a fixture, not a spell: it exists to put two effects in a row'],
  };

  const run = (): { events: readonly GameEvent[]; outcomes: readonly { readonly affected: boolean; readonly ended?: readonly string[] }[] } => {
    const state = base();
    const events: GameEvent[] = [];
    const out = must(
      resolveEffects(state, CASTER, state.creatures[CASTER]!, FIXTURE, {
        castLevel: 1,
        route: null,
        numbers: {
          attackModifier: 9,
          saveDc: 17,
          spellcastingModifier: 4,
          casterLevel: 11,
        },
        targets: [ALLY],
        unverified: [],
        supply: supply('threading'),
        castingId: 'cast:1',
        events,
      }),
    );
    return { events: out.events, outcomes: out.outcomes };
  };

  it('ends the condition the effect before it imposed', () => {
    const { events, outcomes } = run();

    // Both effects reported, and the second one acted.
    expect(outcomes.map((outcome) => outcome.affected)).toEqual([true, true]);
    expect(outcomes[1]?.ended).toEqual(['poisoned']);

    // One arrival and one departure, in that order.
    expect(events.map((event) => event.type)).toEqual(['condition-applied', 'condition-removed']);

    // And the fold agrees, which is the half a list of events cannot say.
    expect(applyAll(base(), events).creatures[ALLY]?.conditions.conditions).toEqual([]);
  });

  /**
   * The same pair with the first effect removed, so the second has nothing to
   * find. It is what the mutation makes of the test above, written down: a
   * removal with nothing to remove is an outcome rather than an event, so
   * "nothing happened" and "the threading is broken" are the same answer and
   * the case above is the only thing that can tell them apart.
   */
  it('reports nothing to end when the condition was never there', () => {
    const state = base();
    const events: GameEvent[] = [];
    const out = must(
      resolveEffects(state, CASTER, state.creatures[CASTER]!, { ...FIXTURE, effects: [FIXTURE.effects[1]!] }, {
        castLevel: 1,
        route: null,
        numbers: { attackModifier: 9, saveDc: 17, spellcastingModifier: 4, casterLevel: 11 },
        targets: [ALLY],
        unverified: [],
        supply: supply('threading'),
        castingId: 'cast:1',
        events,
      }),
    );

    expect(out.outcomes.map((outcome) => outcome.affected)).toEqual([false]);
    expect(events).toEqual([]);
  });
});
