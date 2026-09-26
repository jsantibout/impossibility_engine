import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import {
  DAMAGE_TYPES,
  asCharacterId,
  isErr,
  expect as unwrap,
  type CharacterId,
  type ConditionName,
  type Result,
} from '@ie/shared';
import {
  advanceTime,
  armorClassOf,
  attuneItem,
  awardItems,
  beginRest,
  chargesLeft,
  createCharacter,
  createRng,
  createRollIssuer,
  declareDawn,
  declaredCasting,
  equipItem,
  fold,
  itemConferral,
  resolveAttack,
  resolveFall,
  resolveSpell,
  resolveTurn,
  rollImprovisedDamage,
  speedOf,
  spellSlotKey,
  takeUtilize,
  useItem,
  type CharacterChoices,
  type CharacterSheet,
  type GameEvent,
  type GameState,
  type Rng,
} from '@ie/engine';
import { repeatImprovements } from './advancement-slots.js';

/**
 * Treasure the engine could already hand over: every record below is a
 * `standing` grant reached by wearing and attuning, or a `confers` grant
 * reached by using the thing, and none of them casts.
 *
 * Each is driven through the door a player holds — `useItem` for a conferral,
 * `equipItem` then `attuneItem` for a standing grant — because `checkContent`
 * accepting a record says only that it is well formed, not that it does what
 * the page says. Where the page prints a number the engine rolls, the test
 * holds the roll to the range or to the relation the page states and never to
 * a face.
 */

const id = (s: string) => asCharacterId(s);
const USER = id('user');
const FOE = id('foe');

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 5,
  abilities: { str: 14, dex: 14, con: 12, int: 10, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'int',
  weaponProficiencies: ['simple', 'martial'],
  ...over,
});

const added = (who: CharacterId, over: Partial<CharacterSheet> = {}): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(over),
  maxHp: 120,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side: who === FOE ? 'foes' : 'party',
});

/** A supply whose issuer carries on from the log, so no two rolls share an id. */
const supply = (state: GameState, seed = 'treasure') => ({
  issuer: createRollIssuer('r', state.rollsIssued),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

type Emitted = readonly GameEvent[] | { readonly events: readonly GameEvent[] };
const eventsOf = (value: Emitted): readonly GameEvent[] =>
  Array.isArray(value) ? value : (value as { readonly events: readonly GameEvent[] }).events;

const run = (
  log: readonly GameEvent[],
  command: (s: GameState) => Result<Emitted>,
  label = 'command',
): readonly GameEvent[] => [...log, ...eventsOf(unwrap(command(fold('seed', log)), label))];

/** A log built on first use, so a missing record fails its own tests rather than the file. */
const lazy = <T,>(build: () => T): (() => T) => {
  let built: { readonly value: T } | null = null;
  return () => (built ??= { value: build() }).value;
};

/** The foe casts at whoever is named, so it carries slots and a spell list. */
const FOE_CASTS: readonly GameEvent[] = [
  {
    type: 'spellcasting-declared',
    id: FOE,
    spellcasting: declaredCasting({
      ability: 'int',
      cantrips: ['fire-bolt'],
      prepared: ['contagion', 'blindness-deafness', 'hold-person'],
    }),
  },
  ...[1, 2, 3, 4, 5].map(
    (level): GameEvent => ({
      type: 'resource-pool-declared',
      id: FOE,
      pool: { key: spellSlotKey(level), label: `level ${level}`, max: 4, recovers: 'long-rest' },
    }),
  ),
];

const TABLE: readonly GameEvent[] = [
  added(USER),
  added(FOE, { abilities: { str: 10, dex: 10, con: 10, int: 18, wis: 10, cha: 10 } }),
  ...FOE_CASTS,
  { type: 'scene-set', extent: { width: 400, depth: 400, height: 60 } },
  { type: 'landmark-added', name: 'the vault', at: { x: 100, y: 100, z: 0 } },
  { type: 'creature-placed', id: USER, placement: { from: { landmark: 'the vault' }, feet: 0 } },
  { type: 'creature-placed', id: FOE, placement: { from: { creature: USER }, feet: 5, bearing: 90 } },
  { type: 'sight-declared', from: FOE, to: USER, seen: true },
  { type: 'sight-declared', from: USER, to: FOE, seen: true },
];

/** Handed over by the door that labels a copy, so a charged item has its pool. */
const awarded = (log: readonly GameEvent[], itemId: string, who: CharacterId = USER) =>
  run(log, (s) => awardItems(s, supply(s, 'hoard'), who, [{ id: itemId }], 'the hoard'), 'award');

/** Put on, rested over and attuned: the whole path the bracket asks for. */
const attunedTo = (log: readonly GameEvent[], itemId: string, who: CharacterId = USER) =>
  run(
    run(
      run(log, (s) => equipItem(s, SRD_CONTENT, who, itemId), 'equip'),
      (s) => beginRest(s, who, 'short'),
      'rest',
    ),
    (s) => attuneItem(s, SRD_CONTENT, who, itemId),
    'attune',
  );

const drink = (log: readonly GameEvent[], itemId: string, seed = 'drink') =>
  run(log, (s) => useItem(s, USER, { item: itemId }, supply(s, seed)), itemId);

const conditionsOf = (log: readonly GameEvent[], who: CharacterId = USER) =>
  fold('seed', log).creatures[who]?.conditions.conditions ?? [];

/** The mode the user's saving throw against one of the foe's spells came out under. */
const saveModeAgainst = (
  log: readonly GameEvent[],
  spellId: string,
  extra: Record<string, unknown> = {},
): string | undefined => {
  const state = fold('seed', log);
  return unwrap(
    resolveSpell(state, FOE, { spellId, targets: [USER], ...extra } as never, supply(state, spellId)),
    spellId,
  ).outcomes[0]?.save?.mode;
};

// — the four partials whose notes went stale ——————————————————————————————————

/**
 * SRD Periapt of Health: "In addition, you have Advantage on saving throws to
 * avoid or end the Poisoned condition while you wear this pendant."
 *
 * The axis Fey Ancestry took — a saving throw selected by what it is about —
 * worn and attuned. The pair is the assertion: the pendant reaches the save a
 * poison forces and not the wearer's other Constitution saves.
 */
describe('Periapt of Health: Advantage against the Poisoned condition', () => {
  const worn = lazy(() => attunedTo(awarded(TABLE, 'periapt-of-health'), 'periapt-of-health'));

  it('is complete', () => {
    expect(SRD_CONTENT.item('periapt-of-health')?.unmodelled).toBeUndefined();
  });

  it('gives Advantage on the save a poisoning spell forces', () => {
    expect(saveModeAgainst(worn(), 'contagion', { slotLevel: 5 })).toBe('advantage');
    expect(saveModeAgainst(TABLE, 'contagion', { slotLevel: 5 })).toBe('normal');
  });

  it('does not reach a Constitution save about anything else', () => {
    expect(saveModeAgainst(worn(), 'blindness-deafness', { slotLevel: 2, choice: 'blinded' })).toBe(
      'normal',
    );
  });

  it('waits for the attunement the bracket prints', () => {
    const merelyWorn = run(awarded(TABLE, 'periapt-of-health'), (s) =>
      equipItem(s, SRD_CONTENT, USER, 'periapt-of-health'),
    );
    expect(saveModeAgainst(merelyWorn, 'contagion', { slotLevel: 5 })).toBe('normal');
  });
});

/**
 * SRD Potion of Speed: "you gain the effect of the _Haste_ spell for 1 minute
 * (no Concentration required) without suffering the wave of lethargy that
 * typically occurs when the effect ends."
 *
 * Haste's four effects out of a bottle. Driven in a fight, because the extra
 * action is minted at a turn's start, and the one-attack parenthesis is only
 * visible beside a Fighter's own Extra Attack.
 */
describe('Potion of Speed: Haste out of a bottle, and no lethargy after', () => {
  const FIGHTER = USER;
  const FIGHT: readonly GameEvent[] = [
    added(FIGHTER, { attacksPerAction: 2 }),
    added(FOE),
    { type: 'items-gained', id: FIGHTER, items: [{ id: 'longsword', quantity: 1 }, { id: 'potion-of-speed', quantity: 1 }], source: 'the kit' },
    { type: 'item-equipped', id: FIGHTER, item: 'longsword', armor: null },
    { type: 'scene-set', extent: { width: 400, depth: 400, height: 40 } },
    { type: 'landmark-added', name: 'the yard', at: { x: 100, y: 100, z: 0 } },
    { type: 'creature-placed', id: FIGHTER, placement: { from: { landmark: 'the yard' }, feet: 0 } },
    { type: 'creature-placed', id: FOE, placement: { from: { creature: FIGHTER }, feet: 5, bearing: 0 } },
    {
      type: 'combat-started',
      combatants: [
        { id: FIGHTER, initiative: 20, speed: 30 },
        { id: FOE, initiative: 10, speed: 30 },
      ],
    },
  ];

  const turnTo = (log: readonly GameEvent[], who: CharacterId): readonly GameEvent[] => {
    let current = log;
    for (let guard = 0; guard < 6; guard += 1) {
      const combat = fold('seed', current).combat;
      if (combat !== null && combat.order[combat.turnIndex]?.id === who) return current;
      current = run(current, (s) => resolveTurn(s, supply(s, 'turn')), 'turn');
    }
    throw new Error(`the order never reached ${who}`);
  };

  const swing = (log: readonly GameEvent[]): { log: readonly GameEvent[]; code: string | null } => {
    const state = fold('seed', log);
    const out = resolveAttack(
      state,
      FIGHTER,
      { target: FOE, weapon: 'longsword', attackBonuses: [{ source: 'the test insists', flat: 40 }] },
      supply(state, 'swing'),
    );
    if (isErr(out)) return { log, code: out.code };
    return { log: [...log, ...unwrap(out, 'swing').events], code: null };
  };

  const nextTurn = lazy(() => turnTo(turnTo(drink(FIGHT, 'potion-of-speed'), FOE), FIGHTER));

  it('is complete', () => {
    expect(SRD_CONTENT.item('potion-of-speed')?.unmodelled).toBeUndefined();
  });

  it('doubles the drinker’s Speed', () => {
    expect(speedOf(fold('seed', FIGHT), FIGHTER)).toBe(30);
    expect(speedOf(fold('seed', nextTurn()), FIGHTER)).toBe(60);
  });

  it('mints Haste’s extra action at the turn’s start, capped at one attack', () => {
    const extras = fold('seed', nextTurn()).combat?.budgets[FIGHTER]?.extraActions ?? [];
    expect(extras).toEqual([
      {
        // The item's name, as Haste's own action is minted under "Haste".
        source: SRD_CONTENT.item('potion-of-speed')?.name,
        only: ['attack', 'dash', 'disengage', 'hide', 'utilize'],
        attacksCap: 1,
      },
    ]);

    // The Fighter's own Attack action holds two swings and the potion's holds
    // one, so the fourth swing of the turn is refused.
    let log = nextTurn();
    for (let n = 0; n < 3; n += 1) {
      const out = swing(log);
      expect(out.code, `swing ${n + 1}`).toBeNull();
      log = out.log;
    }
    expect(swing(log).code).toBe('no_attacks_left');
  });

  it('gives the Speed back after the minute, with no lethargy behind it', () => {
    const calm: readonly GameEvent[] = [
      added(FIGHTER),
      { type: 'items-gained', id: FIGHTER, items: [{ id: 'potion-of-speed', quantity: 1 }], source: 'the kit' },
    ];
    const hasted = drink(calm, 'potion-of-speed');
    expect(speedOf(fold('seed', hasted), FIGHTER)).toBe(60);

    const nearly = run(hasted, (s) => advanceTime(s, 59, 'all but'));
    expect(speedOf(fold('seed', nearly), FIGHTER)).toBe(60);

    const over = run(nearly, (s) => advanceTime(s, 1, 'the minute is up'));
    expect(speedOf(fold('seed', over), FIGHTER)).toBe(30);
    expect(conditionsOf(over, FIGHTER)).not.toContain('incapacitated');
  });
});

/**
 * SRD Potion of Gaseous Form: "you gain the effect of the _Gaseous Form_
 * spell for 1 hour (no Concentration required)". The spell's movement and
 * three of its four prohibitions, conferred rather than cast.
 */
describe('Potion of Gaseous Form: a cloud with one way to move', () => {
  const CLOUD: readonly GameEvent[] = [
    ...TABLE,
    {
      type: 'spellcasting-declared',
      id: USER,
      spellcasting: declaredCasting({ ability: 'int', cantrips: ['fire-bolt'], prepared: [] }),
    },
    { type: 'items-gained', id: USER, items: [{ id: 'club', quantity: 1 }, { id: 'potion-of-gaseous-form', quantity: 1 }], source: 'the kit' },
    {
      type: 'combat-started',
      combatants: [
        { id: USER, initiative: 20, speed: 30 },
        { id: FOE, initiative: 10, speed: 30 },
      ],
    },
  ];
  const misted = lazy(() => drink(CLOUD, 'potion-of-gaseous-form'));

  it('stays partial, and says what the drinker keeps', () => {
    const notes = SRD_CONTENT.item('potion-of-gaseous-form')?.unmodelled ?? [];
    expect(notes.length).toBeGreaterThan(0);
    expect(notes.some((note) => note.includes('as a Bonus Action'))).toBe(true);
  });

  it('leaves only a 10-foot Fly Speed, and hovers', () => {
    const state = fold('seed', misted());
    expect(speedOf(state, USER, 'fly')).toBe(10);
    expect(speedOf(state, USER)).toBe(0);
    expect(speedOf(state, USER, 'climb')).toBe(0);
    const fell = resolveFall(state, USER, {}, supply(state, 'fall'));
    expect(isErr(fell) && fell.code).toBe('hovering');
  });

  it('refuses an Attack, a casting and a Utilize', () => {
    const state = fold('seed', misted());
    const attack = resolveAttack(state, USER, { target: FOE, weapon: 'club' }, supply(state, 'swing'));
    expect(isErr(attack) && attack.code).toBe('action_forbidden');
    const cast = resolveSpell(state, USER, { spellId: 'fire-bolt', targets: [FOE] }, supply(state, 'bolt'));
    expect(isErr(cast) && cast.code).toBe('casting_forbidden');
    const utilize = takeUtilize(state, USER, { object: 'the lever' });
    expect(isErr(utilize) && utilize.code).toBe('cannot_manipulate_objects');
  });

  it('leaves a sober creature all three', () => {
    const state = fold('seed', CLOUD);
    const attack = resolveAttack(state, USER, { target: FOE, weapon: 'club' }, supply(state, 'swing'));
    expect(isErr(attack) ? attack.code : null).not.toBe('action_forbidden');
  });
});

/** SRD Potions of Healing: the table's four rows, each its own record. */
describe('Potions of Healing: every row of the table', () => {
  const ROWS = [
    ['potion-of-healing', 'Potion of Healing', 2, 4, 2],
    ['potion-of-healing-greater', 'Potion of Healing (greater)', 4, 4, 4],
    ['potion-of-healing-superior', 'Potion of Healing (superior)', 8, 4, 8],
    ['potion-of-healing-supreme', 'Potion of Healing (supreme)', 10, 4, 20],
  ] as const;

  it.each(ROWS)('%s heals its own dice', (itemId, name, count, faces, flat) => {
    const item = SRD_CONTENT.item(itemId);
    expect(item?.name).toBe(name);
    expect(item?.kind).toBe('potion');
    expect(item?.unmodelled).toBeUndefined();
    const conferral = itemConferral(item!);
    expect(conferral?.action).toBe('bonus-action');

    const wounded: readonly GameEvent[] = [
      added(USER),
      { type: 'items-gained', id: USER, items: [{ id: itemId, quantity: 1 }], source: 'the hoard' },
      { type: 'damage-taken', id: USER, amount: 110, source: 'a long fall' } as GameEvent,
    ];
    const before = fold('seed', wounded).creatures[USER]!.vitals.hp;
    const healed = drink(wounded, itemId);
    const gained = fold('seed', healed).creatures[USER]!.vitals.hp - before;
    // The page's dice, as a range: nothing here asserts a face the engine threw.
    expect(gained).toBeGreaterThanOrEqual(count + flat);
    expect(gained).toBeLessThanOrEqual(count * faces + flat);
    expect(fold('seed', healed).creatures[USER]!.inventory).toEqual([]);
  });
});

// — a reason that is now false ———————————————————————————————————————————————

/**
 * SRD Plate Armor of Etherealness: "Armor (Half Plate Armor or Plate Armor)".
 * The Half Plate version is its own record on its own row.
 */
describe('Plate Armor of Etherealness: the Half Plate version', () => {
  it('is Half Plate’s Armor Class, and Plate’s is Plate’s', () => {
    const acIn = (itemId: string): number => {
      const log = run(awarded([added(USER)], itemId), (s) => equipItem(s, SRD_CONTENT, USER, itemId));
      return armorClassOf(fold('seed', log), USER);
    };
    expect(acIn('half-plate-armor-of-etherealness')).toBe(acIn('half-plate-armor'));
    expect(acIn('plate-armor-of-etherealness')).toBe(acIn('plate-armor'));
    expect(acIn('half-plate-armor-of-etherealness')).not.toBe(acIn('plate-armor'));
  });

  it('carries the same casting and the same notes as the Plate one, save the version', () => {
    const half = SRD_CONTENT.item('half-plate-armor-of-etherealness');
    const plate = SRD_CONTENT.item('plate-armor-of-etherealness');
    expect(half?.attunement).toEqual({});
    expect(half?.grants?.map((grant) => grant.kind)).toEqual(['pool', 'casts']);
    expect(half?.unmodelled).toEqual(plate?.unmodelled);
    for (const item of [half, plate]) {
      expect(item?.unmodelled?.some((note) => note.includes('Half Plate version'))).toBe(false);
    }
  });
});

// — new records ———————————————————————————————————————————————————————————————

/**
 * SRD Elixir of Health: "the following conditions end on you: Blinded,
 * Deafened, Paralyzed, and Poisoned." A Paralyzed creature cannot lift a
 * flask, so a companion administers it, which the book allows.
 */
describe('Elixir of Health: four conditions end', () => {
  const ALLY = id('ally');
  const FOUR: readonly ConditionName[] = ['blinded', 'deafened', 'paralyzed', 'poisoned'];
  const afflicted: readonly GameEvent[] = [
    added(USER),
    added(ALLY),
    { type: 'scene-set', extent: { width: 100, depth: 100, height: 20 } },
    { type: 'landmark-added', name: 'the cot', at: { x: 50, y: 50, z: 0 } },
    { type: 'creature-placed', id: USER, placement: { from: { landmark: 'the cot' }, feet: 0 } },
    { type: 'creature-placed', id: ALLY, placement: { from: { creature: USER }, feet: 5, bearing: 0 } },
    { type: 'items-gained', id: ALLY, items: [{ id: 'elixir-of-health', quantity: 1 }], source: 'the hoard' },
    ...FOUR.map(
      (condition): GameEvent => ({ type: 'condition-applied', id: USER, condition, source: `a ${condition} curse` }),
    ),
    { type: 'condition-applied', id: USER, condition: 'frightened', source: 'a bad dream' },
  ];

  it('is complete', () => {
    expect(SRD_CONTENT.item('elixir-of-health')?.unmodelled).toBeUndefined();
  });

  it('ends Blinded, Deafened, Paralyzed and Poisoned, and nothing else', () => {
    for (const condition of FOUR) expect(conditionsOf(afflicted)).toContain(condition);
    const cured = run(
      afflicted,
      (s) => useItem(s, ALLY, { item: 'elixir-of-health', target: USER }, supply(s, 'elixir')),
      'administer',
    );
    for (const condition of FOUR) expect(conditionsOf(cured), condition).not.toContain(condition);
    expect(conditionsOf(cured)).toContain('frightened');
  });
});

/** SRD Potion of Invulnerability: "you have Resistance to all damage." */
describe('Potion of Invulnerability: Resistance to every type, for a minute', () => {
  const drunk = lazy(() => drink(
    [added(USER), { type: 'items-gained', id: USER, items: [{ id: 'potion-of-invulnerability', quantity: 1 }], source: 'the hoard' }],
    'potion-of-invulnerability',
  ));

  it('is complete', () => {
    expect(SRD_CONTENT.item('potion-of-invulnerability')?.unmodelled).toBeUndefined();
  });

  it.each([...DAMAGE_TYPES])('halves %s', (damageType) => {
    const state = fold('seed', drunk());
    const hurt = unwrap(
      rollImprovisedDamage(state, USER, { dice: '4d6', damageType, source: 'a trap' }, supply(state, damageType)),
      damageType,
    );
    expect(hurt.amount).toBe(Math.floor(hurt.rolled / 2));
  });

  it('runs out after the minute', () => {
    const over = run(drunk(), (s) => advanceTime(s, 60, 'the minute is up'));
    const state = fold('seed', over);
    const hurt = unwrap(
      rollImprovisedDamage(state, USER, { dice: '4d6', damageType: 'fire', source: 'a trap' }, supply(state, 'late')),
      'late',
    );
    expect(hurt.amount).toBe(hurt.rolled);
  });
});

/** SRD Necklace of Adaptation: "Advantage on saving throws made to avoid or end the Poisoned condition." */
describe('Necklace of Adaptation: as the Periapt', () => {
  const worn = lazy(() => attunedTo(awarded(TABLE, 'necklace-of-adaptation'), 'necklace-of-adaptation'));

  it('is complete', () => {
    expect(SRD_CONTENT.item('necklace-of-adaptation')?.unmodelled).toBeUndefined();
  });

  it('gives Advantage against a poisoning and not against a blinding', () => {
    expect(saveModeAgainst(worn(), 'contagion', { slotLevel: 5 })).toBe('advantage');
    expect(saveModeAgainst(worn(), 'blindness-deafness', { slotLevel: 2, choice: 'blinded' })).toBe(
      'normal',
    );
  });
});

/** SRD Potion of Flying: "a Fly Speed equal to your Speed for 1 hour and can hover." */
describe('Potion of Flying', () => {
  const drunk = lazy(() => drink(
    [...TABLE, { type: 'items-gained', id: USER, items: [{ id: 'potion-of-flying', quantity: 1 }], source: 'the hoard' }],
    'potion-of-flying',
  ));

  it('gives a Fly Speed equal to the walking Speed, and hovers', () => {
    const state = fold('seed', drunk());
    expect(speedOf(state, USER, 'fly')).toBe(speedOf(state, USER));
    expect(speedOf(state, USER, 'fly')).toBe(30);
    const fell = resolveFall(state, USER, {}, supply(state, 'fall'));
    expect(isErr(fell) && fell.code).toBe('hovering');
  });

  it('lasts the hour and no longer', () => {
    const over = run(drunk(), (s) => advanceTime(s, 3600, 'the hour is up'));
    expect(speedOf(fold('seed', over), USER, 'fly')).toBe(0);
  });
});

/** SRD Potion of Climbing: "a Climb Speed equal to your Speed for 1 hour." */
describe('Potion of Climbing', () => {
  it('gives a Climb Speed equal to the walking Speed', () => {
    const drunk = drink(
      [added(USER), { type: 'items-gained', id: USER, items: [{ id: 'potion-of-climbing', quantity: 1 }], source: 'the hoard' }],
      'potion-of-climbing',
    );
    const state = fold('seed', drunk);
    expect(speedOf(state, USER, 'climb')).toBe(30);
    expect(speedOf(state, USER, 'fly')).toBe(0);
  });
});

/**
 * SRD Winged Boots: "These boots have 4 charges and regain 1d4 expended
 * charges daily at dawn. While wearing the boots, you can take a Magic action
 * to expend 1 charge, gaining a Fly Speed of 30 feet for 1 hour."
 */
describe('Winged Boots: a charge buys an hour of flight', () => {
  const BOOTS = 'winged-boots';
  const worn = lazy(() => attunedTo(awarded(TABLE, BOOTS), BOOTS));

  it('spends a charge on a 30-foot Fly Speed that does not hover', () => {
    expect(chargesLeft(fold('seed', worn()), SRD_CONTENT, USER, BOOTS)).toBe(4);
    const flying = drink(worn(), BOOTS);
    const state = fold('seed', flying);
    expect(speedOf(state, USER, 'fly')).toBe(30);
    expect(chargesLeft(state, SRD_CONTENT, USER, BOOTS)).toBe(3);
    expect(state.creatures[USER]!.equipped.map((one) => one.id)).toContain(BOOTS);
    const fell = resolveFall(state, USER, {}, supply(state, 'fall'));
    expect(isErr(fell) ? fell.code : null).not.toBe('hovering');
  });

  it('runs dry at four and regains 1d4 at a declared dawn', () => {
    let log = worn();
    for (let n = 0; n < 4; n += 1) log = drink(log, BOOTS, `use ${n}`);
    expect(chargesLeft(fold('seed', log), SRD_CONTENT, USER, BOOTS)).toBe(0);
    const dry = useItem(fold('seed', log), USER, { item: BOOTS }, supply(fold('seed', log), 'dry'));
    expect(isErr(dry)).toBe(true);

    const morning = run(log, (s) => declareDawn(s, supply(s, 'dawn')), 'dawn');
    const regained = chargesLeft(fold('seed', morning), SRD_CONTENT, USER, BOOTS);
    expect(regained).toBeGreaterThanOrEqual(1);
    expect(regained).toBeLessThanOrEqual(4);
  });

  it('refuses a wearer who has not attuned', () => {
    const merelyWorn = run(awarded(TABLE, BOOTS), (s) => equipItem(s, SRD_CONTENT, USER, BOOTS));
    const refused = useItem(fold('seed', merelyWorn), USER, { item: BOOTS }, supply(fold('seed', merelyWorn)));
    expect(isErr(refused) && refused.code).toBe('not_attuned');
  });
});

/**
 * SRD Robe of the Archmagi: "_Magic Resistance._ You have Advantage on saving
 * throws against spells and other magical effects. _War Mage._ Your spell save
 * DC and spell attack bonus each increase by 2."
 */
describe('Robe of the Archmagi', () => {
  const ROBE = 'robe-of-the-archmagi';
  const WIZARD = USER;

  const wizard = (): CharacterChoices => ({
    name: 'Ilbert',
    classId: 'wizard',
    level: 5,
    subclassId: 'evoker',
    speciesId: 'human',
    backgroundId: 'sage',
    languages: ['Dwarvish', 'Orc'],
    alignment: 'Neutral',
    backgroundEquipment: 'A',
    classEquipment: 'A',
    equipped: [],
    hitPoints: { method: 'fixed' },
    dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
    abilities: {
      method: 'standard-array',
      assignment: { str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 10 },
    },
    abilityIncreases: { con: 2, wis: 1 },
    classSkills: ['arcana', 'history'],
    cantrips: ['fire-bolt', 'ray-of-frost', 'shocking-grasp', 'acid-splash'],
    spellbook: [
      'burning-hands',
      'charm-person',
      'thunderwave',
      'magic-missile',
      'shield',
      'sleep',
      'hold-person',
      'shatter',
      'misty-step',
      'invisibility',
      'fireball',
      'fly',
      'counterspell',
      'haste',
    ].map((spellId, index) => ({
      spellId,
      acquiredAt: index < 6 ? 1 : Math.ceil((index - 5) / 2) + 1,
      origin: 'level' as const,
    })),
    preparedSpells: [
      'burning-hands',
      'charm-person',
      'thunderwave',
      'magic-missile',
      'shield',
      'hold-person',
      'shatter',
      'fireball',
      'fly',
    ],
    featureChoices: {
      'human:skillful': ['perception'],
      'wizard:scholar': ['arcana'],
      'evoker:evocation-savant': ['chromatic-orb', 'scorching-ray'],
    },
    feats: {
      'sage:magic-initiate-wizard': {
        featId: 'magic-initiate',
        spellList: 'wizard',
        spellcastingAbility: 'int',
        cantrips: ['mage-hand', 'light'],
        levelOneSpell: 'find-familiar',
      },
      'human:versatile': { featId: 'alert' },
      'wizard:ability-score-improvement': { featId: 'savage-attacker' },
      ...repeatImprovements('wizard', 5),
    },
  });

  const STUDY: readonly GameEvent[] = [
    ...unwrap(createCharacter(SRD_CONTENT, wizard(), WIZARD), 'create'),
    added(FOE, { abilities: { str: 10, dex: 10, con: 10, int: 18, wis: 10, cha: 10 } }),
    ...FOE_CASTS,
    { type: 'scene-set', extent: { width: 400, depth: 400, height: 60 } },
    { type: 'landmark-added', name: 'the tower', at: { x: 100, y: 100, z: 0 } },
    { type: 'creature-placed', id: WIZARD, placement: { from: { landmark: 'the tower' }, feet: 0 } },
    { type: 'creature-placed', id: FOE, placement: { from: { creature: WIZARD }, feet: 10, bearing: 90 } },
    { type: 'sight-declared', from: FOE, to: WIZARD, seen: true },
    { type: 'sight-declared', from: WIZARD, to: FOE, seen: true },
  ];
  const robed = lazy(() => attunedTo(awarded(STUDY, ROBE), ROBE));

  /** The DC the wizard's Hold Person pins, read off the save the foe made. */
  const dcOf = (log: readonly GameEvent[]): number | undefined => {
    const state = fold('seed', log);
    return unwrap(
      resolveSpell(state, WIZARD, { spellId: 'hold-person', targets: [FOE] }, supply(state, 'hold')),
      'hold person',
    ).outcomes[0]?.save?.dc;
  };

  it('raises the wearer’s spell save DC by 2', () => {
    const bare = dcOf(STUDY);
    expect(bare).toBeDefined();
    expect(dcOf(robed())).toBe(bare! + 2);
  });

  it('gives Advantage on a save against a spell', () => {
    expect(saveModeAgainst(robed(), 'hold-person')).toBe('advantage');
    expect(saveModeAgainst(STUDY, 'hold-person')).toBe('normal');
  });

  it('refuses attunement to a creature of none of the three classes', () => {
    const given = awarded(TABLE, ROBE);
    const resting = run(
      run(given, (s) => equipItem(s, SRD_CONTENT, USER, ROBE)),
      (s) => beginRest(s, USER, 'short'),
    );
    const refused = attuneItem(fold('seed', resting), SRD_CONTENT, USER, ROBE);
    expect(isErr(refused) && refused.code).toBe('prerequisite_unmet');
  });
});
