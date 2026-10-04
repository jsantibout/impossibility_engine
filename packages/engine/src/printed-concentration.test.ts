/**
 * **Concentration on something that is not a casting** — M-REFLEX.
 *
 * SRD Will-o'-Wisp, Vanish (Bonus Action): "The wisp and its light have the
 * Invisible condition until the wisp's Concentration ends on this effect, which
 * ends early immediately after the wisp makes an attack roll or uses Consume
 * Life."
 *
 * SRD Darkmantle, Darkness Aura (1/Day, Action): "Magical Darkness fills a
 * 15-foot Emanation originating from the darkmantle. This effect lasts while
 * the darkmantle maintains Concentration on it, up to 10 minutes. Darkvision
 * can't penetrate this area, and no light can illuminate it."
 *
 * The seam `LINE_RESIDUE_SEAMS` named for Vanish: every clause is machinery the
 * engine holds — a condition, a light, a deadline, an ending a deed sets off —
 * and all of it hangs off `CreatureState.concentration`, which only a casting
 * could occupy. A printed line now occupies it as a running feature, so every
 * road that ends a Concentration ends the line's effect, and every road that
 * ends the feature ends the Concentration.
 */

import { SRD_CONTENT } from '@ie/content';
import { describe, expect, it } from 'vitest';
import { asCharacterId, type CharacterId, type Result } from '@ie/shared';
import {
  addCreature,
  addSceneLandmark,
  beginCombat,
  declareCreatureSide,
  endConcentration,
  placeCreatureInScene,
  resolveAttack,
  setScene,
  takeStatedAction,
  takeStatedBonusAction,
} from './commands.js';
import { hasCondition } from './conditions.js';
import { createRng, type Rng } from './dice.js';
import { applyEvent, fold, type GameEvent, type GameState } from './events.js';
import { beginPrintedConcentration } from './commands/actions.js';
import { extendContent } from './content.js';
import { printedLineSource, statedActionOf } from './monster.js';
import { lightAt } from './positioning.js';
import { createRollIssuer } from './rolls.js';
import { canSee } from './standing.js';

const id = (s: string): CharacterId => asCharacterId(s);
const WISP = id('wisp');
const MANTLE = id('mantle');
const GOBLIN = id('goblin');
const LOOKER = id('looker');

const supply = () => ({
  issuer: createRollIssuer('r'),
  rng: createRng('printed-concentration') as Rng,
  content: SRD_CONTENT,
});

const unwrap = <T>(result: Result<T>, label = 'ok'): T => {
  if (!result.ok) throw new Error(`${label}: ${result.code} — ${result.reason}`);
  return result.value;
};

const after = (state: GameState, events: readonly GameEvent[]): GameState =>
  events.reduce((s, e) => applyEvent(s, e), state);

/** A wisp in an unlit room with a goblin five feet east of it, on the wisp's turn. */
function wispAndGoblin(): GameState {
  let state = fold('vanish', []);
  const step = (result: Result<readonly GameEvent[]>, label: string): void => {
    state = after(state, unwrap(result, label));
  };
  state = after(state, unwrap(addCreature(state, SRD_CONTENT, WISP, 'will-o-wisp'), 'wisp').events);
  state = after(state, unwrap(addCreature(state, SRD_CONTENT, GOBLIN, 'goblin-warrior'), 'goblin').events);
  step(setScene(state, { width: 120, depth: 80, height: 40 }), 'scene');
  step(addSceneLandmark(state, 'the marsh', { x: 40, y: 40, z: 0 }), 'landmark');
  step(placeCreatureInScene(state, WISP, { from: { landmark: 'the marsh' }, feet: 0 }), 'wisp');
  step(placeCreatureInScene(state, GOBLIN, { from: { creature: WISP }, feet: 5, bearing: 90 }), 'goblin');
  step(declareCreatureSide(state, WISP, 'monsters'), 'side');
  step(declareCreatureSide(state, GOBLIN, 'party'), 'side');
  step(
    beginCombat(state, [
      { id: WISP, initiative: 20, speed: 0 },
      { id: GOBLIN, initiative: 5, speed: 30 },
    ]),
    'combat',
  );
  return state;
}

const vanished = (state: GameState): GameState =>
  after(
    state,
    unwrap(takeStatedBonusAction(state, WISP, { line: 'Vanish', commandId: 'vanish' }), 'vanish')
      .events,
  );

const invisible = (state: GameState, who: CharacterId): boolean =>
  hasCondition(state.creatures[who]!.conditions, 'invisible');

/** How bright the room is a stated number of feet west of the wisp. */
const lightBeside = (state: GameState, feet: number) =>
  lightAt(state, { x: 40 - feet, y: 40, z: 0 }).level;

describe("the wisp's Vanish", () => {
  it('turns the wisp Invisible, holds its Concentration and puts its light out', () => {
    const before = wispAndGoblin();
    expect(invisible(before, WISP)).toBe(false);
    // SRD Illumination: Bright Light 20 feet and Dim Light 20 beyond.
    expect(lightBeside(before, 10)).toBe('bright');

    const state = vanished(before);
    expect(invisible(state, WISP)).toBe(true);
    expect(state.creatures[WISP]!.concentration).toMatchObject({ spell: 'Vanish' });
    // "The wisp **and its light** have the Invisible condition": a light
    // nobody can see lights nothing.
    expect(lightBeside(state, 10)).toBeNull();
    expect(lightBeside(state, 30)).toBeNull();
  });

  it('ends immediately after the wisp makes an attack roll', () => {
    const state = vanished(wispAndGoblin());
    const swing = unwrap(
      resolveAttack(state, WISP, { target: GOBLIN, weapon: null, action: 'Shock', commandId: 'shock' }, supply()),
      'shock',
    );
    const struck = after(state, swing.events);
    expect(invisible(struck, WISP)).toBe(false);
    expect(struck.creatures[WISP]!.concentration).toBeNull();
    expect(lightBeside(struck, 10)).toBe('bright');
  });

  it('ends immediately after the wisp uses Consume Life', () => {
    const state = vanished(wispAndGoblin());
    const used = after(state, [
      { type: 'stated-bonus-action-taken', id: WISP, line: 'Consume Life', turn: state.combat!.turnsTaken },
    ]);
    expect(invisible(used, WISP)).toBe(false);
    expect(used.creatures[WISP]!.concentration).toBeNull();
  });

  it('does not end on a line the sentence does not name', () => {
    const state = vanished(wispAndGoblin());
    const other = after(state, [
      { type: 'stated-bonus-action-taken', id: WISP, line: 'Vanish', turn: state.combat!.turnsTaken },
    ]);
    expect(invisible(other, WISP)).toBe(true);
  });

  it('ends when the wisp is Incapacitated, as every Concentration does', () => {
    const state = vanished(wispAndGoblin());
    const stunned = after(state, [
      { type: 'condition-applied', id: WISP, condition: 'stunned', source: 'a stun' },
    ]);
    expect(stunned.creatures[WISP]!.concentration).toBeNull();
    expect(invisible(stunned, WISP)).toBe(false);
    expect(stunned.creatures[WISP]!.activeFeatures).toEqual([]);
  });

  it('ends when the wisp lets it go', () => {
    const state = vanished(wispAndGoblin());
    const dropped = after(
      state,
      unwrap(endConcentration(state, WISP, 'voluntary', { commandId: 'let-go' }), 'let go'),
    );
    expect(invisible(dropped, WISP)).toBe(false);
    expect(lightBeside(dropped, 10)).toBe('bright');
  });
});

/**
 * **The save-line shape**, which no SRD line in this slice prints and SRD
 * Harpy's Luring Song does: "The harpy sings a magical melody, which lasts until
 * the harpy's Concentration ends on it … _Failure:_ The target has the Charmed
 * condition until the song ends."
 *
 * The Harpy itself is a follow-up. What is proved here is that the primitive
 * holds it without redesign: a save line carrying a `concentrates` record is
 * compiled with a feature key like any other, `beginPrintedConcentration` puts
 * it under the harpy's Concentration, and a condition the save door hangs on
 * **another** creature under `printedLineSource` — which is where
 * `forcePrintedSave` hangs a failure's conditions — ends when the Concentration
 * does, by any road. The block is the SRD harpy with the one field added, so the
 * shape is the book's line and not an invented one.
 */
describe('a save line held under Concentration', () => {
  const HARPY = id('harpy');
  const harpy = SRD_CONTENT.monsterById('harpy')!;
  const singing = {
    ...harpy,
    id: 'concentrating-harpy',
    actions: harpy.actions.map((line) =>
      line.name === 'Luring Song' ? { ...line, concentrates: {} } : line,
    ),
  };
  const content = unwrap(extendContent(SRD_CONTENT, { monsters: [singing] }), 'content');

  /** The harpy singing, and the goblin charmed by the song's failure clause. */
  const charmed = (): GameState => {
    let state = fold('luring-song', []);
    state = after(state, unwrap(addCreature(state, content, HARPY, 'concentrating-harpy'), 'harpy').events);
    state = after(state, unwrap(addCreature(state, content, GOBLIN, 'goblin-warrior'), 'goblin').events);
    const line = statedActionOf(state.creatures[HARPY]!.sheet, 'Luring Song')!;
    expect(line.save).toBeDefined();
    state = after(state, unwrap(beginPrintedConcentration(state, HARPY, line.name, line.concentrates!), 'sing'));
    return after(state, [
      {
        type: 'condition-applied',
        id: GOBLIN,
        condition: 'charmed',
        source: printedLineSource(HARPY, 'Luring Song'),
        implies: ['incapacitated'],
      },
    ]);
  };

  it('keeps the charm on the target while the harpy concentrates', () => {
    const state = charmed();
    expect(state.creatures[HARPY]!.concentration).toMatchObject({ spell: 'Luring Song', feature: true });
    expect(hasCondition(state.creatures[GOBLIN]!.conditions, 'charmed')).toBe(true);
  });

  it('ends the charm on the target when the Concentration breaks', () => {
    const broken = after(charmed(), [
      { type: 'condition-applied', id: HARPY, condition: 'stunned', source: 'a stun' },
    ]);
    expect(broken.creatures[HARPY]!.concentration).toBeNull();
    expect(hasCondition(broken.creatures[GOBLIN]!.conditions, 'charmed')).toBe(false);
    expect(hasCondition(broken.creatures[GOBLIN]!.conditions, 'incapacitated')).toBe(false);
  });

  it('ends it when the harpy takes up another Concentration', () => {
    const state = charmed();
    const again = after(
      state,
      unwrap(
        beginPrintedConcentration(state, HARPY, 'Luring Song', statedActionOf(state.creatures[HARPY]!.sheet, 'Luring Song')!.concentrates!),
        'sing again',
      ),
    );
    // The new song is running; the old one's charm went with the old song.
    expect(again.creatures[HARPY]!.concentration).toMatchObject({ spell: 'Luring Song' });
    expect(hasCondition(again.creatures[GOBLIN]!.conditions, 'charmed')).toBe(false);
  });
});

/** A darkmantle in a bright room, a goblin beside it and a looker with Darkvision 30 feet off. */
function mantleInTheCave(): GameState {
  let state = fold('darkness-aura', []);
  const step = (result: Result<readonly GameEvent[]>, label: string): void => {
    state = after(state, unwrap(result, label));
  };
  state = after(state, unwrap(addCreature(state, SRD_CONTENT, MANTLE, 'darkmantle'), 'mantle').events);
  state = after(state, unwrap(addCreature(state, SRD_CONTENT, GOBLIN, 'goblin-warrior'), 'goblin').events);
  state = after(state, unwrap(addCreature(state, SRD_CONTENT, LOOKER, 'goblin-warrior'), 'looker').events);
  step(setScene(state, { width: 200, depth: 80, height: 40 }, { light: 'bright' }), 'scene');
  step(addSceneLandmark(state, 'the ceiling', { x: 40, y: 40, z: 0 }), 'landmark');
  step(placeCreatureInScene(state, MANTLE, { from: { landmark: 'the ceiling' }, feet: 0 }), 'mantle');
  step(placeCreatureInScene(state, GOBLIN, { from: { creature: MANTLE }, feet: 5, bearing: 90 }), 'goblin');
  step(placeCreatureInScene(state, LOOKER, { from: { creature: MANTLE }, feet: 30, bearing: 270 }), 'looker');
  step(beginCombat(state, [{ id: MANTLE, initiative: 20, speed: 10 }]), 'combat');
  return state;
}

const aura = (state: GameState, commandId = 'aura') =>
  takeStatedAction(state, MANTLE, { line: 'Darkness Aura (1/Day)', commandId });

const lightAround = (state: GameState, feet: number) =>
  lightAt(state, { x: 40 + feet, y: 40, z: 0 });

describe("the darkmantle's Darkness Aura", () => {
  it('fills fifteen feet around it with magical darkness that a bright room does not light', () => {
    const before = mantleInTheCave();
    expect(lightAround(before, 10).level).toBe('bright');

    const state = after(before, unwrap(aura(before), 'aura').events);
    expect(lightAround(state, 10)).toMatchObject({ level: 'darkness', magical: true });
    expect(lightAround(state, 15).level).toBe('darkness');
    expect(lightAround(state, 25).level).toBe('bright');
    expect(state.creatures[MANTLE]!.concentration).toMatchObject({ spell: 'Darkness Aura (1/Day)' });
  });

  it('admits no light at all — not even a magical one', () => {
    const state = after(mantleInTheCave(), unwrap(aura(mantleInTheCave()), 'aura').events);
    const lit = after(state, [
      {
        type: 'light-declared',
        patch: 'a daylight',
        region: { origin: { creature: MANTLE }, shape: { kind: 'sphere', radius: 60 } },
        level: 'bright',
        magical: { spellLevel: 3, dispelsUpTo: 3 },
      },
    ]);
    expect(lightAround(lit, 10).level).toBe('darkness');
    expect(lightAround(lit, 40).level).toBe('bright');
  });

  it('is not seen into by Darkvision', () => {
    const before = mantleInTheCave();
    expect(canSee(before, LOOKER, GOBLIN)).not.toBe(false);
    const state = after(before, unwrap(aura(before), 'aura').events);
    expect(canSee(state, LOOKER, GOBLIN)).toBe(false);
  });

  it('is spent once a day', () => {
    let state = after(mantleInTheCave(), unwrap(aura(mantleInTheCave()), 'aura').events);
    state = after(state, [{ type: 'turn-advanced' }]);
    const again = aura(state, 'again');
    expect(again.ok).toBe(false);
    expect(again.ok ? null : again.code).toBe('daily_limit_reached');
  });

  it('lasts up to ten minutes and no longer', () => {
    let state = after(mantleInTheCave(), unwrap(aura(mantleInTheCave()), 'aura').events);
    state = after(state, [{ type: 'combat-ended' }]);
    state = after(state, [{ type: 'time-advanced', seconds: 590, reason: 'waiting' }]);
    expect(lightAround(state, 10).level).toBe('darkness');
    state = after(state, [{ type: 'time-advanced', seconds: 20, reason: 'waiting' }]);
    expect(lightAround(state, 10).level).toBe('bright');
    expect(state.creatures[MANTLE]!.concentration).toBeNull();
    expect(state.creatures[MANTLE]!.activeFeatures).toEqual([]);
  });
});
