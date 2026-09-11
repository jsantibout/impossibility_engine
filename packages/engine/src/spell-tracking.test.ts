import { describe, expect, it } from 'vitest';
import { asCharacterId, isErr, expect as unwrap, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent } from './events.js';
import { remaining, spellSlotKey } from './resources.js';
import { declaredCasting } from './spellcasting.js';
import { resolveSpell } from './commands.js';
import { SPELL_DEFINITIONS, definitionFor } from './spell-definitions.js';

/**
 * Spells the engine **tracks** without **executing**.
 *
 * Ninety-one SRD spells do something the engine has no business deciding:
 * Disguise Self changes how you look, Speak with Animals lets you talk to a
 * badger, Detect Magic tells you there is magic nearby. Those are the DM's,
 * and they always will be.
 *
 * But "the effect is the DM's" is not the same as "the engine knows nothing",
 * and that is what refusing the cast outright amounted to. A Wizard who cast
 * Fly spent a level 3 slot, gave up whatever they were concentrating on, used
 * their action, and started a ten-minute clock — every one of which is
 * arithmetic the engine owns, and none of which happened, because the spell
 * had no executable definition and `resolveSpell` refused it.
 *
 * So there are two kinds of definition, and the difference is `effects`:
 *
 * | | |
 * |---|---|
 * | **executed** | the engine resolves what the spell does |
 * | **tracked** | the engine spends the cost and runs the clock; `unmodelled` says what the DM does |
 *
 * A tracked definition is not a stub. It carries the real casting time, the
 * real Concentration, the real duration, the real range and the real target
 * rule, all checked against the book — and it must say what it is leaving to
 * the table, because a definition that quietly did nothing would be worse than
 * the refusal it replaced.
 */

const id = (s: string) => asCharacterId(s);
const WIZARD = id('wizard');
const ALLY = id('ally');
const FOE = id('foe');

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 9,
  abilities: { str: 10, dex: 12, con: 14, int: 18, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'int',
  ...over,
});

const added = (who: CharacterId): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(),
  maxHp: 50,
  diesAtZero: false,
  creatureType: 'Humanoid',
});

const TRACKED = [
  'comprehend-languages',
  'darkvision',
  'detect-magic',
  'disguise-self',
  'fly',
  'jump',
  'light',
  'longstrider',
  'mage-hand',
  'misty-step',
  'prestidigitation',
  'speak-with-animals',
  'spider-climb',
  'water-breathing',
] as const;

const SETUP: readonly GameEvent[] = [
  added(WIZARD),
  added(ALLY),
  added(FOE),
  ...[1, 2, 3, 4].map(
    (level): GameEvent => ({
      type: 'resource-pool-declared',
      id: WIZARD,
      pool: {
        key: spellSlotKey(level),
        label: `level ${level} spell slot`,
        max: 4,
        recovers: 'long-rest',
      },
    }),
  ),
  { type: 'scene-set', extent: { width: 200, depth: 200, height: 40 } },
  { type: 'landmark-added', name: 'the door', at: { x: 50, y: 50, z: 0 } },
  { type: 'creature-placed', id: WIZARD, placement: { from: { landmark: 'the door' }, feet: 0 } },
  { type: 'creature-placed', id: ALLY, placement: { from: { creature: WIZARD }, feet: 5, bearing: 0 } },
  { type: 'creature-placed', id: FOE, placement: { from: { creature: WIZARD }, feet: 5, bearing: 90 } },
  { type: 'sight-declared', from: WIZARD, to: ALLY, seen: true },
  { type: 'sight-declared', from: WIZARD, to: FOE, seen: true },
  {
    type: 'spellcasting-declared',
    id: WIZARD,
    spellcasting: declaredCasting({
      ability: 'int',
      classId: 'wizard',
      cantrips: SPELL_DEFINITIONS.filter((d) => d.level === 0).map((d) => d.id),
      prepared: SPELL_DEFINITIONS.filter((d) => d.level > 0).map((d) => d.id),
    }),
  },
];

const supply = () => ({ issuer: createRollIssuer('r'), rng: createRng('cast') as Rng });

/** Cast a tracked spell at whatever its target rule asks for. */
const cast = (
  spellId: string,
  over: Partial<Parameters<typeof resolveSpell>[2]> = {},
  log: readonly GameEvent[] = SETUP,
) => {
  const definition = definitionFor(spellId);
  if (definition === null) throw new Error(`${spellId} has no definition`);
  const targets = definition.targets.count === 0 ? [] : [ALLY];
  return resolveSpell(
    fold('seed', log),
    WIZARD,
    {
      spellId,
      targets,
      ...(definition.level === 0 ? {} : { slotLevel: definition.level }),
      ...over,
    },
    supply(),
  );
};

const resolved = (spellId: string, over = {}, log: readonly GameEvent[] = SETUP) =>
  unwrap(cast(spellId, over, log), spellId);

describe('a tracked spell is cast, not refused', () => {
  it.each(TRACKED.map((s) => [s] as const))('casts %s', (spellId) => {
    const out = resolved(spellId);
    expect(out.events.filter((e) => e.type === 'spell-cast')).toHaveLength(1);
  });

  /** The cost is the whole point: a slot spent is a slot gone. */
  it('spends the slot a levelled tracked spell costs', () => {
    const out = resolved('fly');
    const after = fold('seed', [...SETUP, ...out.events]);
    expect(remaining(after.creatures.wizard!.resources, spellSlotKey(3))).toBe(3);
  });

  /** SRD Fly: "Concentration, up to 10 minutes". */
  it('takes Concentration, and gives up whatever was held', () => {
    const first = resolved('fly');
    const log = [...SETUP, ...first.events];
    expect(fold('seed', log).creatures.wizard!.concentration).not.toBeNull();

    const second = resolved('spider-climb', {}, log);
    expect(second.events.some((e) => e.type === 'concentration-ended')).toBe(true);
  });

  /** And a tracked spell that is *not* Concentration does not take it. */
  it('leaves Concentration alone for a spell that does not need it', () => {
    const held = [...SETUP, ...resolved('fly').events];
    const out = resolved('longstrider', {}, held);
    expect(out.events.some((e) => e.type === 'concentration-ended')).toBe(false);
    expect(fold('seed', [...held, ...out.events]).creatures.wizard!.concentration).not.toBeNull();
  });

  /** SRD Misty Step: "Bonus Action". A turn holds one of those, not two. */
  it('spends the action the spell actually costs', () => {
    expect(definitionFor('misty-step')?.castingTime).toBe('bonus-action');
    expect(definitionFor('jump')?.castingTime).toBe('bonus-action');
    expect(definitionFor('fly')?.castingTime).toBe('action');
  });

  /**
   * Every one of these says what it is leaving to the table. A tracked spell
   * that declared nothing would be a definition that silently did nothing,
   * which is worse than the refusal it replaced.
   */
  it.each(TRACKED.map((s) => [s] as const))('says what a DM still does for %s', (spellId) => {
    const out = resolved(spellId);
    expect(out.unverified.length).toBeGreaterThan(0);
    expect(out.unverified.join(' ')).toContain(definitionFor(spellId)!.name);
  });

  it('affects nobody mechanically, and says so rather than pretending', () => {
    const out = resolved('detect-magic');
    expect(out.outcomes).toEqual([]);
  });
});

describe('a tracked spell still obeys its target rule', () => {
  /** SRD Detect Magic: "Range: Self". There is nobody to aim it at. */
  it('refuses a target for a spell that takes none', () => {
    const out = cast('detect-magic', { targets: [ALLY] });
    expect(isErr(out)).toBe(true);
    if (!isErr(out)) return;
    expect(out.code).toBe('takes_no_target');
  });

  /** SRD Fly: "You touch a willing creature." One, and it is not nobody. */
  it('refuses no target for a spell that needs one', () => {
    const out = cast('fly', { targets: [] });
    expect(isErr(out)).toBe(true);
    if (!isErr(out)) return;
    expect(out.code).toBe('no_targets');
  });

  /** SRD Fly: "one additional creature for each spell slot level above 3." */
  it('takes an extra target per slot level above the spell’s own', () => {
    const two = cast('fly', { targets: [ALLY, FOE] });
    expect(isErr(two)).toBe(true);
    if (isErr(two)) expect(two.code).toBe('too_many_targets');

    const out = unwrap(cast('fly', { targets: [ALLY, FOE], slotLevel: 4 }), 'fly at 4');
    expect(out.castingId.length).toBeGreaterThan(0);
  });

  /** SRD Water Breathing: "up to ten willing creatures of your choice". */
  it('reads a ten-target spell as a ten-target spell', () => {
    expect(definitionFor('water-breathing')?.targets.count).toBe(10);
  });

  /** Range is checked, because range is arithmetic even when the effect is not. */
  it('refuses a target out of range', () => {
    const far: readonly GameEvent[] = [
      ...SETUP.filter(
        (e) => !(e.type === 'creature-placed' && e.id === ALLY),
      ),
      { type: 'creature-placed', id: ALLY, placement: { from: { creature: WIZARD }, feet: 60, bearing: 0 } },
    ];
    const out = cast('fly', {}, far);
    expect(isErr(out)).toBe(true);
    if (!isErr(out)) return;
    expect(out.code).toBe('out_of_range');
  });
});

describe('a tracked spell is retried and replayed like any other', () => {
  it('is a no-op on a retried command id', () => {
    const first = resolved('fly', { commandId: 'c1' });
    const log = [...SETUP, ...first.events];
    const again = unwrap(cast('fly', { commandId: 'c1' }, log), 'retry');
    expect(again.events).toEqual([]);
    expect(remaining(fold('seed', log).creatures.wizard!.resources, spellSlotKey(3))).toBe(3);
  });

  it.each(TRACKED.map((s) => [s] as const))('replays %s prefix by prefix', (spellId) => {
    const out = resolved(spellId);
    const log = [...SETUP, ...out.events];
    for (let n = 0; n <= log.length; n += 1) {
      expect(fold('seed', log.slice(0, n))).toEqual(fold('seed', log.slice(0, n)));
    }
  });

  /** No dice are rolled, so the generator does not move. */
  it('advances no roll for a spell that rolls nothing', () => {
    const out = resolved('detect-magic');
    expect(out.events.some((e) => e.type === 'rolls-issued')).toBe(false);
  });
});
