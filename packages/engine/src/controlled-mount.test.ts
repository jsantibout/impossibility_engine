import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap, isErr, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { declaredCasting } from './spellcasting.js';
import { actionRulesOn } from './standing.js';
import { mountCreature, resolveAttack, resolveSpell, takeDodge } from './commands.js';

/**
 * SRD Find Steed's steed under its rider.
 *
 * > "In combat, it shares your Initiative count, and it functions as a
 * > controlled mount while you ride it (as defined in the rules on mounted
 * > combat). If you have the Incapacitated condition, the steed takes its turn
 * > immediately after yours and acts independently, focusing on protecting
 * > you."
 * > SRD Mounted Combat, *Controlling a Mount*: "It moves as you direct it, and
 * > it has only three action options: Dash, Disengage, and Dodge."
 *
 * **A narrowing of a turn somebody else directs, derived and written nowhere.**
 * The bond pins the sentence (`KeptBond.controlledMount`); while the summoner
 * sits on the steed and is not Incapacitated, `actionRulesOn` reads the steed
 * as holding a `permits-only` rule on its Action — Dash, Disengage, Dodge —
 * which every spender already refuses against. Nobody hangs it and nobody
 * lifts it: the summoner climbing down, or falling Incapacitated, is the end
 * of it, because it was only ever a reading of where the summoner sits.
 */

const id = (s: string): CharacterId => asCharacterId(s);
const PAL = id('paladin');
const FOE = id('foe');
const SQUIRE = id('squire');

const sheet = (): CharacterSheet => ({
  level: 5,
  abilities: { str: 16, dex: 10, con: 14, int: 8, wis: 10, cha: 16 },
  skills: {},
  saveProficiencies: ['wis', 'cha'],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'cha',
  weaponProficiencies: ['simple', 'martial'],
});

const added = (who: CharacterId, side: string): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(),
  maxHp: 44,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side,
});

const SETUP: readonly GameEvent[] = [
  added(PAL, 'party'),
  added(SQUIRE, 'party'),
  added(FOE, 'foes'),
  {
    type: 'spellcasting-declared',
    id: PAL,
    spellcasting: declaredCasting({ ability: 'cha', prepared: ['find-steed'] }),
  },
  {
    type: 'resource-pool-declared',
    id: PAL,
    pool: { key: 'spell-slot:2', label: 'level 2', max: 4, recovers: 'long-rest' },
  },
  { type: 'scene-set', extent: { width: 600, depth: 600, height: 40 } },
  { type: 'landmark-added', name: 'the road', at: { x: 200, y: 200, z: 0 } },
  { type: 'creature-placed', id: PAL, placement: { from: { landmark: 'the road' }, feet: 0 } },
  { type: 'creature-placed', id: SQUIRE, placement: { from: { creature: PAL }, feet: 5, bearing: 180 } },
  { type: 'creature-placed', id: FOE, placement: { from: { creature: PAL }, feet: 5, bearing: 0 } },
];

const supply = (seed = 'steed') => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

/** The steed called, and then the fight begun with the steed's turn first. */
const called = (): { readonly log: GameEvent[]; readonly steed: CharacterId } => {
  const log: GameEvent[] = [...SETUP];
  const out = unwrap(
    resolveSpell(fold('seed', log), PAL, { spellId: 'find-steed', targets: [PAL], choice: 'Celestial', slotLevel: 2 }, supply()),
    'Find Steed',
  );
  log.push(...out.events);
  const steed = Object.keys(fold('seed', log).creatures).find((key) => ![PAL, FOE, SQUIRE].includes(key as CharacterId)) as CharacterId;
  log.push({ type: 'creature-placed', id: steed, placement: { from: { creature: PAL }, feet: 5, bearing: 90, size: 'large' } });
  return { log, steed };
};

const fight = (log: readonly GameEvent[], steed: CharacterId): GameEvent[] => [
  ...log,
  {
    type: 'combat-started',
    combatants: [
      { id: steed, initiative: 20, speed: 60 },
      { id: PAL, initiative: 15, speed: 30 },
      { id: SQUIRE, initiative: 12, speed: 30 },
      { id: FOE, initiative: 10, speed: 30 },
    ],
  },
];

const mounted = (log: readonly GameEvent[], rider: CharacterId, steed: CharacterId): GameEvent[] => [
  ...log,
  ...unwrap(mountCreature(fold('seed', log), rider, steed, { willing: true }), `${rider} mounts`),
];

const permitsOnly = (state: GameState, who: CharacterId) =>
  actionRulesOn(state, who).filter((held) => held.rule.kind === 'permits-only');

describe('SRD Find Steed’s steed as a controlled mount', () => {
  it('pins the sentence on the bond', () => {
    const { log, steed } = called();
    expect(fold('seed', log).creatures[steed]?.summonedBy?.kept?.controlledMount).toBe(true);
  });

  it('may take only the Dash, Disengage or Dodge action while its summoner rides it', () => {
    const { log, steed } = called();
    const state = fold('seed', fight(mounted(log, PAL, steed), steed));
    expect(permitsOnly(state, steed).map((held) => held.rule)).toEqual([
      { kind: 'permits-only', slot: 'action', actions: ['dash', 'disengage', 'dodge'] },
    ]);

    const slam = resolveAttack(state, steed, { target: FOE, weapon: null }, supply('slam'));
    expect(isErr(slam) && slam.code).toBe('action_forbidden');
    expect(isErr(takeDodge(state, steed, {}))).toBe(false);
  });

  it('acts freely while nobody rides it', () => {
    const { log, steed } = called();
    const state = fold('seed', fight(log, steed));
    expect(permitsOnly(state, steed)).toEqual([]);
    expect(isErr(resolveAttack(state, steed, { target: FOE, weapon: null }, supply('slam')))).toBe(false);
  });

  it('is controlled only by its summoner: another rider leaves it acting on its own', () => {
    const { log, steed } = called();
    const state = fold('seed', fight(mounted(log, SQUIRE, steed), steed));
    expect(permitsOnly(state, steed)).toEqual([]);
  });

  it('acts independently while its rider has the Incapacitated condition', () => {
    const { log, steed } = called();
    const state = fold('seed', [
      ...fight(mounted(log, PAL, steed), steed),
      { type: 'condition-applied', id: PAL, condition: 'incapacitated', source: 'a blow to the head' } as GameEvent,
    ]);
    expect(permitsOnly(state, steed)).toEqual([]);
  });
});
