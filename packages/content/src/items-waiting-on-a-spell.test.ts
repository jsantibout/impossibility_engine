import { describe, expect, it } from 'vitest';
import { SPELL_DEFINITIONS, SRD_CONTENT } from '@ie/content';
import { isExecuted } from '../scripts/coverage-data.js';
import { asCharacterId, isErr, expect as unwrap, type CharacterId } from '@ie/shared';
import type { CatalogueItem, CharacterSheet, Content } from '@ie/engine';
import {
  advanceTime,
  awardItems,
  chargesLeft,
  createRng,
  createRollIssuer,
  declareDawn,
  declaredCasting,
  equipItem,
  expendCharges,
  extendContent,
  fold,
  ongoingSpellOf,
  pendingCastingsOf,
  resolveDeclaredCast,
  resolveSpell,
  spellSlotKey,
  useItem,
  type GameEvent,
  type GameState,
  type Rng,
} from '@ie/engine';
import { type Result } from '@ie/shared';

/**
 * The magic items whose only blocker was the spell underneath them.
 *
 * `ITEM_SHAPES`'s heaviest entry — `a-spell-an-item-casts-that-nothing-executes`
 * — says the word that decides it is **definition**, not *executable*:
 * `checkContent` hands `itemCastsProblems` the predicate `spells.some(s => s.id
 * === id)` and `castFromItem` reads `content.spell(id)`, so a **tracked**
 * definition answers both, and SRD's own sentence about what a casting from an
 * item is — "The spell uses its normal casting time, range, and duration, and
 * the user of the item must concentrate if the spell requires Concentration" —
 * is every word of it arithmetic a tracked definition already carries.
 *
 * `item-casts-a-tracked-spell.test.ts` proved that on a Wand of Magic
 * Detection and a Ring of Animal Influence. This drives the batch the finding
 * paid for: twelve items whose spell had no definition at all until this
 * commit, and three potions that **confer** a spell's effects rather than
 * casting anything — the other side of the same shape, and the side where the
 * blocker is a definition that resolves *nothing* rather than one that is
 * missing.
 *
 * Every one is driven through the public API rather than inspected, because a
 * record that parses and never casts is the failure a catalogue cannot see.
 */

const id = (s: string) => asCharacterId(s);
const BEARER = id('bearer');
const OTHER = id('other');

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 9,
  abilities: { str: 10, dex: 12, con: 12, int: 16, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  /**
   * Nobody here casts spells of their own. Every number these items use is the
   * item's, which is what a printed save DC is for.
   */
  spellcastingAbility: null,
  ...over,
});

const added = (who: CharacterId, maxHp = 40): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(),
  maxHp,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side: 'party',
});

const SCENE: readonly GameEvent[] = [
  { type: 'scene-set', extent: { width: 400, depth: 400, height: 40 } },
  { type: 'landmark-added', name: 'the vault', at: { x: 100, y: 100, z: 0 } },
  { type: 'creature-placed', id: BEARER, placement: { from: { landmark: 'the vault' }, feet: 0 } },
  {
    type: 'creature-placed',
    id: OTHER,
    placement: { from: { creature: BEARER }, feet: 5, bearing: 0 },
  },
  { type: 'sight-declared', from: BEARER, to: OTHER, seen: true },
  { type: 'sight-declared', from: OTHER, to: BEARER, seen: true },
];

const run = (
  log: readonly GameEvent[],
  command: (s: GameState) => Result<readonly GameEvent[]>,
): readonly GameEvent[] => [...log, ...unwrap(command(fold('seed', log)), 'command')];

const supply = (seed: string, content: Content = SRD_CONTENT) => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content,
});

/**
 * Owned and not worn, which is what a bottle asks for.
 *
 * Through `awardItems`, the door a DM hands a party what it found: a copy
 * with charges is labelled and given its own pool where it is gained, and a
 * hand-written `items-gained` is a line with no record and no charges.
 */
const carrying = (
  itemId: string,
  content: Content = SRD_CONTENT,
  otherMaxHp = 40,
): readonly GameEvent[] =>
  run([added(BEARER), added(OTHER, otherMaxHp), ...SCENE], (s) =>
    awardItems(s, supply('the-hoard', content), BEARER, [{ id: itemId }], 'the hoard'),
  );

/** Owned, worn, and attuned where the book prints the bracket. */
const wearing = (itemId: string): readonly GameEvent[] => {
  const worn = run(carrying(itemId), (s) => equipItem(s, SRD_CONTENT, BEARER, itemId));
  return SRD_CONTENT.item(itemId)?.attunement === undefined
    ? worn
    : [...worn, { type: 'attuned', id: BEARER, item: itemId }];
};

const castOf = (events: readonly GameEvent[]) =>
  events.find((e) => e.type === 'spell-cast') as
    | Extract<GameEvent, { type: 'spell-cast' }>
    | undefined;

const left = (log: readonly GameEvent[], itemId: string): number =>
  chargesLeft(fold('seed', log), SRD_CONTENT, BEARER, itemId);

/**
 * A casting from an item, driven all the way to the `spell-cast` that records
 * it — through the declaration where the spell takes a minute or more.
 *
 * Four of these spells do: Scrying's ten minutes, Tiny Hut's minute, Private
 * Sanctum's ten and Resurrection's hour. A casting of that length is
 * *declared* and settles when the clock arrives, and SRD says an item's
 * casting "uses its normal casting time", so the rite is the item's too. The
 * span moved is the definition's own `castingSeconds`, which the oracle holds
 * against the printed casting time.
 */
const castFrom = (
  itemId: string,
  spellId: string,
  over: Partial<Parameters<typeof resolveSpell>[2]> = {},
  seed = 'item',
) => {
  const log = wearing(itemId);
  const first = unwrap(
    resolveSpell(
      fold('seed', log),
      BEARER,
      { spellId, targets: [], item: itemId, ...over },
      supply(seed),
    ),
    `${itemId} casting ${spellId}`,
  );
  const definition = SRD_CONTENT.spell(spellId);
  if (definition?.castingTime !== 'long') {
    return { log: [...log, ...first.events], out: first };
  }

  const open = fold('seed', [...log, ...first.events]);
  const castingId = pendingCastingsOf(open)[0]!.castingId;
  const tick = unwrap(advanceTime(open, definition.castingSeconds!, 'the rite'), `tick ${spellId}`);
  const ticked = [...log, ...first.events, ...tick];
  const settled = unwrap(
    resolveDeclaredCast(fold('seed', ticked), castingId, supply(seed)),
    `settle ${spellId}`,
  );
  return {
    log: [...ticked, ...settled.events],
    out: {
      ...settled,
      events: [...first.events, ...tick, ...settled.events],
      unverified: [...first.unverified, ...settled.unverified],
    },
  };
};

/**
 * The spells this batch wrote, and which of the two buckets each landed in.
 *
 * Written down rather than derived, because the claim the brief turns on is
 * *which* definitions were needed: a list read back off the catalogue would
 * agree with a batch that wrote none of them.
 */
const WRITTEN: Readonly<Record<string, 'tracked' | 'executed'>> = {
  'detect-thoughts': 'tracked',
  'enlarge-reduce': 'tracked',
  etherealness: 'tracked',
  'gaseous-form': 'executed',
  gate: 'tracked',
  haste: 'executed',
  heal: 'executed',
  // Tracked when this batch wrote it and executed since: the lift a
  // Constitution save gates is a rider on the outcome now, which is what the
  // Boots of Levitation were waiting for all along.
  levitate: 'executed',
  'private-sanctum': 'tracked',
  'resilient-sphere': 'tracked',
  resurrection: 'tracked',
  'scorching-ray': 'executed',
  scrying: 'tracked',
  telekinesis: 'tracked',
  teleport: 'tracked',
  // Tracked when this batch wrote it and executed since: the dome is a barrier
  // the movement command refuses, a ward the casting pipeline refuses across,
  // and a casting the caster's own step out ends.
  'tiny-hut': 'executed',
};

describe('the spells the eighteen items were waiting for', () => {
  it('are all defined, and each is in the bucket its paragraph put it in', () => {
    for (const [spellId, bucket] of Object.entries(WRITTEN)) {
      const definition = SPELL_DEFINITIONS.find((d) => d.id === spellId);
      expect(definition, `${spellId} has no definition`).toBeDefined();
      // **Asked of the one predicate** rather than of `effects.length`, which
      // is the copy `isExecuted`'s own docstring warns about: SRD Tiny Hut has
      // no effect in its list and is executed through what its Emanation does
      // to whoever stands in it.
      expect(isExecuted(definition!) ? 'executed' : 'tracked', `${spellId} is ${bucket}`).toBe(
        bucket,
      );
    }
  });

  /**
   * And every tracked one says what it leaves to the table, because a tracked
   * definition that declared nothing would be a spell that silently did
   * nothing — which is worse than the refusal it replaced.
   */
  it('leaves a written gap on every tracked one', () => {
    for (const [spellId, bucket] of Object.entries(WRITTEN)) {
      if (bucket !== 'tracked') continue;
      expect(SRD_CONTENT.spell(spellId)?.unmodelled ?? [], spellId).not.toEqual([]);
    }
  });
});

/**
 * SRD Boots of Levitation: "_Wondrous Item, Rare (Requires Attunement)._ While
 * you wear these boots, you can cast _Levitate_ on yourself."
 *
 * **The item Levitate was written for, and the engine line that stopped it is
 * gone.** Levitate reaches "One creature ... of your choice that you can see
 * within range", so the definition carries `requiresSight`; the boots narrow
 * it to the wearer; and `sightBetween(scene, x, x)` used to answer **null**,
 * which `resolveTargets` turned into a request to establish whether the
 * wearer could see themselves. There was no way to satisfy it: `declareSight`
 * refuses the pair outright, in the engine's own words — "a creature can see
 * itself" — so the fact the resolver asked for was one the fold would not
 * record.
 *
 * The refusal was never the wrong half; asking was. `sightBetween` now
 * answers **true** for a creature and itself, before the declaration and
 * before any sense, so the request never arises and the refusal costs
 * nothing. The defect was older and wider than this entry — Healing Word and
 * Mass Healing Word pair `self` with `requiresSight` and neither could be
 * cast on its own caster — and `seeing-yourself.test.ts` in the engine drives
 * that half. This drives the boots' own shape: an at-will casting an item
 * narrows to its wearer.
 *
 * **The boots are in the catalogue now**, which is the transcription that
 * commit left for whoever owned the item map. The homebrew pair below is kept
 * beside them rather than replaced: it is the same record with a different id,
 * so it proves the shape is content rather than a special case the SRD
 * catalogue is allowed.
 */
describe('the boots nothing stops any more', () => {
  it('is in the catalogue, and Levitate is the spell it was waiting for', () => {
    const boots = SRD_CONTENT.item('boots-of-levitation');
    expect(boots?.attunement, 'the book prints the bracket').toBeDefined();
    expect(boots?.grants).toEqual([
      { kind: 'casts', spell: 'levitate', atWill: true, targetsSelfOnly: true },
    ]);
    expect(SRD_CONTENT.spell('levitate')?.requiresSight).toBe(true);
    expect(SRD_CONTENT.spell('levitate')?.targets.self).toBe(true);
  });

  /**
   * The record itself, on the wearer, with nobody having declared any sight —
   * which is the whole of what the entry was blocked on.
   */
  it('levitates the wearer of the SRD boots, and lifts nobody else', () => {
    const booted = wearing('boots-of-levitation');
    const risen = unwrap(
      resolveSpell(
        fold('seed', booted),
        BEARER,
        { spellId: 'levitate', targets: [BEARER], item: 'boots-of-levitation' },
        supply('rise'),
      ),
      'the SRD boots on their wearer',
    );
    expect(castOf(risen.events)?.concentration).toBe(true);
    expect(castOf(risen.events)?.slotless).toBe('magic-item');

    // "on yourself": the narrowing is the item's, and the refusal names it
    // rather than asking whether the bearer can see their neighbour.
    const lifted = resolveSpell(
      fold('seed', booted),
      BEARER,
      { spellId: 'levitate', targets: [OTHER], item: 'boots-of-levitation' },
      supply('lift'),
    );
    expect(isErr(lifted)).toBe(true);

    // And nothing ran out: the entry prints no charge count and no per-day
    // sentence, so the second rise costs exactly what the first did.
    const again = resolveSpell(
      fold('seed', [...booted, ...risen.events]),
      BEARER,
      {
        spellId: 'levitate',
        targets: [BEARER],
        item: 'boots-of-levitation',
        commandId: 'rise-again',
      },
      supply('rise-again'),
    );
    expect(isErr(again)).toBe(false);
  });

  /** The spell itself is fine, and casts at anybody the caster has been said to see. */
  it('casts Levitate at a neighbour, Concentration and all', () => {
    const log: readonly GameEvent[] = [
      added(BEARER),
      added(OTHER),
      ...SCENE,
      {
        type: 'resource-pool-declared',
        id: BEARER,
        pool: { key: spellSlotKey(2), label: 'level 2 spell slot', max: 2, recovers: 'long-rest' },
      },
      {
        type: 'spellcasting-declared',
        id: BEARER,
        spellcasting: declaredCasting({ ability: 'int', prepared: ['levitate'] }),
      },
    ];
    const out = unwrap(
      resolveSpell(
        fold('seed', log),
        BEARER,
        { spellId: 'levitate', targets: [OTHER], slotLevel: 2 },
        supply('levitate'),
      ),
      'Levitate on a neighbour',
    );
    expect(castOf(out.events)?.concentration).toBe(true);
    expect(out.events).toContainEqual({
      type: 'effect-scheduled',
      target: { kind: 'casting', castingId: out.castingId },
      deadline: { kind: 'elapsed', at: 600 },
    });
    expect(out.unverified.join(' ')).toContain('Levitate');
  });

  /** The boots' own casting: at will, on the wearer, with nothing declared. */
  const booted = () => {
    const log: readonly GameEvent[] = [added(BEARER), added(OTHER), ...SCENE];
    const built = extendContent(SRD_CONTENT, {
      items: [
        {
          id: 'boots-of-rising',
          name: 'boots-of-rising',
          kind: 'wondrous',
          weightLb: null,
          costCp: null,
          armor: null,
          weapon: null,
          contents: [],
          grants: [{ kind: 'casts', spell: 'levitate', atWill: true, targetsSelfOnly: true }],
        },
      ],
    });
    if (!built.ok) throw new Error('the homebrew boots: ' + JSON.stringify(built));
    const content = built.value;
    const worn = run(
      [
        ...log,
        {
          type: 'items-gained',
          id: BEARER,
          items: [{ id: 'boots-of-rising', quantity: 1 }],
          source: 'the hoard',
        },
      ],
      (s) => equipItem(s, content, BEARER, 'boots-of-rising'),
    );
    return { content, worn };
  };

  it('levitates its wearer, with nobody having declared that they can see themselves', () => {
    const { content, worn } = booted();
    const out = unwrap(
      resolveSpell(
        fold('seed', worn),
        BEARER,
        { spellId: 'levitate', targets: [BEARER], item: 'boots-of-rising' },
        supply('boots', content),
      ),
      'the boots on their wearer',
    );

    expect(castOf(out.events)?.concentration).toBe(true);
    expect(castOf(out.events)?.slotless).toBe('magic-item');
    expect(ongoingSpellOf(fold('seed', [...worn, ...out.events]), out.castingId!)).not.toBeNull();
  });

  /**
   * And the declaration is still refused — which is now a refusal of
   * something nobody needs, rather than the other half of a deadlock.
   */
  it('still refuses to be told a creature can see itself', () => {
    const { worn } = booted();
    expect(() =>
      fold('seed', [...worn, { type: 'sight-declared', from: BEARER, to: BEARER, seen: true }]),
    ).toThrow(/a creature can see itself/);
  });
});

/**
 * SRD Circlet of Blasting: "While wearing this circlet, you can cast
 * _Scorching Ray_ with it (+5 to hit). The circlet can't cast this spell again
 * until the next dawn."
 *
 * A per-day property is a pool of one — the Cape of the Mountebank's shape —
 * and "(+5 to hit)" is the attack bonus the item prints, which is the field
 * `castsSpell` has carried since it was written and which nothing used.
 */
describe('a Circlet of Blasting casts Scorching Ray once a day', () => {
  const CIRCLET = 'circlet-of-blasting';

  it('spends its one use and prints its own attack bonus', () => {
    const circlet = SRD_CONTENT.item(CIRCLET);
    const grant = circlet?.grants?.find((one) => one.kind === 'casts');
    expect(grant?.kind === 'casts' && grant.attackBonus).toBe(5);

    const { log, out } = castFrom(CIRCLET, 'scorching-ray', { targets: [OTHER] });
    expect(left(log, CIRCLET)).toBe(0);
    expect(castOf(out.events)?.slotless).toBe('magic-item');
    expect(castOf(out.events)?.level).toBe(2);
  });

  it('refuses a second casting before the next dawn, and allows one after it', () => {
    const { log } = castFrom(CIRCLET, 'scorching-ray', { targets: [OTHER] });
    const again = resolveSpell(
      fold('seed', log),
      BEARER,
      { spellId: 'scorching-ray', targets: [OTHER], item: CIRCLET, commandId: 'second' },
      supply('again'),
    );
    expect(isErr(again) && again.code).toBe('exhausted');

    const dawned = run(log, (s) => declareDawn(s, supply('dawn')));
    expect(left(dawned, CIRCLET)).toBe(1);
  });
});

/**
 * SRD Crystal Ball: "While touching this crystal orb, you can cast _Scrying_
 * (save DC 17) with it."
 *
 * The at-will casting of a spell that takes **ten minutes** — so the orb is
 * where a long casting time and an item's route meet, and the rite is declared
 * and settled exactly as a Wizard's would be.
 */
describe('a Crystal Ball scrys, and the two that scry and do more', () => {
  it('declares the ten-minute rite and settles it on the clock', () => {
    const log = wearing('crystal-ball');
    const declaration = unwrap(
      resolveSpell(
        fold('seed', log),
        BEARER,
        { spellId: 'scrying', targets: [], item: 'crystal-ball' },
        supply('orb'),
      ),
      'the orb declaring Scrying',
    );
    expect(declaration.events.some((e) => e.type === 'spell-declared')).toBe(true);
    expect(castOf(declaration.events)).toBeUndefined();

    const { log: settled, out } = castFrom('crystal-ball', 'scrying');
    expect(castOf(out.events)?.slotless).toBe('magic-item');
    const record = ongoingSpellOf(fold('seed', settled), out.castingId!);
    // "(save DC 17)" is the orb's number, and the bearer has no spellcasting
    // ability at all to have supplied one.
    expect(record?.numbers.saveDc).toBe(17);
    expect(out.unverified.join(' ')).toContain('Scrying');
  });

  /**
   * The fourth orb, whose spell was never the blocker either: Scrying is
   * tracked, `checkContent` asks for a definition rather than an executable
   * one, and the Truesight the entry is named for is the note.
   */
  it('scrys off the Crystal Ball of True Seeing against the orb’s own seventeen', () => {
    const { log, out } = castFrom('crystal-ball-of-true-seeing', 'scrying');
    expect(castOf(out.events)?.slotless).toBe('magic-item');
    expect(ongoingSpellOf(fold('seed', log), out.castingId!)?.numbers.saveDc).toBe(17);
    expect(
      SRD_CONTENT.item('crystal-ball-of-true-seeing')?.unmodelled?.join(' '),
      'the Truesight says where it is centred',
    ).toContain("centered on the spell's sensor");
  });

  /** The Legendary orb that scrys and reads minds casts both, and prices neither. */
  it('reads minds off the Crystal Ball of Mind Reading', () => {
    const { log, out } = castFrom('crystal-ball-of-mind-reading', 'detect-thoughts');
    expect(castOf(out.events)?.slotless).toBe('magic-item');
    const record = ongoingSpellOf(fold('seed', log), out.castingId!);
    expect(record?.numbers.saveDc).toBe(17);
  });

  /**
   * And the one that suggests does it once a day, out of a pool of one, beside
   * a Scrying the book puts no limit on at all.
   */
  it('suggests once a day off the Crystal Ball of Telepathy', () => {
    const BALL = 'crystal-ball-of-telepathy';
    const { log, out } = castFrom(BALL, 'suggestion', { targets: [OTHER] });
    expect(castOf(out.events)?.slotless).toBe('magic-item');
    expect(left(log, BALL)).toBe(0);
    expect(ongoingSpellOf(fold('seed', log), out.castingId!)?.numbers.saveDc).toBe(17);

    // The Scrying beside it is free, and the spent Suggestion has not touched
    // it — which is the whole reason the two grants are priced separately.
    const scry = resolveSpell(
      fold('seed', log),
      BEARER,
      { spellId: 'scrying', targets: [], item: BALL, commandId: 'scry-after' },
      supply('scry'),
    );
    expect(isErr(scry)).toBe(false);
  });
});

/**
 * SRD Cube of Force: six faces, six spells, a charge cost each, and one save
 * DC printed before the table.
 */
describe('a Cube of Force presses six faces', () => {
  const CUBE = 'cube-of-force';

  it('prices every row the way the book’s table prices it', () => {
    const cube = SRD_CONTENT.item(CUBE);
    const priced = (cube?.grants ?? [])
      .filter((grant) => grant.kind === 'casts')
      .map((grant) => (grant.kind === 'casts' ? [grant.spell, grant.charges] : []));
    expect(priced).toEqual([
      ['mage-armor', 1],
      ['shield', 1],
      ['tiny-hut', 3],
      ['private-sanctum', 4],
      ['resilient-sphere', 4],
      ['wall-of-force', 5],
    ]);
  });

  /** Four charges for a sphere, off a cube that started with ten. */
  it('spends four charges on Resilient Sphere', () => {
    const { log, out } = castFrom(CUBE, 'resilient-sphere', { targets: [OTHER] });
    expect(left(log, CUBE)).toBe(6);
    expect(ongoingSpellOf(fold('seed', log), out.castingId!)?.numbers.saveDc).toBe(17);
  });

  /** And three on a hut, which is a rite of a minute rather than an Action. */
  it('spends three on Tiny Hut and declares the minute it takes', () => {
    const { log, out } = castFrom(CUBE, 'tiny-hut');
    expect(left(log, CUBE)).toBe(7);
    expect(out.events.some((e) => e.type === 'spell-declared')).toBe(true);
    expect(castOf(out.events)?.slotless).toBe('magic-item');
  });
});

/**
 * SRD Cubic Gate: "The cube has 3 charges and regains 1d3 expended charges
 * daily at dawn. As a Magic action, you can expend 1 of the cube's charges to
 * cast one of the following spells using the cube."
 */
describe('a Cubic Gate opens a portal and shifts a plane', () => {
  const CUBE = 'cubic-gate';

  it('casts Gate for one charge, with Concentration and a minute on the clock', () => {
    const { log, out } = castFrom(CUBE, 'gate');
    expect(left(log, CUBE)).toBe(2);
    expect(castOf(out.events)?.concentration).toBe(true);
    expect(out.events).toContainEqual({
      type: 'effect-scheduled',
      target: { kind: 'casting', castingId: out.castingId },
      deadline: { kind: 'elapsed', at: 60 },
    });
  });

  it('casts Plane Shift for another, on the eight the spell takes', () => {
    const { log, out } = castFrom(CUBE, 'plane-shift', { targets: [OTHER] });
    expect(left(log, CUBE)).toBe(2);
    expect(castOf(out.events)?.slotless).toBe('magic-item');
  });
});

/** SRD Helm of Teleportation: three charges, one spent to cast _Teleport_. */
describe('a Helm of Teleportation casts Teleport', () => {
  it('spends one of three and takes an Action', () => {
    const { log, out } = castFrom('helm-of-teleportation', 'teleport', { targets: [OTHER] });
    expect(left(log, 'helm-of-teleportation')).toBe(2);
    expect(castOf(out.events)?.slotless).toBe('magic-item');
    expect(SRD_CONTENT.spell('teleport')?.castingTime).toBe('action');
  });
});

/** SRD Medallion of Thoughts: five charges, one spent, save DC 13. */
describe('a Medallion of Thoughts casts Detect Thoughts', () => {
  it('spends one of five against the medallion’s own thirteen', () => {
    const { log, out } = castFrom('medallion-of-thoughts', 'detect-thoughts');
    expect(left(log, 'medallion-of-thoughts')).toBe(4);
    expect(ongoingSpellOf(fold('seed', log), out.castingId!)?.numbers.saveDc).toBe(13);
  });
});

/**
 * SRD Plate Armor of Etherealness: "While you're wearing this armor, you can
 * take a Magic action and use a command word to gain the effect of the
 * _Etherealness_ spell."
 *
 * Armour and a casting on one record, and the per-day property is the pool of
 * one the Cape of the Mountebank already writes.
 */
describe('Plate Armor of Etherealness steps sideways once a day', () => {
  const PLATE = 'plate-armor-of-etherealness';

  it('is armour that casts, and both halves are on the record', () => {
    const plate = SRD_CONTENT.item(PLATE);
    expect(plate?.kind).toBe('armor');
    expect(plate?.armor?.category).toBe('heavy');
    expect(plate?.grants?.some((grant) => grant.kind === 'casts')).toBe(true);
  });

  it('spends its one use and runs the eight hours without Concentration', () => {
    const { log, out } = castFrom(PLATE, 'etherealness');
    expect(left(log, PLATE)).toBe(0);
    expect(castOf(out.events)?.concentration).toBe(false);
    expect(out.events).toContainEqual({
      type: 'effect-scheduled',
      target: { kind: 'casting', castingId: out.castingId },
      deadline: { kind: 'elapsed', at: 28_800 },
    });
  });
});

/** SRD Ring of Telekinesis: "While wearing this ring, you can cast _Telekinesis_ from it." */
describe('a Ring of Telekinesis casts Telekinesis', () => {
  it('casts at will and holds the ten minutes of Concentration', () => {
    const { log, out } = castFrom('ring-of-telekinesis', 'telekinesis');
    expect(castOf(out.events)?.slotless).toBe('magic-item');
    expect(fold('seed', log).creatures[BEARER]?.concentration?.castingId).toBe(out.castingId);
    expect(out.events).toContainEqual({
      type: 'effect-scheduled',
      target: { kind: 'casting', castingId: out.castingId },
      deadline: { kind: 'elapsed', at: 600 },
    });
  });
});

/**
 * SRD Rod of Resurrection: "_Heal_ (expends 1 charge) or _Resurrection_
 * (expends 5 charges). ... The rod regains 1 expended charge daily at dawn."
 *
 * **The engine line this entry was waiting on exists now.**
 * `ResourcePool.regainsAtDawn` took dice, on the recorded reasoning that the
 * SRD "prints dice" and "never once" a stated number at dawn — and this rod
 * printed the exception, a stated 1, which a one-sided die cannot say.
 * Leaving the field off was not neutral either: a `dawn` pool with no dice
 * refills, so the record would have given back five charges every morning
 * where the book gives one, which is rule 3 in `items.ts`.
 *
 * The field now reads a bare positive integer as the number it is, and the
 * dawn hands it back without throwing anything. **The record is written**, in
 * `items.ts`, and the block at the bottom of this file drives it; what is
 * kept here is the validator half — that a stated count is taken and a string
 * that is not one is still refused — beside a homebrew rod built through the
 * door homebrew goes through, because the spells are the part this batch owns
 * and a spell nobody drives is a spell nobody checked.
 */
describe('the rod and the two spells it casts', () => {
  const ROD = 'rod-of-resurrection';

  it('is in the catalogue, and the dawn line no longer stands in the way', () => {
    expect(SRD_CONTENT.item(ROD)?.grants).toContainEqual({
      kind: 'pool',
      key: 'rod-of-resurrection:charges',
      label: 'Rod of Resurrection charges',
      uses: 5,
      recovers: 'dawn',
      regainsAtDawn: '1',
    });
    // A stated number at dawn: neither a die nor a refill, and now a sentence
    // the validator takes.
    const flat = extendContent(SRD_CONTENT, {
      items: [
        {
          id: 'rod-of-the-stated-dawn',
          name: 'rod-of-the-stated-dawn',
          kind: 'rod',
          weightLb: null,
          costCp: null,
          armor: null,
          weapon: null,
          contents: [],
          grants: [
            {
              kind: 'pool',
              key: 'rod-of-the-stated-dawn:charges',
              label: 'charges',
              uses: 5,
              recovers: 'dawn',
              regainsAtDawn: '1',
            },
          ],
        },
      ],
    });
    expect(isErr(flat)).toBe(false);
    // And a number that is not a recovery is still refused, so the reading is
    // "a stated count" rather than "any string at all".
    const nothing = extendContent(SRD_CONTENT, {
      items: [
        {
          id: 'rod-of-the-stated-nothing',
          name: 'rod-of-the-stated-nothing',
          kind: 'rod',
          weightLb: null,
          costCp: null,
          armor: null,
          weapon: null,
          contents: [],
          grants: [
            {
              kind: 'pool',
              key: 'rod-of-the-stated-nothing:charges',
              label: 'charges',
              uses: 5,
              recovers: 'dawn',
              regainsAtDawn: '0',
            },
          ],
        },
      ],
    });
    expect(isErr(nothing) && nothing.code).toBe('invalid_content');
  });

  /** The homebrew rod, priced the way the book prices it and refilled by a die. */
  const HOMEBREW: CatalogueItem = {
    id: 'rod-of-raising',
    name: 'rod-of-raising',
    kind: 'rod',
    weightLb: null,
    costCp: null,
    armor: null,
    weapon: null,
    contents: [],
    grants: [
      {
        kind: 'pool',
        key: 'rod-of-raising:charges',
        label: 'rod-of-raising charges',
        uses: 5,
        recovers: 'dawn',
        regainsAtDawn: '1d2',
      },
      { kind: 'casts', spell: 'heal', charges: 1 },
      { kind: 'casts', spell: 'resurrection', charges: 5 },
    ],
  };

  const withRod = () => {
    const built = extendContent(SRD_CONTENT, { items: [HOMEBREW] });
    if (!built.ok) throw new Error('the homebrew rod: ' + JSON.stringify(built));
    return built.value;
  };

  /**
   * A patient with more than seventy hit points to lose.
   *
   * **Found by mutation.** With the default forty, dropping Heal's printed
   * amount to sixty changed nothing anybody could see: a target down thirty
   * comes back to full either way, so the number the SRD prints was asserted
   * by nothing. The wound has to be deeper than the healing for the healing
   * to be the number under test.
   */
  const holdingRod = (content: Content): readonly GameEvent[] =>
    run(carrying('rod-of-raising', content, 120), (s) =>
      equipItem(s, content, BEARER, 'rod-of-raising'),
    );

  it('heals seventy and lifts three conditions for a single charge', () => {
    const content = withRod();
    const log: readonly GameEvent[] = [
      ...holdingRod(content),
      { type: 'damage-taken', id: OTHER, amount: 100, source: 'the wight' },
      { type: 'condition-applied', id: OTHER, condition: 'poisoned', source: 'the wight' },
    ];
    const out = unwrap(
      resolveSpell(
        fold('seed', log),
        BEARER,
        { spellId: 'heal', targets: [OTHER], item: 'rod-of-raising' },
        supply('rod', content),
      ),
      'the rod casting Heal',
    );
    const after = fold('seed', [...log, ...out.events]);
    expect(
      chargesLeft(after, content, BEARER, 'rod-of-raising'),
      'one of five charges',
    ).toBe(4);
    // Seventy exactly: a hundred lost out of a hundred and twenty, so the
    // printed number lands whole and is not swallowed by the cap.
    expect(out.outcomes[0]?.healed).toBe(70);
    expect(after.creatures[OTHER]?.vitals.hp).toBe(90);
    expect(after.creatures[OTHER]?.conditions.conditions ?? []).not.toContain('poisoned');
    // No slot, and no spellcasting modifier on top of the printed seventy.
    expect(castOf(out.events)?.slotless).toBe('magic-item');
  });

  /**
   * "The healing increases by 10 for each spell slot level above 6."
   *
   * **The second printed number, and the rod cannot reach it.** SRD fixes a
   * casting from an item at "the lowest possible spell and caster level", and
   * `chargesFor` reads that as `(grant.level ?? spellLevel) + (spend - cost)`:
   * the rod prices Heal at a flat charge with no `upToCharges` above it, so
   * every casting it pays for is a level 6 Heal and the per-level ten is
   * invisible from there. An item whose line offers a *range* — the Wand of
   * Fireballs' shape — could show it; this one cannot. A slot is what moves
   * it here, so a caster spends one — found by mutation, which turned the ten
   * into a one and left the whole suite green.
   */
  it('grows by ten a slot level above the sixth, which the rod cannot show', () => {
    const log: readonly GameEvent[] = [
      added(BEARER),
      added(OTHER, 120),
      ...SCENE,
      {
        type: 'resource-pool-declared',
        id: BEARER,
        pool: { key: spellSlotKey(7), label: 'level 7 spell slot', max: 1, recovers: 'long-rest' },
      },
      {
        type: 'spellcasting-declared',
        id: BEARER,
        spellcasting: declaredCasting({ ability: 'int', prepared: ['heal'] }),
      },
      { type: 'damage-taken', id: OTHER, amount: 100, source: 'the wight' },
    ];
    const out = unwrap(
      resolveSpell(
        fold('seed', log),
        BEARER,
        { spellId: 'heal', targets: [OTHER], slotLevel: 7 },
        supply('upcast'),
      ),
      'Heal at the seventh',
    );
    expect(out.outcomes[0]?.healed).toBe(80);
  });

  it('spends five on Resurrection, and declares the hour the rite takes', () => {
    const content = withRod();
    const log = holdingRod(content);
    const declaration = unwrap(
      resolveSpell(
        fold('seed', log),
        BEARER,
        { spellId: 'resurrection', targets: [OTHER], item: 'rod-of-raising' },
        supply('raise', content),
      ),
      'the rod declaring Resurrection',
    );
    expect(declaration.events.some((e) => e.type === 'spell-declared')).toBe(true);
    expect(castOf(declaration.events)).toBeUndefined();
    expect(
      chargesLeft(fold('seed', [...log, ...declaration.events]), content, BEARER, 'rod-of-raising'),
    ).toBe(0);
  });
});

/**
 * The three potions, which cast nothing.
 *
 * SRD "Magic Items": "Many items, such as Potions, **bypass the casting of a
 * spell** and confer the spell's effects with its usual duration." So the
 * spell is written out rather than named — the Potion of Heroism's Bless is
 * the precedent — and "(no Concentration required)" is not a clause the engine
 * has to honour but a description of what a conferral already is.
 */
describe('three potions confer a spell’s effects without casting it', () => {
  const drink = (itemId: string, seed = 'drink') => {
    const log = carrying(itemId);
    const out = unwrap(
      useItem(fold('seed', log), BEARER, { item: itemId }, supply(seed)),
      `drinking ${itemId}`,
    );
    return { log: [...log, ...out.events], out };
  };

  /** SRD Potion of Speed: "the effect of the _Haste_ spell for 1 minute". */
  it('a Potion of Speed grants the Armour Class and the Dexterity Advantage', () => {
    const { log } = drink('potion-of-speed');
    const after = fold('seed', log);
    expect(after.creatures[BEARER]?.bonuses.map((bonus) => bonus.bonus.flat)).toEqual([2]);
    expect(after.creatures[BEARER]?.bonuses[0]?.applies).toContain('ac');
    expect(
      after.creatures[BEARER]?.rollModifiers.map((mode) => mode.modifier.selector),
    ).toEqual([{ roll: 'saving-throw', relation: 'roller', ability: 'dex' }]);

    // "for 1 minute", and the minute is the potion's rather than Haste's own —
    // a `grants` timer, because there is no casting for anything else to end.
    expect(Object.keys(after.timers).length).toBe(1);
    const nearly = fold('seed', [
      ...log,
      { type: 'time-advanced', seconds: 59, reason: 'the fight' } as GameEvent,
    ]);
    expect(nearly.creatures[BEARER]?.bonuses).toHaveLength(1);
    const gone = fold('seed', [
      ...log,
      { type: 'time-advanced', seconds: 60, reason: 'the fight' } as GameEvent,
    ]);
    expect(gone.creatures[BEARER]?.bonuses).toEqual([]);
    expect(gone.creatures[BEARER]?.rollModifiers).toEqual([]);
  });

  /**
   * SRD Potion of Growth: the "enlarge" half, for ten minutes.
   *
   * **The bottle makes the choice the casting cannot record**, which is why
   * the spell stays tracked and the potion does not: Enlarge/Reduce prints
   * Advantage on one branch and Disadvantage on the other, and nothing on a
   * casting says which was chosen. The label says "enlarge".
   */
  it('a Potion of Growth grants both halves of the enlarge branch', () => {
    const { log } = drink('potion-of-growth');
    const after = fold('seed', log);
    expect(after.creatures[BEARER]?.rollModifiers.map((mode) => mode.modifier.selector)).toEqual([
      { roll: 'ability-check', relation: 'roller', ability: 'str' },
      { roll: 'saving-throw', relation: 'roller', ability: 'str' },
    ]);
    for (const mode of after.creatures[BEARER]?.rollModifiers ?? []) {
      expect(mode.modifier.mode).toBe('advantage');
    }

    // "for 10 minutes", driven to the second: the potion's span rather than
    // Enlarge/Reduce's minute, and a number nothing else here reads.
    expect(
      fold('seed', [
        ...log,
        { type: 'time-advanced', seconds: 599, reason: 'the climb' } as GameEvent,
      ]).creatures[BEARER]?.rollModifiers,
    ).toHaveLength(2);
    expect(
      fold('seed', [
        ...log,
        { type: 'time-advanced', seconds: 600, reason: 'the climb' } as GameEvent,
      ]).creatures[BEARER]?.rollModifiers,
    ).toEqual([]);

    // And the spell itself stays tracked, because neither branch can be written.
    expect(SRD_CONTENT.spell('enlarge-reduce')?.effects).toEqual([]);
  });

  /**
   * SRD Potion of Gaseous Form: the Resistance and the three saves.
   *
   * **Five, and the fifth used to be refused by a name collision.** The spell
   * grants Immunity to the Prone condition through a `condition-immunity`
   * effect, `CONFERRED_EFFECT_KINDS` admits that kind, and `RIDER_FIELDS`
   * refused a conferred effect carrying a field called `conditions` — which is
   * the outcome rider a saving throw hangs *and* this kind's own required
   * list. The rider refusal is about riders again, and the potion confers what
   * the spell executes. Driven in both directions, because a note saying "the
   * engine does this" is worth exactly as much as the behaviour it claims.
   */
  it('a Potion of Gaseous Form confers five of the spell’s own effects', () => {
    const { log } = drink('potion-of-gaseous-form');
    const after = fold('seed', log);
    expect(
      after.creatures[BEARER]?.grantedDefenses.map((one) => [one.damageTypes, one.defense]),
    ).toEqual([[['bludgeoning', 'piercing', 'slashing'], 'resistant']]);
    expect(
      after.creatures[BEARER]?.rollModifiers
        .map((mode) => mode.modifier.selector.ability)
        .slice()
        .sort(),
    ).toEqual(['con', 'dex', 'str']);

    // The fifth: "You have Immunity to the Prone condition", conferred with
    // nothing cast, filed under the item's own bare source.
    expect(after.creatures[BEARER]?.grantedConditionImmunities).toEqual([
      { source: 'item:potion-of-gaseous-form', conditions: ['prone'] },
    ]);

    // Nothing was cast, so there is no casting for anything to end — and the
    // hour is therefore the *whole* of what ends it, driven to the second
    // rather than asserted in a comment.
    expect(after.ongoing).toEqual({});
    const nearly = fold('seed', [
      ...log,
      { type: 'time-advanced', seconds: 3599, reason: 'the crawl' } as GameEvent,
    ]);
    expect(nearly.creatures[BEARER]?.grantedDefenses).toHaveLength(1);
    expect(nearly.creatures[BEARER]?.rollModifiers).toHaveLength(3);
    expect(nearly.creatures[BEARER]?.grantedConditionImmunities).toHaveLength(1);
    const gone = fold('seed', [
      ...log,
      { type: 'time-advanced', seconds: 3600, reason: 'the crawl' } as GameEvent,
    ]);
    expect(gone.creatures[BEARER]?.grantedDefenses).toEqual([]);
    expect(gone.creatures[BEARER]?.rollModifiers).toEqual([]);
    expect(gone.creatures[BEARER]?.grantedConditionImmunities).toEqual([]);
  });

  /**
   * And the rule that used to refuse it still refuses what it was about.
   *
   * A `ConditionRider` on a conferred saving throw is welded to the casting
   * that hung it, and an item casts nothing. Driven here as well as in the
   * engine's own file, because this is where the collision was first written
   * down as a gap.
   */
  it('still refuses a rider condition on a conferred saving throw', () => {
    // The spell grants the Immunity, and now so does the potion.
    expect(
      SRD_CONTENT.spell('gaseous-form')?.effects.some(
        (effect) => effect.kind === 'condition-immunity',
      ),
    ).toBe(true);
    expect(
      (SRD_CONTENT.item('potion-of-gaseous-form')?.grants ?? []).some(
        (grant) =>
          grant.kind === 'confers' &&
          grant.effects.some((effect) => effect.kind === 'condition-immunity'),
      ),
    ).toBe(true);

    const built = extendContent(SRD_CONTENT, {
      items: [
        {
          id: 'potion-of-the-refused-rider',
          name: 'potion-of-the-refused-rider',
          kind: 'potion',
          weightLb: null,
          costCp: null,
          armor: null,
          weapon: null,
          contents: [],
          grants: [
            {
              kind: 'confers',
              action: 'bonus-action',
              saveDc: 13,
              durationSeconds: 3600,
              effects: [
                {
                  kind: 'save',
                  ability: 'con',
                  condition: 'poisoned',
                  conditions: [{ name: 'prone' }],
                },
              ],
            },
          ],
        },
      ],
    });
    expect(isErr(built) && built.code).toBe('invalid_content');
    expect(isErr(built) && built.reason).toContain('a "conditions" rider is welded to the casting');
  });

  /** A bottle is used up, which is the other half of a conferral's economy. */
  it('empties the bottle', () => {
    const { log } = drink('potion-of-growth');
    const after = fold('seed', log);
    expect(after.creatures[BEARER]?.inventory.find((one) => one.id === 'potion-of-growth')).toBeUndefined();
  });
});

/**
 * The two economies the spell reading uncovered, which no other item in the
 * book prints: a count with **no morning behind it**, and a morning that gives
 * back a **stated number** rather than dice.
 *
 * Both entries had a spell blocker recorded against them and neither deserved
 * one — Knock, Heal and Resurrection are all defined — so what was really in
 * the way was the pool each prints, and each of those is sayable now.
 */
describe('a chime with ten strikes and a rod with one charge a morning', () => {
  it('strikes the chime ten times and no more, and no morning helps', () => {
    const held = wearing('chime-of-opening');
    expect(left(held, 'chime-of-opening')).toBe(10);

    const struck = unwrap(
      resolveSpell(
        fold('seed', held),
        BEARER,
        { spellId: 'knock', targets: [], item: 'chime-of-opening' },
        supply('chime'),
      ),
      'the chime striking Knock',
    );
    const after = [...held, ...struck.events];
    expect(castOf(struck.events)?.slotless).toBe('magic-item');
    expect(left(after, 'chime-of-opening')).toBe(9);

    // **`recovers: 'special'` is the page.** A `dawn` tag with no dice beside
    // it refills, so the difference between the two is ten strikes in the
    // chime's life and ten every morning.
    const morning = run(after, (s) => declareDawn(s, supply('dawn')));
    expect(left(morning, 'chime-of-opening')).toBe(9);
  });

  it('casts Heal off the rod for one charge and refuses a Resurrection it cannot pay for', () => {
    const held = wearing('rod-of-resurrection');
    expect(left(held, 'rod-of-resurrection')).toBe(5);

    const healed = unwrap(
      resolveSpell(
        fold('seed', held),
        BEARER,
        { spellId: 'heal', targets: [BEARER], item: 'rod-of-resurrection' },
        supply('heal'),
      ),
      'Heal from the rod',
    );
    const after = [...held, ...healed.events];
    expect(castOf(healed.events)?.slotless).toBe('magic-item');
    expect(left(after, 'rod-of-resurrection')).toBe(4);

    // "_Resurrection_ (expends 5 charges)", and four is not five — which is
    // the whole reason the rod needs two prices on one pool.
    const raised = resolveSpell(
      fold('seed', after),
      BEARER,
      { spellId: 'resurrection', targets: [OTHER], item: 'rod-of-resurrection' },
      supply('raise'),
    );
    expect(isErr(raised) && raised.code).toBe('exhausted');
  });

  /**
   * "The rod regains 1 expended charge daily at dawn" — a **stated** number,
   * which `regainsAtDawn` refused until it learned to read one, and which
   * leaving the field off would have turned into a full refill.
   */
  it('gives back exactly one charge a morning, however many are gone', () => {
    const spent = run(wearing('rod-of-resurrection'), (s) =>
      expendCharges(s, SRD_CONTENT, BEARER, 'rod-of-resurrection', 4),
    );
    expect(left(spent, 'rod-of-resurrection')).toBe(1);

    const morning = run(spent, (s) => declareDawn(s, supply('dawn')));
    expect(left(morning, 'rod-of-resurrection')).toBe(2);

    const second = run(morning, (s) =>
      declareDawn(s, supply('dawn-again'), { commandId: 'day-two' }),
    );
    expect(left(second, 'rod-of-resurrection')).toBe(3);
  });
});

/**
 * The four wands the definitions freed, and the clause that was never a
 * blocker.
 *
 * Every wand in the family prints "If you expend the wand's last charge, roll
 * 1d20. On a 1, the wand crumbles into ashes and is destroyed", and the Wand
 * of Fireballs and the Wand of Web have carried it as an `unmodelled` note
 * since they were written — nothing removes a line from an inventory, so the
 * record is a wand that lasts *longer* than the book's rather than one that
 * does more. Four others were filed as **blocked** on the same sentence while
 * their real blocker was a missing spell; six definitions later, Polymorph,
 * Lightning Bolt, Hold Monster, Hold Person, Command and Fear all exist, and
 * each wand is the Wand of Web's record with the numbers changed.
 */
describe('the four wands whose remainder was a note', () => {
  /** All four carry the crumble as a note, and none of them as a grant. */
  it('records the crumble the way the two transcribed wands already did', () => {
    for (const id of [
      'wand-of-polymorph',
      'wand-of-lightning-bolts',
      'wand-of-binding',
      'wand-of-fear',
    ]) {
      expect(
        (SRD_CONTENT.item(id)?.unmodelled ?? []).join(' '),
        `${id} says nothing about destroying itself`,
      ).toContain('the wand crumbles into ashes and is destroyed');
    }
  });

  it('casts a tracked Polymorph off the wand against the wand’s own fifteen', () => {
    const held = wearing('wand-of-polymorph');
    expect(left(held, 'wand-of-polymorph')).toBe(7);
    const { log, out } = castFrom('wand-of-polymorph', 'polymorph', { targets: [OTHER] });
    expect(castOf(out.events)?.slotless).toBe('magic-item');
    expect(ongoingSpellOf(fold('seed', log), out.castingId!)?.numbers.saveDc).toBe(15);
    expect(left(log, 'wand-of-polymorph')).toBe(6);
  });

  /**
   * Two prices on one pool, out of the wand's own table — and the two
   * parentheticals beside them are notes, because each leaves the wand weaker
   * than the page rather than stronger.
   */
  it('prices Command at one charge and Fear at three off one pool', () => {
    // The tenth stated fact, which a wand's casting states exactly as a
    // cleric's does: SRD Command prints five words and the engine speaks none
    // of them.
    const commanded = castFrom('wand-of-fear', 'command', {
      targets: [OTHER],
      // Grovel rather than Halt: Halt's rule ends at the end of the target's
      // next turn, and nobody in this fixture has rolled Initiative.
      option: 'grovel',
    });
    expect(left(commanded.log, 'wand-of-fear')).toBe(6);

    const frightened = unwrap(
      resolveSpell(
        fold('seed', commanded.log),
        BEARER,
        {
          spellId: 'fear',
          targets: [],
          // A Cone starts at the caster and is only pointed, which is the
          // area the wand would have widened.
          towards: { x: 140, y: 100, z: 0 },
          item: 'wand-of-fear',
          commandId: 'the-cone',
        },
        supply('fear'),
      ),
      'Fear from the wand',
    );
    expect(left([...commanded.log, ...frightened.events], 'wand-of-fear')).toBe(3);

    // "*Fear* (60-foot Cone)" widens the spell and the record does not, which
    // is why it is a note: the casting fills Fear's own Cone.
    expect(SRD_CONTENT.item('wand-of-fear')?.unmodelled?.join(' ')).toContain('60-foot Cone');
  });

  it('spends up to three charges on one Lightning Bolt, and binds for five', () => {
    const bolt = unwrap(
      resolveSpell(
        fold('seed', wearing('wand-of-lightning-bolts')),
        BEARER,
        {
          spellId: 'lightning-bolt',
          targets: [],
          towards: { x: 180, y: 100, z: 0 },
          item: 'wand-of-lightning-bolts',
          charges: 3,
        },
        supply('bolt'),
      ),
      'Lightning Bolt from the wand',
    );
    expect(left([...wearing('wand-of-lightning-bolts'), ...bolt.events], 'wand-of-lightning-bolts'))
      .toBe(4);

    // And the Wand of Binding's two prices, the dearer of them first: five
    // out of seven, then two, off one pool and down to nothing.
    const bound = castFrom('wand-of-binding', 'hold-monster', { targets: [OTHER] });
    expect(left(bound.log, 'wand-of-binding')).toBe(2);
    const cheaper = unwrap(
      resolveSpell(
        fold('seed', bound.log),
        BEARER,
        {
          spellId: 'hold-person',
          targets: [OTHER],
          item: 'wand-of-binding',
          commandId: 'the-cheaper-one',
        },
        supply('hold'),
      ),
      'Hold Person from the wand',
    );
    expect(left([...bound.log, ...cheaper.events], 'wand-of-binding')).toBe(0);
  });
});
