/**
 * How `fixtures/golden-log.json` was built. **Not a step in the build.**
 *
 * The fixture's whole value is that nothing regenerates it: it is a log
 * written by the engine as it stood on the day, and every later version has to
 * keep folding it or say out loud why not. Re-running this to make
 * `persistence.test.ts` pass turns a compatibility test into a rubber stamp.
 *
 * This file is here so the log is readable rather than magic — and so that
 * when the vocabulary grows enough to want a *second* fixture, there is an
 * obvious way to write one.
 */
import { writeFileSync } from 'node:fs';
import { SRD_CONTENT } from '@ie/content';
import { pathToFileURL } from 'node:url';
import { asCharacterId, expect as unwrap, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from '../src/character.js';
import { createRng } from '../src/dice.js';
import { createRollIssuer } from '../src/rolls.js';
import { fold, type GameEvent } from '../src/events.js';
import { spellSlotKey } from '../src/resources.js';
import { declaredCasting } from '../src/spellcasting.js';
// Not a command: the low-level half beneath `resolveSpell`, a module export
// rather than a barrel name — see `commands.ts`'s own note. An import path
// only; this generator's output is unchanged and the log stays frozen.
import { resolveCast } from '../src/commands/casting.js';
import {
  damageCreature,
  declineOpportunity,
  equipItem,
  purchaseItem,
  resolveAttack,
  resolveMove,
  resolveSpell,
  resolveTurn,
  takeDodge,
  takeReady,
  releaseReady,
} from '../src/commands.js';

const id = (s: string) => asCharacterId(s);
const CLERIC = id('cleric');
const THUG = id('thug');
const RAT = id('rat');

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 5,
  abilities: { str: 14, dex: 12, con: 14, int: 10, wis: 16, cha: 10 },
  skills: {},
  saveProficiencies: ['wis'],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'wis',
  weaponProficiencies: ['simple', 'martial'],
  ...over,
});

const added = (who: CharacterId, side: string, maxHp: number): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(),
  maxHp,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side,
});

let log: GameEvent[] = [
  added(CLERIC, 'party', 40),
  added(THUG, 'thugs', 32),
  added(RAT, 'thugs', 7),
  {
    type: 'items-gained',
    id: CLERIC,
    items: [
      { id: 'mace', quantity: 1 },
      { id: 'chain-shirt', quantity: 1 },
    ],
    source: 'kit',
  },
  { type: 'coins-changed', id: CLERIC, copper: 50_000, source: 'a patron' },
  {
    type: 'resource-pool-declared',
    id: CLERIC,
    pool: { key: spellSlotKey(1), label: 'level 1 spell slot', max: 4, recovers: 'long-rest' },
  },
  {
    type: 'resource-pool-declared',
    id: CLERIC,
    pool: { key: spellSlotKey(2), label: 'level 2 spell slot', max: 3, recovers: 'long-rest' },
  },
  {
    type: 'spellcasting-declared',
    id: CLERIC,
    spellcasting: declaredCasting({
      ability: 'wis',
      cantrips: ['sacred-flame'],
      prepared: ['inflict-wounds', 'hold-person'],
    }),
  },
  { type: 'scene-set', extent: { width: 300, depth: 300, height: 40 } },
  { type: 'landmark-added', name: 'the altar', at: { x: 100, y: 100, z: 0 } },
  { type: 'creature-placed', id: CLERIC, placement: { from: { landmark: 'the altar' }, feet: 0 } },
  { type: 'creature-placed', id: THUG, placement: { from: { creature: CLERIC }, feet: 5, bearing: 0 } },
  { type: 'creature-placed', id: RAT, placement: { from: { creature: CLERIC }, feet: 5, bearing: 90 } },
  { type: 'sight-declared', from: CLERIC, to: THUG, seen: true },
  { type: 'sight-declared', from: THUG, to: CLERIC, seen: true },
  { type: 'sight-declared', from: CLERIC, to: RAT, seen: true },
  { type: 'cover-declared', from: CLERIC, to: RAT, degree: 'half' },
  { type: 'creature-type-declared', id: THUG, creatureType: 'Humanoid' },
  { type: 'time-advanced', seconds: 600, reason: 'searching the vestry' },
];

const dice = () => ({ issuer: createRollIssuer('g'), rng: createRng('golden'), content: SRD_CONTENT });

const push = (events: readonly GameEvent[]) => {
  log = [...log, ...events];
};

// Shopping and dressing, before anybody draws anything.
push(unwrap(purchaseItem(fold('golden', log), SRD_CONTENT, CLERIC, 'rope', 2, 'buy-rope'), 'buy'));
push(unwrap(equipItem(fold('golden', log), SRD_CONTENT, CLERIC, 'chain-shirt', 'wear'), 'equip'));

push([
  {
    type: 'combat-started',
    combatants: [
      { id: CLERIC, initiative: 18, speed: 30 },
      { id: THUG, initiative: 12, speed: 30 },
      { id: RAT, initiative: 4, speed: 20 },
    ],
  },
]);

// Round one: the cleric holds the thug.
const held = unwrap(
  resolveSpell(
    fold('golden', log),
    CLERIC,
    { spellId: 'hold-person', targets: [THUG], slotLevel: 2, commandId: 'hold-1' },
    { ...dice(), bonuses: [{ source: 'staged', flat: -40 }] },
  ),
  'hold person',
);
push(held.events);
push(unwrap(resolveTurn(fold('golden', log), dice(), { commandId: 'turn-1' }), 't1').events);

// The thug is paralysed; the rat's turn comes round and it bites.
push(unwrap(resolveTurn(fold('golden', log), dice(), { commandId: 'turn-2' }), 't2').events);
const bite = unwrap(
  resolveAttack(fold('golden', log), RAT, { target: CLERIC, weapon: null, commandId: 'bite-1' }, dice()),
  'bite',
);
push(bite.events);
push(unwrap(resolveTurn(fold('golden', log), dice(), { commandId: 'turn-3' }), 't3').events);

// Round two: the cleric readies a spell, then moves, then releases it.
push(
  unwrap(
    takeReady(fold('golden', log), CLERIC, {
      trigger: 'if the rat comes off the rafters',
      response: { kind: 'spell', spellId: 'inflict-wounds', slotLevel: 1 },
      commandId: 'ready-1',
    }, SRD_CONTENT),
    'ready',
  ),
);
push(unwrap(resolveTurn(fold('golden', log), dice(), { commandId: 'turn-4' }), 't4').events);
const released = unwrap(
  releaseReady(fold('golden', log), CLERIC, { targets: [RAT], commandId: 'release-1' }, dice()),
  'release',
);
push(released.events);

// Someone takes a hit from off-screen, and somebody Dodges.
push(
  unwrap(
    damageCreature(fold('golden', log), CLERIC, {
      amount: 9,
      source: 'a falling censer',
      commandId: 'censer',
    }),
    'censer',
  ),
);
push(unwrap(resolveTurn(fold('golden', log), dice(), { commandId: 'turn-5' }), 't5').events);
push(unwrap(resolveTurn(fold('golden', log), dice(), { commandId: 'turn-6' }), 't6').events);
push(unwrap(takeDodge(fold('golden', log), CLERIC, { commandId: 'dodge-1' }), 'dodge'));

const moved = unwrap(
  resolveMove(
    fold('golden', log),
    CLERIC,
    { placement: { from: { landmark: 'the altar' }, feet: 15, bearing: 180 }, commandId: 'move-1' },
    dice(),
  ),
  'move',
);
push(moved.events);

// The move provoked; the reactors answer, which is the shape a real log has.
for (const p of fold('golden', log).pendingMove?.provoked ?? []) {
  push(unwrap(declineOpportunity(fold('golden', log), p.reactor, { commandId: `decline-${p.reactor}` }), 'decline'));
}

// A cantrip, then a levelled cast out of a pool, to exercise both routes.
push(unwrap(resolveTurn(fold('golden', log), dice(), { commandId: 'turn-7' }), 't7').events);
push(unwrap(resolveTurn(fold('golden', log), dice(), { commandId: 'turn-8' }), 't8').events);
push(unwrap(resolveTurn(fold('golden', log), dice(), { commandId: 'turn-9' }), 't9').events);
push(
  unwrap(
    resolveCast(fold('golden', log), CLERIC, {
      spell: 'Sacred Flame',
      level: 0,
      slotless: 'cantrip',
      commandId: 'flame-1',
    }),
    'cantrip',
  ),
);

// — saved mid-fight, which is the only interesting moment to save at ————
//
// A log that ends after everything has worn off folds to an empty derived
// state, and an empty derived state is the same under every expiry rule there
// has ever been. So the fixture stops while things are still running: a
// Concentration with a casting timer under it, a paralysis repeating its save
// at every turn boundary, and a Dodge on a turn-anchored deadline.
push(unwrap(resolveTurn(fold('golden', log), dice(), { commandId: 'turn-10' }), 't10').events);
push(unwrap(resolveTurn(fold('golden', log), dice(), { commandId: 'turn-11' }), 't11').events);
push(unwrap(resolveTurn(fold('golden', log), dice(), { commandId: 'turn-12' }), 't12').events);

const holdAgain = unwrap(
  resolveSpell(
    fold('golden', log),
    CLERIC,
    { spellId: 'hold-person', targets: [THUG], slotLevel: 2, commandId: 'hold-2' },
    { ...dice(), bonuses: [{ source: 'staged', flat: -40 }] },
  ),
  'hold person again',
);
push(holdAgain.events);

// The thug's own turn comes round and it fails the repeat save, so the
// paralysis is still standing when the campaign is put away.
push(
  unwrap(
    resolveTurn(
      fold('golden', log),
      { ...dice(), bonuses: [{ source: 'staged', flat: -40 }] },
      { commandId: 'turn-13' },
    ),
    't13',
  ).events,
);
push(
  unwrap(
    resolveTurn(
      fold('golden', log),
      { ...dice(), bonuses: [{ source: 'staged', flat: -40 }] },
      { commandId: 'turn-14' },
    ),
    't14',
  ).events,
);

// And the rat hunkers down, which is a benefit with a turn-anchored deadline.
push(unwrap(takeDodge(fold('golden', log), RAT, { commandId: 'dodge-rat' }), 'rat dodge'));

/** True when Node was asked to run this file, rather than something importing it. */
const isMainModule = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;

if (isMainModule) {
  const state = fold('golden', log);
  writeFileSync(
    process.argv[2] ?? 'golden-log.json',
    `${JSON.stringify(log, null, 2)}\n`,
    'utf8',
  );

  console.log(
    JSON.stringify(
      {
        events: log.length,
        types: [...new Set(log.map((e) => e.type))].sort().length,
        elapsed: state.elapsed,
        round: state.combat?.round,
        clericHp: state.creatures.cleric?.vitals.hp,
        thugConditions: state.creatures.thug?.conditions.conditions,
        ratHp: state.creatures.rat?.vitals.hp,
        slots1: state.creatures.cleric?.resources,
        castings: state.castingsBegun,
        commands: Object.keys(state.appliedCommands).length,
        timers: Object.keys(state.timers).length,
        pendingSaves: Object.keys(state.pendingSaves).length,
        activeFeatures: state.creatures.rat?.activeFeatures,
        concentration: state.creatures.cleric?.concentration?.spell ?? null,
      },
      null,
      2,
    ),
  );
}
