/**
 * A light a **use** turns on, and which the next use turns off.
 *
 * SRD Magmin, Ignited Illumination, under Bonus Actions: "The magmin sets itself
 * ablaze or extinguishes its flames. While ablaze, the magmin sheds Bright Light
 * in a 10-foot radius and Dim Light for an additional 10 feet."
 *
 * **Nothing about light is new here**, which is the point of the design rather
 * than a modest claim. The six Illumination traits glow always and `carriedLight`
 * derives a patch for them off the sheet; SRD Sacred Weapon's glow is a `light`
 * standing grant gated on the feature running, and `activatedLight` reads that.
 * A toggle is the second shape and not a third mechanism: the adapter compiles
 * Ignited Illumination's two radii into exactly that grant, gated on this very
 * line, and the spender flips `activeFeatures`.
 *
 * So there is no patch in state, nothing to sweep, and no event about light at
 * all — `lightAt` derives the patch from the sheet on every read, which is what
 * `docs/design/light-and-sight.md` says a carried light is.
 *
 * **One line and both directions**, because the book prints one sentence for
 * both: the direction is read off the world rather than stated, so a magmin that
 * is ablaze puts itself out and one that is not lights up.
 */

import { SRD_CONTENT } from '@ie/content';
import { describe, expect, it } from 'vitest';
import { asCharacterId, type Result } from '@ie/shared';
import {
  addCreature,
  addSceneLandmark,
  beginCombat,
  declareCreatureSide,
  placeCreatureInScene,
  setScene,
  takeStatedBonusAction,
} from './commands.js';
import { applyEvent, fold, type GameEvent, type GameState } from './events.js';
import { adaptMonster, statedBonusActionOf } from './monster.js';
import { lightAt } from './positioning.js';

const id = (s: string) => asCharacterId(s);
const MAGMIN = id('magmin');

/** The block's own heading, read off the block rather than retyped. */
const LINE = SRD_CONTENT.monsterById('magmin')!.bonusActions.find((l) =>
  l.name.startsWith('Ignited'),
)!.name;

const unwrap = <T>(result: Result<T>, label = 'ok'): T => {
  if (!result.ok) throw new Error(`${label}: ${result.code} — ${result.reason}`);
  return result.value;
};

const after = (state: GameState, events: readonly GameEvent[]): GameState =>
  events.reduce((s, e) => applyEvent(s, e), state);

/** A magmin in a room nobody has lit, on its own turn. */
function inTheForge(): GameState {
  let state = fold('forge', []);
  const step = (result: Result<readonly GameEvent[]>, label: string): void => {
    state = after(state, unwrap(result, label));
  };
  state = after(state, unwrap(addCreature(state, SRD_CONTENT, MAGMIN, 'magmin'), 'magmin').events);
  step(setScene(state, { width: 120, depth: 80, height: 40 }), 'scene');
  step(addSceneLandmark(state, 'the anvil', { x: 40, y: 40, z: 0 }), 'landmark');
  step(placeCreatureInScene(state, MAGMIN, { from: { landmark: 'the anvil' }, feet: 0 }), 'place');
  step(declareCreatureSide(state, MAGMIN, 'monsters'), 'side');
  step(beginCombat(state, [{ id: MAGMIN, initiative: 20, speed: 30 }]), 'combat');
  return state;
}

/** How bright it is a stated number of feet east of the magmin. */
const brightness = (state: GameState, feet: number) =>
  lightAt(state, { x: 40 + feet, y: 40, z: 0 }).level;

describe('the line as the parser reads it', () => {
  it('reads the two radii and nothing else', () => {
    const line = SRD_CONTENT.monsterById('magmin')!.bonusActions.find((l) => l.name === LINE)!;
    expect(line.togglesLight).toEqual({ brightRadiusFeet: 10, dimBeyondFeet: 10 });
  });

  it('compiles a light grant gated on the line itself', () => {
    const magmin = adaptMonster(SRD_CONTENT.monsterById('magmin')!, MAGMIN);
    const glow = (magmin.sheet.standing ?? []).find((effect) => effect.grant.kind === 'light');
    expect(glow).toMatchObject({
      name: LINE,
      reach: { kind: 'self' },
      grant: { kind: 'light', level: 'bright', radius: 10, dimBeyond: 10 },
      requires: [{ kind: 'feature-active', feature: glow!.feature }],
    });
    // And the line is still a line somebody spends, which is what carries the
    // toggle: nothing here is a second door.
    expect(statedBonusActionOf(magmin.sheet, LINE)?.togglesLight).toEqual({
      brightRadiusFeet: 10,
      dimBeyondFeet: 10,
    });
  });
});

describe('the magmin sets itself ablaze', () => {
  it('sheds Bright Light ten feet and Dim Light ten beyond, and nothing before the use', () => {
    const dark = inTheForge();
    // Nobody has lit the room and the magmin is not ablaze: the space beside it
    // is undeclared rather than dark, which is the owner's second ruling.
    expect(brightness(dark, 5)).toBeNull();

    const lit = after(
      dark,
      unwrap(takeStatedBonusAction(dark, MAGMIN, { line: LINE, commandId: 'ablaze' }), 'ablaze')
        .events,
    );
    expect(brightness(lit, 5)).toBe('bright');
    expect(brightness(lit, 10)).toBe('bright');
    expect(brightness(lit, 15)).toBe('dim');
    expect(brightness(lit, 20)).toBe('dim');
    expect(brightness(lit, 25)).toBeNull();
    // No patch was written: the light is derived off the sheet on every read.
    expect(lit.scene!.light).toEqual({});
  });

  it('puts the flames out when the line is taken again', () => {
    let state = inTheForge();
    const ablaze = unwrap(
      takeStatedBonusAction(state, MAGMIN, { line: LINE, commandId: 'on' }),
      'ablaze',
    );
    expect(ablaze.unverified.join(' ')).toContain('ablaze');
    state = after(state, ablaze.events);
    // Round the order back to the magmin so the Bonus Action is there again.
    state = after(state, [{ type: 'turn-advanced' }]);
    expect(brightness(state, 5)).toBe('bright');

    const out = unwrap(
      takeStatedBonusAction(state, MAGMIN, { line: LINE, commandId: 'off' }),
      'extinguish',
    );
    expect(out.unverified.join(' ')).toContain('out');
    const dark = after(state, out.events);
    expect(brightness(dark, 5)).toBeNull();
    expect(dark.creatures[MAGMIN]!.activeFeatures).toEqual([]);
  });
});
