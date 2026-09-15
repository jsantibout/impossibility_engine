/**
 * How `fixtures/golden-log-2.json` was built. **Not a step in the build.**
 *
 * The same contract as `make-golden-log.ts` and for the same reason: the
 * fixture's whole value is that nothing regenerates it. Re-running this to
 * make `persistence-2.test.ts` pass turns a compatibility test into a rubber
 * stamp.
 *
 * **Why a second one.** The first fixture is 93 events across 35 types, and it
 * was written before most of the engine existed. The whole-engine audit of
 * 2026-09-13 (§3.5) counted what that leaves unwatched: 56 of the 91 event
 * types had no compatibility fixture at all, and among them is every event
 * that carries the state a fold reconstructs for the five reaction windows,
 * the interruptible casting, the ongoing record, a moved area origin and the
 * area-trigger debt queue. A schema change to any of them passed every test.
 *
 * So this scenario is deliberately *wide* rather than deep: it is not a better
 * fight than the first fixture's, it is a fight that touches the subsystems the
 * first fixture predates. Where the two overlap, the first one is the
 * authority; this one exists for the other 56.
 *
 * **Hand-written events are part of the log format, not a shortcut.** Nine of
 * the ninety-one types are emitted by no command in the engine — they are
 * facts a DM declares rather than outcomes the engine computes, and the suite
 * writes them by hand everywhere it needs them:
 *
 * | Type | Why no command emits it |
 * |---|---|
 * | `creature-side-declared` | allegiance is declared, like cover and sight |
 * | `mounted`, `dismounted` | getting on a horse is not adjudicated |
 * | `free-interaction-used` | the free object interaction is bookkeeping |
 * | `initiative-swapped` | Alert's swap is recorded, never decided |
 * | `stabilised` | a Medicine check the DM called for |
 * | `creature-died` | death that is not hit-point loss |
 * | `items-lost` | the DM taking something away |
 * | `bonus-removed` | a bonus whose source was not a casting |
 *
 * Each is still a reducer case, and a fold has to keep handling it — which is
 * exactly what a compatibility fixture is for.
 *
 * `creature-added` is **not** in that list and is hand-written here for a
 * different reason: `createCharacter` emits one, so a command does exist — but
 * only for a creature built from choices. A thug, a rat and a pony came from
 * no character sheet, and that is the case the suite writes by hand.
 */
import { writeFileSync } from 'node:fs';
import { SRD_CONTENT } from '@ie/content';
import { pathToFileURL } from 'node:url';
import { asCharacterId, expect as unwrap, type CharacterId, type Result } from '@ie/shared';
import type { CharacterSheet } from '../src/character.js';
import type { Point } from '../src/positioning.js';
import { createRng, restoreRng } from '../src/dice.js';
import { createRollIssuer } from '../src/rolls.js';
import { fold, type GameEvent, type GameState } from '../src/events.js';
import { currentCombatant } from '../src/combat.js';
import { spellSlotKey } from '../src/resources.js';
import { declaredCasting } from '../src/spellcasting.js';
import { beginRest, endRest } from '../src/rest.js';
import { advanceCharacter, createCharacter, type CharacterChoices } from '../src/creation.js';
import {
  activateFeature,
  activateSpell,
  availableChecks,
  declineOpportunity,
  endFeature,
  equipItem,
  grantTemporaryHpTo,
  owedAreaEffectsOf,
  purchaseItem,
  removeCreatureEverywhere,
  resolveAttack,
  resolveAttackDamage,
  resolveDamage,
  resolveDeclaredCast,
  resolveEffectCheck,
  resolveMove,
  resolveSpell,
  resolveTest,
  resolveTurn,
  restoreResourcesOn,
  setExhaustionLevel,
  settleAreaEffects,
  settleDamage,
  settleTest,
  takeDamageReaction,
  takeDamageResponse,
  takeDash,
  takeDisengage,
  takeDodge,
  takeTestReaction,
  unequipItem,
  useRecovery,
  useSelfHeal,
} from '../src/commands.js';

const SEED = 'golden-2';

const id = (s: string) => asCharacterId(s);

// The party, three of them built from character choices so the creation and
// advancement events are real rather than transcribed.
const NYX = id('nyx'); // Rogue 5 — Uncanny Dodge
const BRAM = id('bram'); // Fighter 9 — Indomitable, Second Wind
const ZEL = id('zel'); // Sorcerer 5 — Sorcery Points, Sorcerous Restoration
const GRIM = id('grim'); // Barbarian 10 (Berserker) — Rage, Retaliation

// Declared creatures: an NPC has no class table to derive a sheet from.
const MIRA = id('mira'); // the party's cleric, spellcasting declared
const THORN = id('thorn'); // a druid, who carries the Moonbeam
const VEX = id('vex'); // the enemy caster, whose casting gets answered
const THUG = id('thug'); // somebody to be hit by
const RAT = id('rat'); // somebody to drop
const PONY = id('pony'); // something to sit on
const STRAY = id('stray'); // a lone combatant, whose leaving ends a fight

// ————————————————————————————————————————————————————————————————————————————
// The log, and the three things every step needs.
// ————————————————————————————————————————————————————————————————————————————

const log: GameEvent[] = [];

const state = (): GameState => fold(SEED, log);

const push = (events: readonly GameEvent[]): void => {
  log.push(...events);
};

/**
 * Dice resumed from the state, never restarted.
 *
 * `rollsIssued` and `rng` are recorded so a *live* session carries on its
 * sequence, and a fixture that restarted the generator on every command would
 * write a log in which the same roll ids appear over and over — which is
 * exactly the shape a RollId reference is supposed to make impossible.
 */
const supply = (flat?: number) => {
  const now = state();
  return {
    issuer: createRollIssuer('h', now.rollsIssued),
    rng: now.rng === null ? createRng(SEED) : restoreRng(now.rng),
    ...(flat === undefined ? {} : { bonuses: [{ source: 'the fixture insists', flat }] }),
    content: SRD_CONTENT,
  };
};

/** A command that hands back events, applied. */
const act = (label: string, out: Result<readonly GameEvent[]>): void => {
  push(unwrap(out, label));
};

/** A command that hands back a resolution, applied, and handed back. */
function run<T extends { readonly events: readonly GameEvent[] }>(
  label: string,
  out: Result<T>,
): T {
  const value = unwrap(out, label);
  push(value.events);
  return value;
}

/**
 * Settle whatever the last step made somebody owe.
 *
 * An owed area effect is global engine debt and the next voluntary action is
 * refused while one stands, so a scenario that walks a creature into a Web has
 * to pay before it does anything else. This is the caller doing what a tool
 * surface would do, not a shortcut around the guard.
 */
const settleDebts = (): void => {
  // A move that provoked is held open until every reactor has answered, and
  // the turn refuses to advance past it. Declining is an answer.
  for (const offer of state().pendingMove?.provoked ?? []) {
    act(
      `${offer.reactor} declines`,
      declineOpportunity(state(), offer.reactor, { commandId: `decline-${offer.reactor}-${log.length}` }),
    );
  }
  for (let n = 0; n < 12 && owedAreaEffectsOf(state()).length > 0; n += 1) {
    run('settle area effects', settleAreaEffects(state(), supply(-40)));
  }
};

/** Advance the turn, paying anything the boundary raised. */
const turn = (label: string, flat = -40): void => {
  run(label, resolveTurn(state(), supply(flat), { commandId: label }));
  settleDebts();
};

/**
 * Advance until it is `who`'s turn.
 *
 * Written as a search rather than a count because the Initiative order is not
 * the one the fixture wrote down: Alert swaps two combatants before anybody
 * acts, and a creature who leaves the fight takes a slot out of it.
 */
const until = (who: CharacterId, label: string, flat = -40): void => {
  for (let n = 0; n < 20; n += 1) {
    const combat = state().combat;
    if (combat !== null && currentCombatant(combat).id === who) return;
    turn(`${label}-${n}`, flat);
  }
  throw new Error(`the order never came round to ${who}`);
};

/** The same, a whole round later: at least one turn, then round to `who`. */
const again = (who: CharacterId, label: string, flat = -40): void => {
  turn(`${label}-first`, flat);
  until(who, label, flat);
};

// ————————————————————————————————————————————————————————————————————————————
// Act 0 — the roster
// ————————————————————————————————————————————————————————————————————————————

const ORIGIN = {
  speciesId: 'human',
  backgroundId: 'sage',
  languages: ['Dwarvish', 'Orc'],
  alignment: 'Neutral',
  spellbook: [],
  backgroundEquipment: 'A' as const,
  classEquipment: 'A' as const,
  hitPoints: { method: 'fixed' as const },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'the standard package' },
  cantrips: [],
  preparedSpells: [],
};

const SAGE_FEAT = {
  'sage:magic-initiate-wizard': {
    featId: 'magic-initiate',
    spellList: 'wizard',
    spellcastingAbility: 'int' as const,
    cantrips: ['mage-hand', 'light'],
    levelOneSpell: 'find-familiar',
  },
  'human:versatile': { featId: 'alert' },
};

/** Ability Score Improvements taken as a feat, at the levels the class prints. */
const asi = (prefix: string, level: number, at: readonly number[]): Record<string, unknown> =>
  Object.fromEntries(
    at
      .filter((n) => level >= n)
      .map((_at, index) => [
        index === 0 ? `${prefix}:ability-score-improvement` : `${prefix}:ability-score-improvement-${index + 1}`,
        { featId: 'savage-attacker' },
      ]),
  );

const rogue = (level: number): CharacterChoices => ({
  ...ORIGIN,
  name: 'Nyx',
  classId: 'rogue',
  level,
  abilities: {
    method: 'standard-array',
    assignment: { str: 8, dex: 15, con: 13, int: 14, wis: 12, cha: 10 },
  },
  abilityIncreases: { con: 2, int: 1 },
  classSkills: ['stealth', 'sleight-of-hand', 'acrobatics', 'investigation'],
  subclassId: 'thief',
  equipped: [],
  featureChoices: {
    'human:skillful': ['perception'],
    'rogue:expertise': ['stealth', 'sleight-of-hand'],
  },
  feats: { ...SAGE_FEAT, ...asi('rogue', level, [4, 8]) },
});

const fighter = (level: number): CharacterChoices => ({
  ...ORIGIN,
  name: 'Bram',
  classId: 'fighter',
  level,
  abilities: {
    method: 'standard-array',
    assignment: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 },
  },
  abilityIncreases: { int: 2, wis: 1 },
  classSkills: ['athletics', 'intimidation'],
  subclassId: 'champion',
  equipped: [],
  featureChoices: { 'human:skillful': ['perception'] },
  feats: {
    ...SAGE_FEAT,
    'fighter:fighting-style': { featId: 'defense' },
    'champion:additional-fighting-style': { featId: 'archery' },
    ...asi('fighter', level, [4, 6, 8, 12, 14, 16]),
  },
});

const sorcerer = (): CharacterChoices => ({
  ...ORIGIN,
  name: 'Zel',
  classId: 'sorcerer',
  level: 5,
  abilities: {
    method: 'standard-array',
    assignment: { str: 8, dex: 14, con: 13, int: 12, wis: 10, cha: 15 },
  },
  abilityIncreases: { con: 2, int: 1 },
  classSkills: ['arcana', 'persuasion'],
  subclassId: 'draconic-sorcery',
  equipped: [],
  cantrips: ['fire-bolt', 'ray-of-frost', 'shocking-grasp', 'acid-splash', 'light'],
  preparedSpells: [
    'burning-hands',
    'charm-person',
    'thunderwave',
    'hold-person',
    'shatter',
    'mind-spike',
    'blur',
    'fireball',
    'haste',
  ],
  featureChoices: {
    'human:skillful': ['perception'],
    'sorcerer:metamagic': ['Empowered Spell', 'Quickened Spell'],
  },
  feats: { ...SAGE_FEAT, ...asi('sorcerer', 5, [4]) },
});

const barbarian = (): CharacterChoices => ({
  ...ORIGIN,
  name: 'Grim',
  classId: 'barbarian',
  level: 10,
  abilities: {
    method: 'standard-array',
    assignment: { str: 15, dex: 14, con: 13, int: 8, wis: 12, cha: 10 },
  },
  abilityIncreases: { con: 2, wis: 1 },
  classSkills: ['athletics', 'survival'],
  subclassId: 'path-of-the-berserker',
  equipped: [],
  featureChoices: {
    'human:skillful': ['perception'],
    'barbarian:primal-knowledge': ['intimidation'],
  },
  feats: { ...SAGE_FEAT, ...asi('barbarian', 10, [4, 8]) },
});

act('create nyx', createCharacter(SRD_CONTENT,rogue(4), NYX));
act('create bram', createCharacter(SRD_CONTENT,fighter(9), BRAM));
act('create zel', createCharacter(SRD_CONTENT,sorcerer(), ZEL));
act('create grim', createCharacter(SRD_CONTENT,barbarian(), GRIM));

// The Rogue levels up in play, which is the only way a character grows: the
// differences, never a rebuild — and Uncanny Dodge, which the rest of this
// scenario leans on, arrives on that level rather than at creation.
act('nyx reaches 5', advanceCharacter(state(), SRD_CONTENT, NYX, { featureChoices: {} }));

/** A sheet for a creature that came from no character sheet. */
const npcSheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 9,
  abilities: { str: 12, dex: 14, con: 14, int: 12, wis: 18, cha: 12 },
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

const declared = (
  who: CharacterId,
  side: string,
  maxHp: number,
  over: Partial<CharacterSheet> = {},
): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: npcSheet(over),
  maxHp,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side,
});

push([
  declared(MIRA, 'party', 60),
  declared(THORN, 'party', 60),
  declared(VEX, 'foes', 60),
  declared(THUG, 'foes', 140),
  declared(RAT, 'foes', 9),
  declared(PONY, 'party', 20, { baseSpeed: 60 }),
  declared(STRAY, 'foes', 12),
]);

// Allegiance is declared, never inferred — and a class feature reads it, which
// is why the created characters get one too.
push(
  (
    [
      [NYX, 'party'],
      [BRAM, 'party'],
      [ZEL, 'party'],
      [GRIM, 'party'],
    ] as const
  ).map(([who, side]): GameEvent => ({ type: 'creature-side-declared', id: who, side })),
);

const MIRA_SPELLS = [
  'bless',
  'mage-armor',
  'dispel-magic',
  'counterspell',
  'acid-arrow',
  'web',
  'cure-wounds',
  'healing-word',
  'black-tentacles',
];

push([
  {
    type: 'spellcasting-declared',
    id: MIRA,
    spellcasting: declaredCasting({
      ability: 'wis',
      cantrips: ['sacred-flame'],
      prepared: MIRA_SPELLS,
    }),
  },
  {
    type: 'spellcasting-declared',
    id: THORN,
    spellcasting: declaredCasting({
      ability: 'wis',
      cantrips: ['sacred-flame'],
      prepared: ['moonbeam', 'grease'],
    }),
  },
  {
    type: 'spellcasting-declared',
    id: VEX,
    spellcasting: declaredCasting({
      ability: 'wis',
      cantrips: ['fire-bolt'],
      prepared: ['hold-person', 'bane'],
    }),
  },
  ...[MIRA, THORN, VEX].flatMap((who) =>
    [1, 2, 3, 4, 5].map(
      (level): GameEvent => ({
        type: 'resource-pool-declared',
        id: who,
        pool: {
          key: spellSlotKey(level),
          label: `level ${level} spell slot`,
          max: 4,
          recovers: 'long-rest',
        },
      }),
    ),
  ),
]);

// ————————————————————————————————————————————————————————————————————————————
// The room, and where everybody is standing.
// ————————————————————————————————————————————————————————————————————————————

const LANE = 300;
/** A patch of floor off the melee line, so walking onto it is a real entry. */
const GREASE: Point = { x: 250, y: 320, z: 0 };
const WHERE: ReadonlyArray<readonly [CharacterId, Point]> = [
  [MIRA, { x: 200, y: LANE, z: 0 }],
  [THORN, { x: 200, y: LANE + 10, z: 0 }],
  [ZEL, { x: 200, y: LANE - 5, z: 0 }],
  [PONY, { x: 200, y: LANE + 15, z: 0 }],
  [NYX, { x: 250, y: LANE, z: 0 }],
  [THUG, { x: 255, y: LANE, z: 0 }],
  [RAT, { x: 260, y: LANE, z: 0 }],
  [BRAM, { x: 255, y: LANE + 5, z: 0 }],
  [GRIM, { x: 250, y: LANE + 5, z: 0 }],
  [VEX, { x: 240, y: LANE + 40, z: 0 }],
  [STRAY, { x: 300, y: LANE + 40, z: 0 }],
];

push([
  { type: 'scene-set', extent: { width: 900, depth: 900, height: 60 } },
  { type: 'landmark-added', name: 'the font', at: { x: 200, y: LANE, z: 0 } },
  ...WHERE.map(
    ([who, at]): GameEvent => ({
      type: 'creature-placed',
      id: who,
      // A mount is "at least one size larger than a rider", so the pony has to
      // be Large for anybody to get on it. Size arrives with the placement,
      // which is the only thing that knows a creature occupies volume.
      placement: { from: { point: at }, feet: 0, ...(who === PONY ? { size: 'large' as const } : {}) },
    }),
  ),
]);

// Everybody can see everybody, except where the fixture says otherwise.
const EVERYONE = WHERE.map(([who]) => who);
push(
  EVERYONE.flatMap((from) =>
    EVERYONE.filter((to) => to !== from).map(
      (to): GameEvent => ({ type: 'sight-declared', from, to, seen: true }),
    ),
  ),
);
push([
  { type: 'cover-declared', from: THUG, to: MIRA, degree: 'half' },
  { type: 'creature-type-declared', id: THUG, creatureType: 'Humanoid' },
  { type: 'creature-type-declared', id: RAT, creatureType: 'Humanoid' },
  { type: 'creature-type-declared', id: VEX, creatureType: 'Humanoid' },
  { type: 'creature-type-declared', id: STRAY, creatureType: 'Humanoid' },
]);

// Kit: the thug's sword, and a purse for the cleric to spend out of.
push([
  { type: 'items-gained', id: THUG, items: [{ id: 'longsword', quantity: 1 }], source: 'the gang' },
  { type: 'item-equipped', id: THUG, item: 'longsword', armor: SRD_CONTENT.item('longsword')?.armor ?? null },
  {
    type: 'items-gained',
    id: MIRA,
    items: [
      { id: 'chain-shirt', quantity: 1 },
      { id: 'mace', quantity: 1 },
    ],
    source: 'the vestry',
  },
  { type: 'coins-changed', id: MIRA, copper: 40_000, source: 'a patron' },
]);
act('mira buys rope', purchaseItem(state(), SRD_CONTENT, MIRA, 'rope', 2, 'buy-rope'));
act('mira wears the shirt', equipItem(state(), SRD_CONTENT, MIRA, 'chain-shirt', 'wear-shirt'));
// …and takes it off again, because Mage Armor will not touch a creature in
// armour and the two facts are separate: owning is not wearing.
act('mira takes it off', unequipItem(state(), SRD_CONTENT, MIRA, 'chain-shirt', 'doff-shirt'));

// A horse, which is a relationship rather than an offset. Neither getting on
// it nor getting off it is adjudicated by anything.
push([
  { type: 'mounted', rider: THORN, mount: PONY, willing: true },
  {
    type: 'dismounted',
    rider: THORN,
    placement: { from: { point: { x: 200, y: LANE + 10, z: 0 } }, feet: 0 },
  },
]);

// ————————————————————————————————————————————————————————————————————————————
// A fight of one, which ends when its only combatant leaves.
// ————————————————————————————————————————————————————————————————————————————

push([
  { type: 'combat-started', combatants: [{ id: STRAY, initiative: 11, speed: 30 }] },
]);
act('the stray leaves', removeCreatureEverywhere(state(), STRAY, { commandId: 'stray-goes' }));

// ————————————————————————————————————————————————————————————————————————————
// Act I — the fight
// ————————————————————————————————————————————————————————————————————————————

push([
  {
    type: 'combat-started',
    combatants: [
      { id: THUG, initiative: 22, speed: 30 },
      { id: MIRA, initiative: 20, speed: 30 },
      { id: BRAM, initiative: 18, speed: 30 },
      { id: NYX, initiative: 16, speed: 30 },
      { id: ZEL, initiative: 14, speed: 30 },
      { id: GRIM, initiative: 12, speed: 30 },
      { id: THORN, initiative: 10, speed: 30 },
      { id: VEX, initiative: 8, speed: 30 },
      { id: RAT, initiative: 6, speed: 20 },
      { id: PONY, initiative: 4, speed: 60 },
    ],
  },
]);

// The free object interaction a turn gives away, which is bookkeeping the
// budget carries and nothing adjudicates — and Alert's Initiative swap, which
// creation records on the sheet and nothing in the engine decides.
push([
  { type: 'free-interaction-used', id: THUG },
  { type: 'initiative-swapped', a: NYX, b: BRAM },
]);

until(THUG, 'to-the-thug');

// — the thug swings at the Rogue, and the damage window opens ————————————————
//
// SRD Uncanny Dodge answers a damage roll that has been made and not applied,
// which is the first of the five windows and the one with durable state under
// it. The swing is forced to land so the fixture is about what follows it.
const swing = run(
  'the thug swings',
  resolveAttack(
    state(),
    THUG,
    { target: NYX, weapon: 'longsword', attackBonuses: [{ source: 'the fixture insists', flat: 40 }], commandId: 'swing-1' },
    supply(),
  ),
);
if (swing.attack?.hit !== true) throw new Error('the fixture meant that swing to land');
run(
  'nyx dodges',
  takeDamageReaction(state(), NYX, { feature: 'rogue:uncanny-dodge', commandId: 'dodge-1' }, supply()),
);
run('the blow lands', settleDamage(state(), supply(), { commandId: 'settle-1' }));

// — and the Barbarian answers the blow he took ——————————————————————————————
//
// `damaged-by-creature` is the window that holds nothing: everything is
// settled, which is why Retaliation needs no pending state at all.
run(
  'the thug hits grim',
  resolveDamage(state(), GRIM, { amount: 7, source: 'a backhand', by: THUG, commandId: 'backhand' }, supply()),
);
run(
  'grim retaliates',
  takeDamageResponse(state(), GRIM, { feature: 'berserker:retaliation', commandId: 'retaliate' }, supply(40)),
);

// — the cleric's turn: Bless ————————————————————————————————————————————————
until(MIRA, 'to-mira');
run(
  'mira blesses',
  resolveSpell(
    state(),
    MIRA,
    { spellId: 'bless', targets: [MIRA, THORN, ZEL], slotLevel: 1, commandId: 'bless-1' },
    supply(),
  ),
);

// — the Fighter's turn: a saving throw, and the window that holds it open ————
//
// `test-rolled` is the window a DM always needed and could not reach: a D20
// Test whose total is known and whose effects have not occurred.
until(BRAM, 'to-bram');
run(
  'bram saves against the fumes',
  resolveTest(state(), BRAM, { kind: 'saving-throw', ability: 'dex', dc: 40, commandId: 'save-1' }, supply()),
);
run(
  'bram is indomitable',
  takeTestReaction(state(), BRAM, { feature: 'fighter:indomitable', commandId: 'indom-1' }, supply()),
);
run('the save settles', settleTest(state(), { commandId: 'settle-test-1' }));
// Second Wind: a pool spent, which is the half of a pool nobody had built.
act('bram catches his breath', useSelfHeal(state(), BRAM, { feature: 'fighter:second-wind', commandId: 'wind-1' }, supply()));
// Second Wind is a Bonus Action, so the Action is still there to Dash with.
act('bram dashes', takeDash(state(), BRAM, { commandId: 'dash-1' }));

// — the Rogue swings, and Sneak Attack is a once-per-turn rider —————————————
//
// SRD Sneak Attack wants Advantage or "at least one of your allies within 5
// feet of the target", and Bram is standing beside the thug — which is why
// allegiance had to be declared for creatures built from character choices.
until(NYX, 'to-nyx');
run(
  'nyx stabs the thug',
  resolveAttack(
    state(),
    NYX,
    {
      target: THUG,
      weapon: 'dagger',
      attackBonuses: [{ source: 'the fixture insists', flat: 40 }],
      commandId: 'stab-1',
    },
    supply(),
  ),
);

// — the Sorcerer blurs himself, which is a standing modifier on a roll ———————
until(ZEL, 'to-zel');
run(
  'zel blurs',
  resolveSpell(state(), ZEL, { spellId: 'blur', targets: [ZEL], slotLevel: 2, commandId: 'blur-1' }, supply()),
);

// — the Barbarian rages, which is a pool, an activation and a deadline ———————
until(GRIM, 'to-grim');
act('grim rages', activateFeature(state(), GRIM, { feature: 'barbarian:rage', commandId: 'rage-1' }));
act('grim dodges', takeDodge(state(), GRIM, { commandId: 'grim-dodge' }));
act('grim stops dodging', endFeature(state(), GRIM, { feature: 'action:dodge', commandId: 'grim-undodge' }));

// — the druid greases the floor, which is a persistent area ———————————————————
until(THORN, 'to-thorn');
const grease = run(
  'thorn greases the floor',
  resolveSpell(
    state(),
    THORN,
    {
      spellId: 'grease',
      targets: [],
      at: GREASE,
      // A Cube is directional and has no Chebyshev shorthand, so it takes a
      // second point to orient it — read in the same frame as the origin,
      // which is why it is written as an offset from the origin rather than
      // from the caster.
      towards: { x: GREASE.x + 50, y: GREASE.y, z: 0 },
      slotLevel: 1,
      commandId: 'grease-1',
    },
    supply(-40),
  ),
);
settleDebts();

// — the enemy caster declares a casting, and it is answered ——————————————————
until(VEX, 'to-vex');
//
// SRD Counterspell interrupts "a creature in the process of casting a spell",
// and the process is a two-event casting: the action is spent at declaration
// and never given back, the slot is not spent at declaration at all.
run(
  'vex begins Hold Person',
  resolveSpell(
    state(),
    VEX,
    { spellId: 'hold-person', targets: [NYX], slotLevel: 2, hold: true, commandId: 'vex-hold-1' },
    supply(),
  ),
);
run(
  'mira counters it',
  resolveSpell(
    state(),
    MIRA,
    { spellId: 'counterspell', targets: [VEX], slotLevel: 3, commandId: 'counter-1' },
    supply(-40),
  ),
);

// — the rat is dropped, makes a death save, and is stabilised ————————————————
run(
  'the rat is struck down',
  resolveDamage(state(), RAT, { amount: 12, source: 'a thrown flagon', by: GRIM, commandId: 'flagon' }, supply()),
);
// The rat's own turn comes round, and the turn rolls the death save unasked.
// The bonus goes the other way here: a death save that keeps failing is three
// failures and a corpse, and the fixture wants a creature still making them.
until(RAT, 'to-the-rat', 40);
push([{ type: 'stabilised', id: RAT }]);

// ————————————————————————————————————————————————————————————————————————————
// Round two — the casting that settles, and the spells that leave a record
// ————————————————————————————————————————————————————————————————————————————

// — a hit held open between its two rolls ————————————————————————————————————
//
// SRD Divine Smite is taken "immediately after hitting a target", which is a
// window of its own: the hit is known and the damage is not rolled. Nobody
// spends anything in it here; what matters is that the log carries the hit.
again(THUG, 'thug-round-two');
run(
  'the thug holds a swing at grim',
  resolveAttack(
    state(),
    THUG,
    {
      target: GRIM,
      weapon: 'longsword',
      attackBonuses: [{ source: 'the fixture insists', flat: 40 }],
      hold: true,
      commandId: 'held-swing',
    },
    supply(),
  ),
);
run(
  'and the sword comes down',
  resolveAttackDamage(state(), THUG, { commandId: 'held-damage' }, supply()),
);

again(MIRA, 'round-two');

// Mage Armor replaces a base Armour Class rather than adding to one, and the
// grant is what Dispel Magic will come back for.
run(
  'mira armours the sorcerer',
  resolveSpell(
    state(),
    MIRA,
    { spellId: 'mage-armor', targets: [ZEL], slotLevel: 1, commandId: 'mage-armor-1' },
    supply(),
  ),
);

// A Bonus Action casting, which is a different line of the economy.
again(MIRA, 'round-three');
run(
  'mira heals the rat with a word',
  resolveSpell(
    state(),
    MIRA,
    { spellId: 'healing-word', targets: [RAT], slotLevel: 1, commandId: 'word-1' },
    supply(),
  ),
);

// …and an Acid Arrow, a turn later, because a turn holds one slot however
// many castings it holds. Its second hit is a debt the target carries.
again(MIRA, 'round-four');
run(
  'mira throws an acid arrow',
  resolveSpell(
    state(),
    MIRA,
    { spellId: 'acid-arrow', targets: [THUG], slotLevel: 2, commandId: 'acid-1' },
    supply(40),
  ),
);

// The enemy caster tries again, and this time nobody answers.
again(VEX, 'to-vex-2');
const held = run(
  'vex begins Hold Person again',
  resolveSpell(
    state(),
    VEX,
    { spellId: 'hold-person', targets: [BRAM], slotLevel: 2, hold: true, commandId: 'vex-hold-2' },
    supply(),
  ),
);
run(
  'and it lands',
  resolveDeclaredCast(state(), held.castingId, supply(-40), { commandId: 'vex-settle-2' }),
);

// — Dispel Magic, which reads the level of what it is dispelling ——————————————
again(MIRA, 'to-mira-4');
run(
  'mira dispels the armour',
  resolveSpell(
    state(),
    MIRA,
    { spellId: 'dispel-magic', targets: [ZEL], slotLevel: 3, commandId: 'dispel-1' },
    supply(),
  ),
);

// — the Rogue disengages, and walks into the grease ——————————————————————————
again(NYX, 'to-nyx-2');
act('nyx disengages', takeDisengage(state(), NYX, { commandId: 'disengage-1' }));
run(
  'nyx steps into the grease',
  resolveMove(
    state(),
    NYX,
    { placement: { from: { point: GREASE }, feet: 0 }, commandId: 'move-1' },
    supply(),
  ),
);
settleDebts();

// ————————————————————————————————————————————————————————————————————————————
// The fight breaks off, and the party rests
// ————————————————————————————————————————————————————————————————————————————

act('the pony bolts', removeCreatureEverywhere(state(), PONY, { commandId: 'pony-goes' }));

// The DM takes something away, and a bonus whose source was no casting goes
// with it. Neither is a command: both are facts somebody states.
push([
  { type: 'items-lost', id: MIRA, items: [{ id: 'rope', quantity: 1 }], source: 'left in the grease' },
  {
    type: 'bonus-applied',
    id: BRAM,
    bonus: {
      source: 'a whetstone',
      bonus: { source: 'a whetstone', flat: 1 },
      applies: ['attack'],
      direction: 'add',
    },
  },
  { type: 'bonus-removed', id: BRAM, source: 'a whetstone' },
]);

// A Short Rest, which is an hour of the clock and a span rather than a button.
push([{ type: 'time-advanced', seconds: 120, reason: 'the last of them run off' }]);
act('bram begins a short rest', beginRest(state(), BRAM, 'short', 'short-1'));
act('zel begins a short rest', beginRest(state(), ZEL, 'short', 'short-2'));
push([{ type: 'time-advanced', seconds: 3600, reason: 'an hour in the vestry' }]);
run(
  'bram ends the short rest',
  endRest(state(), BRAM, { hitDice: ['hit-die:d10'] }, supply()),
);
run('zel ends the short rest', endRest(state(), ZEL, {}, supply()));
// Sorcerous Restoration happens *when* a Short Rest finishes, and the clock is
// the finest grain the engine holds for "when" — and it needs something to give
// back. Metamagic is not executed, so the Sorcery Points go by hand: there is
// no command that spends them.
push([{ type: 'resource-spent', id: ZEL, key: 'sorcery-points', amount: 2 }]);
act(
  'zel recovers sorcery points',
  useRecovery(state(), ZEL, { feature: 'sorcerer:sorcerous-restoration', commandId: 'restore-1' }, supply()),
);
act(
  'grim gets his rage back',
  restoreResourcesOn(state(), GRIM, 'short-rest', { commandId: 'grim-short' }),
);

// Temporary Hit Points, and the Long Rest that has to clear them itself.
act('mira braces herself', grantTemporaryHpTo(state(), MIRA, 8, { commandId: 'temp-1' }));

// An interrupted Long Rest pays out on the time rested *before* the
// interruption, and the engine notices the interruption for itself.
act('grim lies down', beginRest(state(), GRIM, 'long', 'long-1'));
push([{ type: 'time-advanced', seconds: 7200, reason: 'two hours of sleep' }]);
run(
  'something bites grim',
  resolveDamage(state(), GRIM, { amount: 4, source: 'something in the dark', commandId: 'bite-1' }, supply()),
);
push([{ type: 'time-advanced', seconds: 600, reason: 'standing about afterwards' }]);
run('grim gives up on it', endRest(state(), GRIM, {}, supply()));

// And one that runs its course, which is the only thing that clears the
// Temporary Hit Points it did not give.
act('mira lies down', beginRest(state(), MIRA, 'long', 'long-2'));
push([{ type: 'time-advanced', seconds: 28_800, reason: 'eight hours' }]);
run('mira gets up', endRest(state(), MIRA, {}, supply()));

// Exhaustion is a flat penalty per level, and the sixth kills.
act('grim is worn down', setExhaustionLevel(state(), GRIM, 2, { commandId: 'exhaust-1' }));

// ————————————————————————————————————————————————————————————————————————————
// Act II — the second fight, left saved mid-encounter
// ————————————————————————————————————————————————————————————————————————————

push([
  {
    type: 'combat-started',
    combatants: [
      { id: MIRA, initiative: 21, speed: 30 },
      { id: THORN, initiative: 19, speed: 30 },
      { id: THUG, initiative: 17, speed: 30 },
      { id: BRAM, initiative: 15, speed: 30 },
      { id: NYX, initiative: 13, speed: 30 },
      { id: GRIM, initiative: 11, speed: 30 },
      { id: ZEL, initiative: 9, speed: 30 },
      { id: VEX, initiative: 7, speed: 30 },
    ],
  },
]);

until(MIRA, 'to-mira-web');

// — the cleric spins a Web, which catches a creature at a boundary and on entry
//
// SRD Web: "The first time a creature enters the webs on a turn **or** starts
// its turn there" — two clauses, and this fight drives both.
const WEB: Point = { x: 260, y: LANE, z: 0 };
const web = run(
  'mira spins a web',
  resolveSpell(
    state(),
    MIRA,
    {
      spellId: 'web',
      targets: [],
      at: WEB,
      towards: { x: WEB.x + 50, y: WEB.y, z: 0 },
      slotLevel: 2,
      commandId: 'web-1',
    },
    supply(-40),
  ),
);
settleDebts();

// — the druid conjures a Moonbeam, well clear of everybody ————————————————————
until(THORN, 'to-thorn-beam');
const BEAM: Point = { x: 290, y: LANE, z: 0 };
const beam = run(
  'thorn conjures a moonbeam',
  resolveSpell(
    state(),
    THORN,
    { spellId: 'moonbeam', targets: [], at: BEAM, slotLevel: 2, commandId: 'moonbeam-1' },
    supply(-40),
  ),
);
settleDebts();

// — the thug blunders into the web, which is the entry clause ————————————————
until(THUG, 'to-thug-2');
run(
  'the thug blunders into the web',
  resolveMove(
    state(),
    THUG,
    { placement: { from: { point: { x: 270, y: LANE, z: 0 } }, feet: 0 }, commandId: 'thug-move' },
    supply(),
  ),
);
settleDebts();

// — and a Magic action walks the beam onto him ————————————————————————————————
//
// The beam is a 5-foot-radius Cylinder, so a fifteen-foot step passes over
// cubes nobody named: the route is the caller's to state, and the legs settle
// one at a time because a casting can end halfway along one.
again(THORN, 'to-thorn-2');
run(
  'thorn sweeps the beam',
  activateSpell(
    state(),
    THORN,
    {
      castingId: beam.castingId,
      targets: [],
      to: { x: 275, y: LANE, z: 0 },
      via: [
        { x: 285, y: LANE, z: 0 },
        { x: 280, y: LANE, z: 0 },
      ],
      commandId: 'sweep-1',
    },
    supply(-40),
  ),
);
settleDebts();

// A whole round later, so the thug starts its turn in the webs — the *other*
// clause, a round apart from the one that caught it on the way in.
again(THUG, 'to-thug-start');

// — and tries to tear free, which is a check a spell offers against itself ———
const escapes = availableChecks(state(), THUG);
if (escapes.length > 0) {
  run(
    'the thug tears at the web',
    resolveEffectCheck(
      state(),
      THUG,
      { effectKey: escapes[0]!.effectKey, commandId: 'escape-1' },
      supply(40),
    ),
  );
  settleDebts();
}

// — somebody finally dies, which is not the same as dropping to 0 ————————————
push([{ type: 'creature-died', id: RAT, cause: 'the wound never closed' }]);

// — and the log stops with a damage window still open ————————————————————————
//
// A log that ends tidily folds to an empty derived state, and an empty derived
// state is the same under every rule there has ever been. So this one stops
// where the fixture is worth something: a casting concentrated on, an area
// still catching people, a paralysis repeating its save, a roll-modifier
// grant standing, and a damage roll made and not applied.
// — two grants put back, so the log is put away with both alive ——————————————
//
// The dispel above proved the release; these prove the state. A roll modifier
// and an alternative Armour Class calculation are both things a fold has to
// reconstruct from an event, and a log that ends with neither standing tests
// only the half that removes them.
until(ZEL, 'to-zel-2');
run(
  'zel blurs again',
  resolveSpell(state(), ZEL, { spellId: 'blur', targets: [ZEL], slotLevel: 2, commandId: 'blur-2' }, supply()),
);

again(MIRA, 'to-mira-armour');
run(
  'mira armours the sorcerer again',
  resolveSpell(
    state(),
    MIRA,
    { spellId: 'mage-armor', targets: [ZEL], slotLevel: 1, commandId: 'mage-armor-2' },
    supply(),
  ),
);

// — a paralysis left standing, with the save it repeats every turn ———————————
//
// The fixture is put away with this running: a casting concentrated on, a
// condition linked to it, and a timer carrying the repeat save the SRD prints
// — which is state a fold has to reconstruct and no frozen log yet held.
until(VEX, 'to-vex-3');
run(
  'vex holds the barbarian',
  resolveSpell(
    state(),
    VEX,
    { spellId: 'hold-person', targets: [GRIM], slotLevel: 2, commandId: 'vex-hold-3' },
    supply(-40),
  ),
);

until(NYX, 'to-nyx-3');
run(
  'nyx closes on the thug',
  resolveMove(
    state(),
    NYX,
    { placement: { from: { point: { x: 265, y: LANE, z: 0 } }, feet: 0 }, commandId: 'nyx-closes' },
    supply(),
  ),
);
settleDebts();

again(THUG, 'to-thug-3');
const last = run(
  'the thug swings at the Rogue again',
  resolveAttack(
    state(),
    THUG,
    { target: NYX, weapon: 'longsword', attackBonuses: [{ source: 'the fixture insists', flat: 40 }], commandId: 'swing-2' },
    supply(),
  ),
);
if (last.attack?.hit !== true) throw new Error('the fixture meant that swing to land too');

// ————————————————————————————————————————————————————————————————————————————

/** True when Node was asked to run this file, rather than something importing it. */
const isMainModule = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;

if (isMainModule) {
  const final = state();
  writeFileSync(process.argv[2] ?? 'golden-log-2.json', `${JSON.stringify(log, null, 2)}\n`, 'utf8');

  const used = [...new Set(log.map((e) => e.type))].sort();
  console.log(
    JSON.stringify(
      {
        events: log.length,
        types: used.length,
        usedTypes: used,
        elapsed: final.elapsed,
        round: final.combat?.round ?? null,
        castings: final.castingsBegun,
        commands: Object.keys(final.appliedCommands).length,
        timers: Object.keys(final.timers).length,
        pendingSaves: Object.keys(final.pendingSaves).length,
        ongoing: Object.keys(final.ongoing).length,
        pendingDamage: final.pendingDamage !== null,
        grease: grease.castingId,
        web: web.castingId,
        beam: beam.castingId,
        held: held.castingId,
      },
      null,
      2,
    ),
  );
}
