import { readFileSync } from 'node:fs';
import { asCharacterId } from '@ie/shared';
import { fold, applyEvent, type GameEvent, type GameState } from '../src/events.js';
import type { CharacterSheet } from '../src/character.js';

const golden = JSON.parse(
  readFileSync('packages/engine/fixtures/golden-log.json', 'utf8'),
) as GameEvent[];

const sheet: CharacterSheet = {
  level: 5,
  abilities: { str: 14, dex: 12, con: 14, int: 10, wis: 16, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: null,
};

/** A cast of `n`, then `m` events that are always legal to append. */
function synthetic(n: number, m: number): GameEvent[] {
  const log: GameEvent[] = [];
  for (let i = 0; i < n; i += 1) {
    log.push({
      type: 'creature-added',
      id: asCharacterId(`c${i}`),
      name: `c${i}`,
      sheet,
      maxHp: 1_000_000,
      diesAtZero: false,
      creatureType: 'Humanoid',
      side: i % 2 === 0 ? 'party' : 'foes',
    });
    // Give everyone a condition, so the derived passes have real work.
    log.push({
      type: 'condition-applied',
      id: asCharacterId(`c${i}`),
      condition: 'poisoned',
      source: `a spider ${i}`,
    });
  }
  for (let j = 0; j < m; j += 1) {
    const who = asCharacterId(`c${j % n}`);
    log.push({ type: 'damage-taken', id: who, amount: 1 });
    log.push({ type: 'time-advanced', seconds: 6, reason: 'a round' });
  }
  return log;
}

const time = (label: string, fn: () => unknown) => {
  fn();
  const runs = 5;
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < runs; i += 1) fn();
  const ms = Number(process.hrtime.bigint() - t0) / 1e6 / runs;
  console.log(`${label.padEnd(38)} ${ms.toFixed(1)} ms`);
  return ms;
};

console.log(`golden log: ${golden.length} events\n`);
time('fold golden (93 events, 3 cast)', () => fold('g', golden));

console.log('\n-- log length, cast of 6 --');
for (const m of [500, 2000, 8000]) {
  const log = synthetic(6, m / 2);
  time(`fold ${log.length} events`, () => fold('g', log));
}

console.log('\n-- cast size, 2000 events --');
for (const n of [2, 8, 32, 128]) {
  const log = synthetic(n, 1000);
  time(`fold cast of ${n} (${log.length} events)`, () => fold('g', log));
}

console.log('\n-- the live cost: one command against a long log --');
const long = synthetic(6, 4000);
const settled: GameState = fold('g', long);
time('applyEvent once', () => applyEvent(settled, long[long.length - 1]!));

const T = (globalThis as unknown as { __PASS__?: Record<string, bigint> }).__PASS__;
if (T) {
  console.log('\n-- where the time goes (cast of 128) --');
  const total = Object.values(T).reduce((a, b) => a + b, 0n);
  for (const [k, v] of Object.entries(T).sort()) {
    console.log(`${k.padEnd(30)} ${(Number(v) / 1e6).toFixed(0)} ms  ${((Number(v) / Number(total)) * 100).toFixed(0)}%`);
  }
}
