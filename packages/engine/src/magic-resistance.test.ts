/**
 * SRD Magic Resistance: "Advantage on saving throws against spells and other
 * magical effects."
 *
 * Twenty-seven stat blocks print that sentence and eleven of them are CR 5 or
 * below, and the vocabulary had no way to say it. A saving throw was picked out
 * by its family, its ability and what it was *about*, so the nearest sayable
 * thing was Advantage on every saving throw the devil ever made — a much larger
 * trait, and one that would have helped it out of a Grapple.
 *
 * So `RollSelector` gains one axis and `RollQuery` gains the fact it reads.
 * **The fact is the roller's to answer**, which is the whole of the design: a
 * spell's own `save` effect says yes outright, the turn boundary asks whether
 * the effect its repeat would end came from a casting, and a printed
 * stat-block line says nothing at all — because a Satyr's Mockery is not a
 * spell, and `forcePrintedSave` passing nothing is what makes that true rather
 * than a comment saying so.
 */

import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap, SKILL_ABILITY } from '@ie/shared';
import {
  addCreature,
  applyConditionTo,
  declareCreatureSide,
  resolveTurn,
  setScene,
  addSceneLandmark,
} from './commands.js';
import { forcePrintedSave } from './commands/actions.js';
import { resolveSpell } from './commands/spell-resolution.js';
import { createRng, restoreRng } from './dice.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { adaptMonster } from './monster.js';
import { rollSelectorProblems } from './roll-modifiers.js';
import { declaredCasting } from './spellcasting.js';
import { spellSlotKey } from './resources.js';
import { wardAgainst } from './commands/passive-defenses.js';
import { createRollIssuer } from './rolls.js';
import { rollModesFor } from './standing.js';

const id = (s: string) => asCharacterId(s);
const SEED = 'magic-resistance';
const IMP = id('spite');
const CASTER = id('kessa');

/** A caster who can reach an imp, and an imp who can be reached. */
function field(): readonly GameEvent[] {
  const log: GameEvent[] = [];
  const state = (): GameState => fold(SEED, log);
  log.push(...unwrap(addCreature(state(), SRD_CONTENT, IMP, 'imp'), 'the imp').events);
  // A night hag, because its block prints Phantasmal Killer — a spell whose
  // Wisdom save the engine actually throws and whose target may be anything,
  // where Hold Person asks for a Humanoid and an imp is a Fiend.
  log.push(...unwrap(addCreature(state(), SRD_CONTENT, CASTER, 'night-hag'), 'the hag').events);
  log.push(...unwrap(declareCreatureSide(state(), IMP, 'monsters'), 'a side'));
  log.push(...unwrap(declareCreatureSide(state(), CASTER, 'party'), 'the other'));
  log.push(...unwrap(setScene(state(), { width: 200, depth: 200, height: 40 }), 'the scene'));
  log.push(...unwrap(addSceneLandmark(state(), 'the pillar', { x: 20, y: 20, z: 0 }), 'a pillar'));
  log.push(
    { type: 'creature-placed', id: CASTER, placement: { from: { landmark: 'the pillar' }, feet: 0 } },
    {
      type: 'creature-placed',
      id: IMP,
      placement: { from: { creature: CASTER }, feet: 20, bearing: 0 },
    },
    { type: 'sight-declared', from: CASTER, to: IMP, seen: true },
  );
  return log;
}

const at = (log: readonly GameEvent[]): GameState => fold(SEED, log);

const supply = (state: GameState) => ({
  issuer: createRollIssuer('r', state.rollsIssued),
  rng: state.rng === null ? createRng(SEED) : restoreRng(state.rng),
  content: SRD_CONTENT,
});

/** Every mode source on the save this batch recorded for the imp. */
const modesOn = (events: readonly GameEvent[], who: string): readonly string[] =>
  events
    .filter((event) => event.type === 'roll-recorded' && (event as { who: string }).who === who)
    .flatMap((event) =>
      ((event as { modes?: readonly { source: string; mode: string }[] }).modes ?? []).map(
        (one) => `${one.source}:${one.mode}`,
      ),
    );

/** A fight in which the hag acts first, so one advance ends its turn. */
const fight = (log: readonly GameEvent[]): GameEvent[] => [
  ...log,
  {
    type: 'combat-started',
    combatants: [
      { id: CASTER, initiative: 20, speed: 30 },
      { id: IMP, initiative: 10, speed: 20 },
    ],
  },
];

/**
 * A supply whose flat bonus decides the save, so every assertion below is
 * about a rule rather than about a seed — `item-repeat-save.test.ts`'s move.
 */
const bent = (state: GameState, flat: number) => ({ ...supply(state), bonuses: [{ source: 'the test insists', flat }] });

/**
 * A casting the imp failed, which leaves it a save to repeat at every turn
 * boundary.
 *
 * SRD Blindness/Deafness, because it is the shortest spell in the catalogue
 * whose `save` effect prints "at the end of each of its turns, the target
 * repeats the save" and whose target may be anything — the hag's own Phantasmal
 * Killer prints the repeat and the definition does not model one. The caster is
 * given the spell and the slot by hand for the same reason: what is under test
 * is the imp's repeat, not whose spell it was.
 */
function heldByASpell(): readonly GameEvent[] {
  const log = fight(casting(['blindness-deafness'], 2));
  const cast = unwrap(
    resolveSpell(
      at(log),
      CASTER,
      { spellId: 'blindness-deafness', targets: [IMP], slotLevel: 2, choice: 'blinded' },
      bent(at(log), -40),
    ),
    'blindness',
  );
  return [...log, ...cast.events];
}

/** The same debt, hung on something nobody cast. */
function heldByAFever(): readonly GameEvent[] {
  const log = fight(field());
  const applied = unwrap(
    applyConditionTo(at(log), IMP, 'frightened', 'the swamp fever', [], undefined, {
      at: 'end-of-turn',
      of: IMP,
      ability: 'wis',
      dc: 13,
      onSuccess: 'end-on-target',
      label: 'Wisdom save vs the swamp fever',
    }),
    'the fever',
  );
  return [...log, ...applied];
}

/**
 * The imp's own repeat save, rolled at the end of its turn.
 *
 * Two advances: the first ends the hag's turn, the second ends the imp's,
 * which is the boundary the sentence names.
 */
function boundarySave(log: readonly GameEvent[]): GameEvent | undefined {
  let events: readonly GameEvent[] = log;
  let rolled: GameEvent | undefined;
  for (let turns = 0; turns < 2; turns += 1) {
    const turn = unwrap(resolveTurn(at(events), bent(at(events), -40)), 'the boundary');
    events = [...events, ...turn.events];
    rolled =
      turn.events.find(
        (event) =>
          event.type === 'roll-recorded' && (event as { who: string }).who === String(IMP),
      ) ?? rolled;
  }
  return rolled;
}

/** The mode sources on one recorded roll. */
const modesIn = (event: GameEvent): readonly string[] =>
  ((event as { modes?: readonly { source: string; mode: string }[] }).modes ?? []).map(
    (one) => `${one.source}:${one.mode}`,
  );

/**
 * The hag with a stated list and slots of its own.
 *
 * Declared by hand because the two rules below are about the *imp's* save and
 * the night hag's printed list does not happen to hold a spell that raises
 * either one. Everything else is the engine's.
 */
const casting = (prepared: readonly string[], level: number): readonly GameEvent[] => [
  ...field(),
  {
    type: 'resource-pool-declared',
    id: CASTER,
    pool: { key: spellSlotKey(level), label: `level ${level}`, max: 2, recovers: 'long-rest' },
  },
  {
    type: 'spellcasting-declared',
    id: CASTER,
    spellcasting: declaredCasting({ ability: 'wis', prepared, classId: 'cleric' }),
  },
];

/** The hag under a Sanctuary of its own, so the imp meets a ward a spell hung. */
function warded(): readonly GameEvent[] {
  const log = casting(['sanctuary'], 1);
  const cast = unwrap(
    resolveSpell(
      at(log),
      CASTER,
      { spellId: 'sanctuary', targets: [CASTER], slotLevel: 1 },
      supply(at(log)),
    ),
    'sanctuary',
  );
  return [...log, ...cast.events];
}

describe('the trait the adapter compiles', () => {
  it('narrows the imp’s Advantage to saves against magic', () => {
    const imp = adaptMonster(SRD_CONTENT.monsterById('imp')!, IMP);
    expect(imp.sheet.standing).toContainEqual({
      feature: 'imp:magic-resistance',
      name: 'Magic Resistance',
      reach: { kind: 'self' },
      grant: {
        kind: 'roll-mode',
        modifier: {
          mode: 'advantage',
          selector: { roll: 'saving-throw', relation: 'roller', againstMagic: true },
        },
      },
    });
  });

  /** And a block that prints no such sentence gains nothing at all. */
  it('leaves a block without the sentence alone', () => {
    const satyr = adaptMonster(SRD_CONTENT.monsterById('satyr')!, IMP);
    expect(
      (satyr.sheet.standing ?? []).some((effect) => effect.name === 'Magic Resistance'),
    ).toBe(true);
    const goblin = adaptMonster(SRD_CONTENT.monsterById('goblin-warrior')!, IMP);
    expect(
      (goblin.sheet.standing ?? []).some((effect) => effect.name === 'Magic Resistance'),
    ).toBe(false);
  });
});

describe('what the narrowing reaches, and what it does not', () => {
  it('gives the imp Advantage on a spell’s own saving throw', () => {
    const log = field();
    const out = unwrap(
      resolveSpell(
        at(log),
        CASTER,
        { spellId: 'phantasmal-killer', targets: [IMP] },
        supply(at(log)),
      ),
      'phantasmal killer',
    );
    expect(modesOn(out.events, String(IMP))).toContain('Magic Resistance:advantage');
  });

  /**
   * The query, asked directly of the state, is the honest way to prove both
   * halves at once: the same imp, the same family, the same ability, and the
   * one fact that differs is whether a spell forced the save.
   */
  it('applies to a save a spell forced and to no other', () => {
    const state = at(field());
    const magical = rollModesFor(state, {
      family: 'saving-throw',
      roller: IMP,
      ability: 'wis',
      magical: true,
    });
    expect(magical.modes.map((one) => one.source)).toContain('Magic Resistance');

    const mundane = rollModesFor(state, {
      family: 'saving-throw',
      roller: IMP,
      ability: 'wis',
    });
    expect(mundane.modes.map((one) => one.source)).not.toContain('Magic Resistance');

    // And it is a saving throw's rule and not a creature's: the same imp
    // making an attack roll or an ability check gets nothing.
    for (const family of ['attack', 'ability-check'] as const) {
      const other = rollModesFor(state, { family, roller: IMP, magical: true });
      expect(other.modes.map((one) => one.source)).not.toContain('Magic Resistance');
    }
  });

  /**
   * SRD Satyr's Mockery forces a Wisdom save and is not a spell, so the imp
   * rolls it as anybody would. The claim is about `forcePrintedSave` — which
   * answers nothing about magic and therefore says no — rather than about this
   * particular line.
   */
  it('does not reach a printed stat-block line’s saving throw', () => {
    const base = field();
    const withSatyr = [
      ...base,
      ...unwrap(addCreature(at(base), SRD_CONTENT, id('pan'), 'satyr'), 'the satyr').events,
    ];
    const log: GameEvent[] = [
      ...withSatyr,
      ...unwrap(declareCreatureSide(at(withSatyr), id('pan'), 'monsters'), 'its side'),
      {
        type: 'creature-placed',
        id: id('pan'),
        placement: { from: { creature: CASTER }, feet: 15, bearing: 90 },
      },
      { type: 'sight-declared', from: id('pan'), to: IMP, seen: true },
      {
        type: 'combat-started',
        combatants: [
          { id: id('pan'), initiative: 20, speed: 30 },
          { id: IMP, initiative: 10, speed: 20 },
          { id: CASTER, initiative: 5, speed: 30 },
        ],
      },
    ];
    const state = at(log);
    const out = unwrap(
      forcePrintedSave(state, id('pan'), { line: 'Mockery', targets: [IMP] }, supply(state)),
      'the mockery',
    );
    expect(modesOn(out.events, String(IMP)).join(' ')).not.toContain('Magic Resistance');
    // The save really was rolled: what is asserted is the absence of the
    // Advantage and not the absence of the roll.
    expect(
      out.events.some(
        (event) => event.type === 'roll-recorded' && (event as { who: string }).who === String(IMP),
      ),
    ).toBe(true);
  });
});

describe('the repeat a turn boundary raises', () => {
  /**
   * SRD Hideous Laughter and its kind end on a save the target repeats, and
   * that repeat is still "a saving throw against a spell". The boundary cannot
   * be *told* which it is — a repeat is owed for anything the rules hang a
   * clock on — so it asks the debt's own `source` whether a casting made it,
   * through `castingIdOf`, which reads the engine's source format rather than
   * branching on a name.
   *
   * Asserted on a debt the engine really owes, so the two halves of that
   * question are the ones `resolvePendingSaves` actually asks.
   */
  it('carries the Advantage into the repeat a casting’s effect raises', () => {
    const repeat = boundarySave(heldByASpell());
    expect(repeat).toBeDefined();
    expect(modesIn(repeat!)).toContain('Magic Resistance:advantage');
  });

  /**
   * And the other half, which is why the boundary asks at all rather than
   * saying yes: SRD writes "repeats the save at the end of each of its turns"
   * on plenty of things nobody cast — a poison in a bottle, a disease the
   * table declared — and `castingIdOf` answers null for every one of them.
   */
  it('carries none into a repeat nothing cast raised', () => {
    const repeat = boundarySave(heldByAFever());
    expect(repeat).toBeDefined();
    expect(modesIn(repeat!)).not.toContain('Magic Resistance:advantage');
  });
});

describe('the save a ward asks of whoever targets it', () => {
  /**
   * SRD Sanctuary: "any creature who targets the warded creature with an
   * attack roll … must succeed on a Wisdom saving throw." That is a save
   * against a spell, so Magic Resistance reaches it — and `wardAgainst` knows
   * because the ward's own `source` is the casting that hung it.
   */
  it('gives the imp Advantage on a ward a spell hung', () => {
    const log = warded();
    const state = at(log);
    const out = unwrap(wardAgainst(state, IMP, CASTER, supply(state)), 'the ward');
    expect(modesOn(out.events, String(IMP))).toContain('Magic Resistance:advantage');
  });
});

describe('a homebrew feature saying the same thing', () => {
  /**
   * The axis is the engine's, not the bestiary's: a feature written in the
   * same vocabulary behaves identically, which is what keeps this a rule
   * rather than a stat-block special case.
   */
  it('behaves exactly as the printed sentence does', () => {
    const log = field();
    const state = fold(SEED, [
      ...log,
      {
        type: 'creature-added',
        id: id('warded'),
        name: 'Warded One',
        maxHp: 10,
        creatureType: 'Humanoid',
        sheet: {
          level: 1,
          abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
          skills: {},
          saveProficiencies: [],
          armor: null,
          shield: null,
          armorTraining: { light: true, medium: true, heavy: false, shields: true },
          baseSpeed: 30,
          spellcastingAbility: null,
          standing: [
            {
              feature: 'homebrew:warded',
              name: 'Warded',
              reach: { kind: 'self' },
              grant: {
                kind: 'roll-mode',
                modifier: {
                  mode: 'advantage',
                  selector: { roll: 'saving-throw', relation: 'roller', againstMagic: true },
                },
              },
            },
          ],
          stated: { armorClass: 10, proficiencyBonus: 2, initiative: 0 },
        },
      },
    ]);

    const magical = rollModesFor(state, {
      family: 'saving-throw',
      roller: id('warded'),
      ability: 'dex',
      magical: true,
    });
    expect(magical.modes.map((one) => one.source)).toContain('Warded');

    const mundane = rollModesFor(state, {
      family: 'saving-throw',
      roller: id('warded'),
      ability: 'dex',
    });
    expect(mundane.modes.map((one) => one.source)).not.toContain('Warded');
  });
});

describe('the validator', () => {
  const problems = (selector: Parameters<typeof rollSelectorProblems>[0]) =>
    rollSelectorProblems(selector, (skill) => SKILL_ABILITY[skill]).map((one) => one.code);

  it('accepts the narrowing on a saving throw', () => {
    expect(
      problems({ roll: 'saving-throw', relation: 'roller', againstMagic: true }),
    ).toEqual([]);
  });

  it('refuses it on an attack roll, a check, Initiative and a death save', () => {
    for (const roll of ['attack', 'ability-check', 'initiative', 'death-save'] as const) {
      expect(problems({ roll, relation: 'roller', againstMagic: true })).toContain(
        'against_magic_off_a_saving_throw',
      );
    }
  });
});
