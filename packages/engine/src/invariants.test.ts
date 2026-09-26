import { readFileSync, readdirSync } from 'node:fs';
import { BACKGROUNDS, FIGHTING_STYLE_FEATS, ORIGIN_FEATS, SPECIES, SRD_CONTENT } from '@ie/content';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { linesOf } from '../../../test-support/lines.js';
import {
  asCharacterId,
  isErr,
  isNeedsContext,
  ok,
  contextRequestsOf,
  expect as unwrap,
  type CharacterId,
  type Result,
} from '@ie/shared';
import { featureGrants } from './progression.js';
import type { CharacterSheet, StatedAction } from './character.js';
import { createRng, type Rng, type RngState } from './dice.js';
import { createRollIssuer, type RollIssuer } from './rolls.js';
import { applyEvent, fold, type GameEvent, type GameState } from './events.js';
import { remaining, spellSlotKey } from './resources.js';
import { declaredCasting } from './spellcasting.js';
import {
  activateFeature,
  activateSpell,
  triggerGlyph,
  addCreature,
  addSceneLandmark,
  advanceTime,
  assumeShape,
  revertShape,
  awardItems,
  beginCombat,
  castSpell,
  conferReaction,
  continueCasting,
  declareCoverBetween,
  declareCreatureDead,
  declareCreatureHeads,
  declareCreatureSide,
  declareDawn,
  declareSightBetween,
  declareSpellcasting,
  dismissStrandedSummons,
  dismountRider,
  endCombat,
  joinCombat,
  loseItems,
  mountCreature,
  placeCreatureInScene,
  recordInitiativeRolls,
  removeBonusFrom,
  rollInitiativeAndBeginCombat,
  setScene,
  stabiliseCreature,
  strandedSummons,
  summonCreature,
  swapInitiativeBetween,
  transferItem,
  useFreeObjectInteraction,
  applyConditionTo,
  applySpellEffect,
  liftConditionFrom,
  damageCreature,
  declareCreatureType,
  declareDamageType,
  declareFalling,
  declareObject,
  activateDevice,
  createDevice,
  dismantleDevice,
  declareDifficultTerrain,
  declareLight,
  declareObscurement,
  declineOpportunity,
  dropConjured,
  dropItem,
  endConcentration,
  endOngoingSpell,
  endOngoingSpellOnSelf,
  detachFrom,
  escapeGrapple,
  letGoOfAttachment,
  evokeConjured,
  grappleSource,
  grappleTarget,
  shoveTarget,
  grantTemporaryHpTo,
  setExhaustionLevel,
  pendingAttackOf,
  pendingMoveOf,
  removeCreatureEverywhere,
  resolvePendingSaves,
  restoreResourcesOn,
  availableChecks,
  resolveEffectCheck,
  endFeature,
  expendCharges,
  chargesLeft,
  attuneItem,
  endAttunement,
  equipItem,
  extendFeature,
  healCreature,
  changeCoins,
  purchaseItem,
  relocateCreature,
  releaseReady,
  resolveAttack,
  resolveAttackDamage,
  resolveFall,
  resolveMove,
  resolveDamage,
  rollImprovisedDamage,
  pendingCastingsOf,
  resolveDeclaredCast,
  resolveSpell,
  resolveTurn,
  settleAreaEffects,
  takeDash,
  takeDisengage,
  takeDodge,
  takeHelp,
  takeHide,
  takeInfluence,
  takeSearch,
  takeStudy,
  extinguishFire,
  takeUtilize,
  wakeCreature,
  declineDamageReaction,
  declineTestReaction,
  resolveTest,
  settleDamage,
  settleTest,
  takeDamageReaction,
  takeAttackReaction,
  takeDamageResponse,
  takeOpportunityAttack,
  takeItemUp,
  takeReady,
  forcePrintedSave,
  castPrintedLine,
  takeLegendaryAction,
  takePrintedForm,
  takePrintedPull,
  takePrintedTeleport,
  dismissKeptSummons,
  enterElsewhere,
  recallKeptSummons,
  returnFromElsewhere,
  takePrintedPlaneShift,
  takePrintedSwallow,
  takeStatedAction,
  takeStatedBonusAction,
  takeTestReaction,
  tradeResource,
  unequipItem,
  orderSummonsAttack,
  useHealingTouch,
  useItem,
  useBudgetPurchase,
  usePoolOption,
  useRecovery,
  useSelfHeal,
} from './commands.js';
// Not a command, and therefore not on the barrel — the low-level half beneath
// `resolveSpell`, kept here so the `mayAct` guard it gained stays exercised.
import { resolveCast } from './commands/casting.js';
import { conditionInstanceId } from './conditions.js';
import { beginRest, endRest, SHORT_REST } from './rest.js';
import { hitDieKey } from './resources.js';
import { extendContent, type Content } from './content.js';
import type { SpellDefinition } from './spell-definitions.js';
import { type FeatDefinition } from './origins.js';
import type { FeatureSource } from './progression.js';

/**
 * Invariants the whole engine owes, checked as a sweep rather than one command
 * at a time.
 *
 * Every test here was written against a hole the audit actually found. Two of
 * them are the kind that only a sweep catches:
 *
 * **An idempotency guard that silently does not engage.** A command takes a
 * `commandId`, calls `identify`, computes a fingerprint — and then emits
 * events none of which carry the stamp, so nothing is ever recorded and the
 * guard never fires. Six commands were in that state. Offering the id and not
 * honouring it is worse than not offering it, because the caller believes it
 * is protected.
 *
 * **Unknown read as no.** The engine has one error shape for "the rules say
 * no" and for "you have not told me about this yet", and an AI DM cannot act
 * on the difference. Attacking a chandelier rope nobody has declared is the
 * "DOOR NOT CREATED — INVALID OBJECT" failure: the correct answer is to
 * establish the rope, not to tell the player it cannot exist.
 */

const id = (s: string) => asCharacterId(s);
const A = id('a');
const B = id('b');
const C = id('c');

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 5,
  abilities: { str: 14, dex: 14, con: 12, int: 14, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'int',
  weaponProficiencies: ['simple', 'martial'],
  // SRD Alert's Initiative Swap, so the sweep's well-formed call reaches the
  // command's own body rather than stopping at whose feat the swap is.
  initiativeSwap: true,
  // A form to take, so `assumeShape` reaches its price and its pool rather
  // than stopping at a feature the sheet does not hold.
  shapeShifts: [
    {
      feature: 'test:shape',
      name: 'A Shape',
      action: 'bonus-action',
      pool: 'test:vigour',
      formType: 'Beast',
      known: 4,
      maxChallengeRating: 0.25,
      flying: false,
      hours: 1,
      temporaryHitPoints: 1,
      keeps: ['int', 'wis', 'cha'],
      knownForms: ['wolf'],
    },
  ],
  activated: [
    { feature: 'test:stance', name: 'Stance', action: 'bonus-action', pool: null, lasts: 'end-of-next-turn' },
  ],
  // A swing this creature may give up so that a creature of theirs may take
  // one — SRD Pact of the Chain — so `orderSummonsAttack`'s well-formed call
  // reaches the command's own body rather than stopping at a feature the sheet
  // does not hold.
  forgoneAttacks: [{ feature: 'test:chain', name: 'The Chain', from: 'find-familiar' }],
  // A thing this creature can make, so `createDevice` reaches its price and
  // its ceiling rather than stopping at a feature the sheet does not hold.
  objectMakers: [
    {
      feature: 'test:tinker',
      name: 'A Tinkering',
      castingSeconds: 600,
      spell: 'prestidigitation',
      size: 'tiny',
      armorClass: 5,
      hitPoints: 1,
      lastsSeconds: 28_800,
      atOnce: 3,
      functions: ['it whistles'],
      activation: 'bonus-action',
    },
  ],
  healingTouch: [
    {
      feature: 'test:healing-touch',
      name: 'A Kindly Hand',
      action: 'bonus-action',
      pool: 'test:vigour',
      lifts: ['poisoned'],
      costPerCondition: 2,
    },
  ],
  selfHeals: [
    {
      feature: 'test:self-heal',
      name: 'A Draught Of Vigour',
      action: 'bonus-action',
      pool: 'test:vigour',
      dice: '1d10',
      plus: { kind: 'level', level: 5, label: 'some level' },
    },
  ],
  // What a use of a pool buys, where what it buys is a Reaction somebody else
  // ends up holding. One conferral, reaching thirty feet, so the two sweeps
  // below have a well-formed call to make.
  conferredReactions: [
    {
      feature: 'test:inspire',
      name: 'A Word Of Encouragement',
      action: 'bonus-action',
      range: 30,
      pool: 'test:vigour',
      durationSeconds: 600,
      excludesSelf: true,
      confers: [
        {
          feature: 'test:inspire',
          name: 'A Word Of Encouragement',
          window: 'test-rolled',
          costsReaction: false,
          pool: null,
          reach: { kind: 'self' },
          does: {
            kind: 'intervene',
            amount: { dice: '1d6' },
            direction: 'bonus',
            tests: ['ability-check', 'saving-throw'],
            outcome: 'failure',
          },
        },
      ],
    },
  ],
  // What a use of a pool buys, where what it buys is an effect list. One
  // option, aimed at a creature in reach, so the two sweeps below have a
  // well-formed call to make — the heal is the least interesting effect there
  // is, which is the point: the entries are about the identity and the guard.
  // What a use of a pool buys, where what it buys is room in the turn's own
  // budget. One purchase, costing nothing to invoke, so the two sweeps have a
  // well-formed call to make.
  budgetPurchases: [
    {
      feature: 'test:channelling',
      featureName: 'A Channelling',
      purchase: 'surge',
      name: 'A Second Wind Of Purpose',
      pool: 'test:vigour',
      action: 'none',
      extraAction: {},
    },
  ],
  poolOptions: [
    {
      feature: 'test:channelling',
      featureName: 'A Channelling',
      option: 'mend',
      name: 'A Mending Word',
      action: 'action',
      pool: 'test:vigour',
      ability: 'int',
      reach: 30,
      effects: [{ kind: 'heal', healing: { dice: '1d4' }, addSpellcastingModifier: false }],
    },
  ],
  ...over,
});

const added = (who: CharacterId, side: string): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(),
  maxHp: 60,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side,
});

const SETUP: readonly GameEvent[] = [
  added(A, 'party'),
  added(B, 'foes'),
  {
    type: 'items-gained',
    id: A,
    items: [
      { id: 'longsword', quantity: 1 },
      { id: 'chain-shirt', quantity: 1 },
    ],
    source: 'kit',
  },
  { type: 'coins-changed', id: A, copper: 100_000, source: 'a patron' },
  {
    type: 'resource-pool-declared',
    id: A,
    pool: { key: spellSlotKey(1), label: 'level 1 spell slot', max: 4, recovers: 'long-rest' },
  },
  {
    type: 'spellcasting-declared',
    id: A,
    spellcasting: declaredCasting({ ability: 'int', prepared: ['inflict-wounds', 'disguise-self'] }),
  },
  { type: 'scene-set', extent: { width: 300, depth: 300, height: 40 } },
  { type: 'landmark-added', name: 'here', at: { x: 100, y: 100, z: 0 } },
  { type: 'creature-placed', id: A, placement: { from: { landmark: 'here' }, feet: 0 } },
  { type: 'creature-placed', id: B, placement: { from: { creature: A }, feet: 5, bearing: 0 } },
  { type: 'sight-declared', from: A, to: B, seen: true },
  { type: 'sight-declared', from: B, to: A, seen: true },
  {
    type: 'combat-started',
    combatants: [
      { id: A, initiative: 20, speed: 30 },
      { id: B, initiative: 10, speed: 30 },
    ],
  },
];

/**
 * The same world with no fight in it, which is the only world `advanceTime`
 * may be sent to.
 *
 * The clock inside a fight is the turn order's — `withCombat` charges six
 * seconds a round — so a declared advance is refused `in_combat`, and a sweep
 * that ran it against `SETUP` would be reading that refusal rather than the
 * identity it is about. Derived by taking the fight out rather than by writing
 * a second setup, and checked below in both directions so it cannot drift into
 * being a different fixture.
 */
const OUT_OF_COMBAT: readonly GameEvent[] = SETUP.filter(
  (event) => event.type !== 'combat-started',
);

/**
 * The same world with a familiar of A's in it, and the fight holding all three.
 *
 * SRD Pact of the Chain's "**your** familiar" is a creature kept from Find
 * Familiar by this summoner, so the bond is written by hand rather than cast
 * for: the fixture is about the command's guard, and a casting that had to
 * succeed to build the world would be a fixture whose shape depended on a
 * spell's definition.
 */
const CHAINED: readonly GameEvent[] = [
  ...OUT_OF_COMBAT,
  {
    type: 'creature-added',
    id: C,
    name: C,
    sheet: sheet(),
    maxHp: 10,
    diesAtZero: true,
    creatureType: 'Fiend',
    side: 'party',
  },
  {
    type: 'creature-summoned',
    id: C,
    by: A,
    kept: { spell: 'find-familiar', untilSummonerDies: false },
  },
  { type: 'creature-placed', id: C, placement: { from: { creature: B }, feet: 5, bearing: 90 } },
  { type: 'sight-declared', from: C, to: B, seen: true },
  { type: 'sight-declared', from: B, to: C, seen: true },
  {
    type: 'combat-started',
    combatants: [
      { id: A, initiative: 20, speed: 30 },
      { id: C, initiative: 15, speed: 30 },
      { id: B, initiative: 10, speed: 30 },
    ],
  },
];

/** A line a stat block prints under Bonus Actions, in the shape a sheet holds one. */
const PRINTED_LINE = {
  name: 'A Printed Line',
  text: 'The creature does something the engine applies no part of.',
} as const;

/**
 * The same world with that line on A's sheet, and nothing else changed.
 *
 * Derived from `SETUP` by replacing the arrival rather than by writing a
 * second setup, so the fixture cannot drift into being a different world — and
 * the line is invented here rather than lifted off a stat block because the
 * sweep is about the command's identity and not about any block.
 */
const LINED: readonly GameEvent[] = SETUP.map((event) =>
  event.type === 'creature-added' && event.id === A
    ? { ...event, sheet: sheet({ stated: { bonusActions: [PRINTED_LINE] } }) }
    : event,
);

/**
 * The same world with that line under **Actions** instead, and nothing else
 * changed.
 *
 * The two sections hold the same shape and are spent out of different slots,
 * so the sweep drives each against its own fixture rather than one creature
 * carrying both — a duplicate check that passed because the *other* command
 * had already spent the turn would be a guard testing nothing.
 */
const UNREAD: readonly GameEvent[] = SETUP.map((event) =>
  event.type === 'creature-added' && event.id === A
    ? { ...event, sheet: sheet({ stated: { unreadActions: [PRINTED_LINE] } }) }
    : event,
);

/**
 * The same invented line with the book's save template read off it.
 *
 * Invented here for the reason the line above is: the sweep is about the
 * command's identity, not about any block — and the numbers are small so a
 * second run under one id is cheap to tell apart from a first.
 */
const SAVING_LINE = {
  ...PRINTED_LINE,
  save: {
    ability: 'con' as const,
    dc: 12,
    targets: 'each creature in a 15-foot Cone',
    damage: { dice: '2d6', flat: 0, type: 'fire', average: 7 },
    onSuccess: 'half' as const,
  },
} as const;

/**
 * An invented legendary line with the book's Shimmering Shield shape read off
 * it, and the pool its use comes out of.
 *
 * Invented here for the reason the lines above are. The world is `SETUP` with
 * one turn taken: A acted first, the boundary passed to B, and B has spent
 * nothing — which is the moment "immediately after another creature's turn"
 * the command reads.
 */
const SHIELD_LINE = {
  name: 'A Legendary Shield',
  text: 'The creature shields itself or a friend.',
  legendary: {
    kind: 'shield' as const,
    rangeFeet: 60,
    temporaryHitPoints: { dice: '3d6', flat: 0, average: 10 },
    armorClass: 2,
    oncePerRound: true as const,
  },
  recharge: { kind: 'turn' as const },
} as const;

const LEGENDARY: readonly GameEvent[] = [
  ...SETUP.map((event) =>
    event.type === 'creature-added' && event.id === A
      ? { ...event, sheet: sheet({ stated: { legendaryActions: [SHIELD_LINE] } }) }
      : event,
  ),
  {
    type: 'resource-pool-declared',
    id: A,
    pool: { key: 'legendary-actions', label: 'Legendary Action Uses', max: 3, recovers: 'special' },
  },
  { type: 'turn-advanced' },
];

/** The same world again, with that line under Actions. */
const FORCED: readonly GameEvent[] = SETUP.map((event) =>
  event.type === 'creature-added' && event.id === A
    ? { ...event, sheet: sheet({ stated: { unreadActions: [SAVING_LINE] } }) }
    : event,
);

/**
 * The same invented line with the book's teleport template read off it.
 *
 * Invented here for the reason the two above are, and thirty feet because the
 * fixture's two creatures stand five feet apart: a distance the destination
 * below is comfortably inside is a distance that cannot make this sweep about
 * the geometry.
 */
const TELEPORTING_LINE = {
  ...PRINTED_LINE,
  teleports: { feet: 30, mustSee: true as const },
} as const;

/** The same invented line with the book's plane-shift template read off it. */
const STEPPING_LINE = { ...PRINTED_LINE, shiftsPlane: { plane: 'ethereal' as const } } as const;

/** And with the book's swallow template read off it, over B, whom A already holds. */
const SWALLOWING_LINE: StatedAction = {
  ...PRINTED_LINE,
  swallows: {
    maxSize: 'medium',
    conditions: ['blinded', 'restrained'],
    damage: { dice: '2d4', type: 'Acid', of: 'each', disgorges: false },
    handedOver: [],
  },
};

/** A with the stepping line under Actions. */
const STEPPING: readonly GameEvent[] = SETUP.map((event) =>
  event.type === 'creature-added' && event.id === A
    ? { ...event, sheet: sheet({ stated: { unreadActions: [STEPPING_LINE] } }) }
    : event,
);

/** The same world again, with that line under Actions. */
const BLINKING: readonly GameEvent[] = SETUP.map((event) =>
  event.type === 'creature-added' && event.id === A
    ? { ...event, sheet: sheet({ stated: { unreadActions: [TELEPORTING_LINE] } }) }
    : event,
);

/**
 * The same invented line with the book's Shape-Shift template read off it.
 *
 * Two forms, because a line that offers one offers no choice, and a size on
 * the first so that a second run under one id would be a second resizing
 * rather than nothing visible at all.
 */
const SHIFTING_LINE: StatedAction = {
  ...PRINTED_LINE,
  forms: {
    forms: [
      { name: 'wolf', sizes: ['small'], speed: null },
      { name: 'humanoid', sizes: [], speed: null },
    ],
    handedOver: [],
  },
};

/** The same world again, with that line under Actions. */
const SHIFTING: readonly GameEvent[] = SETUP.map((event) =>
  event.type === 'creature-added' && event.id === A
    ? { ...event, sheet: sheet({ stated: { unreadActions: [SHIFTING_LINE] } }) }
    : event,
);

/**
 * The same invented line with the book's pull template read off it.
 *
 * A retry that was not guarded would spend a second Action and drag every
 * creature the puller holds a second time, which is the most visible kind of
 * double landing there is: they end up twice as close.
 */
const PULLING_LINE: StatedAction = { ...PRINTED_LINE, pulls: { feet: 30, of: 'grappled' } };

/** The same world again, with that line under Actions. */
const PULLING: readonly GameEvent[] = SETUP.map((event) =>
  event.type === 'creature-added' && event.id === A
    ? { ...event, sheet: sheet({ stated: { unreadActions: [PULLING_LINE] } }) }
    : event,
);

/**
 * The same invented line with the book's cast template read off it.
 *
 * Invented for the three above's reason, and *Bless* because it is the spell
 * SRD's own Divine Aid offers first: a casting that touches nobody's hit
 * points, so a second run under one id shows up as a second casting rather
 * than as arithmetic.
 */
const CASTING_LINE = {
  ...PRINTED_LINE,
  casts: { spells: ['bless'], ability: 'wis' as const, saveDc: 13 },
};

/**
 * The same world again, with that line under Actions and a route to cast it.
 *
 * The grant is what `adaptMonster` compiles off such a line, written out here
 * because the sweep is about the command's identity rather than about any
 * block: the heading's price, the line's ability, and no payment of its own.
 */
const CASTING: readonly GameEvent[] = [
  ...SETUP.map((event) =>
    event.type === 'creature-added' && event.id === A
      ? { ...event, sheet: sheet({ stated: { unreadActions: [CASTING_LINE] } }) }
      : event,
  ),
  {
    type: 'spellcasting-declared',
    id: A,
    spellcasting: {
      classes: [],
      granted: [
        {
          spellId: 'bless',
          source: `printed:invented:${PRINTED_LINE.name}`,
          ability: 'wis' as const,
          castingTime: 'action' as const,
          throughLine: PRINTED_LINE.name,
          freeCastPool: null,
          slotCasting: false,
          atWill: true as const,
          saveDc: 13,
        },
      ],
    },
  },
];

/**
 * A Short Rest that has run its hour, with a wound and a Hit Die left.
 *
 * All three facts are load-bearing. The wound is dealt **before** the rest
 * begins, because damage is one of the three interruptions the engine sees for
 * itself and a rest broken at all earns nothing; the hour is what makes the
 * rest complete; and the Hit Die is what makes a retry cost something — an
 * unguarded second settlement rolls a second die, hands back a second heal and
 * leaves the generator a throw further on than the log says.
 */
const RESTED: readonly GameEvent[] = (() => {
  const hurt: readonly GameEvent[] = [
    ...OUT_OF_COMBAT,
    {
      type: 'resource-pool-declared',
      id: A,
      pool: { key: hitDieKey(8), label: 'Hit Dice (d8)', max: 2, recovers: 'long-rest' },
    },
    ...unwrap(damageCreature(fold('s', OUT_OF_COMBAT), A, { amount: 20, source: 'a trap' }), 'hurt'),
  ];
  return [
    ...hurt,
    ...unwrap(beginRest(fold('s', hurt), A, 'short'), 'lying down'),
    { type: 'time-advanced', seconds: SHORT_REST, reason: 'an hour in the vestry' },
  ];
})();

/**
 * SETUP, plus a potion in A's pack and a wound for it to close.
 *
 * The wound matters: a drink that heals nobody would leave the sweep asserting
 * only that the bottle emptied, and the retry it is about is the *healing*
 * happening twice.
 */
const POTIONED: readonly GameEvent[] = (() => {
  const owned: readonly GameEvent[] = [
    ...SETUP,
    {
      type: 'items-gained',
      id: A,
      items: [{ id: 'potion-of-healing', quantity: 1 }],
      source: 'the hoard',
    },
  ];
  return [
    ...owned,
    ...unwrap(damageCreature(fold('s', owned), A, { amount: 20, source: 'a trap' }), 'wounded'),
  ];
})();

/**
 * SETUP, plus what attuning needs: an attunable item owned, and the Short Rest
 * the attuning is spent during.
 */
const ATTUNING: readonly GameEvent[] = [
  ...SETUP,
  {
    type: 'items-gained',
    id: A,
    items: [{ id: 'cloak-of-elvenkind', quantity: 1 }],
    source: 'the hoard',
  },
  { type: 'rest-begun', id: A, kind: 'short' },
];

/**
 * One generator handed to one command, with a count of how far it was turned.
 *
 * The engine creates no generator of its own — `createRng` and `restoreRng`
 * are named nowhere outside `dice.ts` and the tests — so every die the engine
 * throws comes out of a `Supply`, and a counting wrapper around the one this
 * file hands over sees all of them. That is what lets the sweep below tell
 * *rolled and recorded* from *rolled and forgot* from *never rolled* without
 * anybody writing down which commands roll.
 */
interface Probe {
  readonly issuer: RollIssuer;
  readonly rng: Rng;
  /** Dice drawn through this generator. */
  readonly drawn: () => number;
}

/**
 * Every supply made since the last reset, in the order they were made.
 *
 * Module-level and mutable, reset by the one sweep that reads it. That is safe
 * because this file is sequential and nothing configures vitest otherwise, and
 * it would go silently wrong under `describe.concurrent` — so if that ever
 * arrives here, the probe moves into the run rather than beside it.
 */
const PROBES: Probe[] = [];

/**
 * A probed supply, over whichever book the fixture needs.
 *
 * The content argument is not decoration: a sweep that can only be pointed at
 * the SRD can only see the branches SRD content reaches, and one of them —
 * a per-turn payout that rolls — has no SRD spell behind it. So a fixture may
 * hand in a book of its own, built through the same door homebrew uses.
 */
const supply = (seed = 's', content: Content = SRD_CONTENT) => {
  const issuer = createRollIssuer('r');
  const source = createRng(seed) as Rng;
  let draws = 0;
  // Transparent: the same faces in the same order, and `snapshot()` is the
  // source's own, so a fixture built through this is byte-identical to one
  // built through a bare `createRng`.
  const rng: Rng = {
    int: (sides: number) => {
      draws += 1;
      return source.int(sides);
    },
    snapshot: () => source.snapshot(),
  };
  PROBES.push({ issuer, rng, drawn: () => draws });
  return { issuer, rng, content };
};

/**
 * SETUP, plus a charged wand awarded to A and put in A's hand.
 *
 * The Wand of Secrets needs no attunement and its charges recover on a *rolled*
 * dawn, so this one fixture serves both `expendCharges` and `declareDawn`: the
 * dawn below is a dawn with something to give back and a die to throw for it,
 * which is the retry that would be dangerous if it ran twice.
 *
 * Handed over through `awardItems`, which is what declares the copy's pool:
 * a hand-written gain is a line with no record and a copy with no record has
 * no charges to spend at all.
 */
const awarded = (log: readonly GameEvent[], itemId: string): readonly GameEvent[] => [
  ...log,
  ...unwrap(
    awardItems(fold('s', log), supply('the-hoard'), A, [{ id: itemId }], 'the hoard'),
    'the hoard',
  ),
];

const held = (log: readonly GameEvent[], itemId: string): readonly GameEvent[] => {
  const owned = awarded(log, itemId);
  return [...owned, ...unwrap(equipItem(fold('s', owned), SRD_CONTENT, A, itemId), 'equip')];
};

const CHARGED: readonly GameEvent[] = held(SETUP, 'wand-of-secrets');

/** And one charge out of it, so a dawn has something to roll for. */
const SPENT_A_CHARGE: readonly GameEvent[] = [
  ...CHARGED,
  ...unwrap(expendCharges(fold('s', CHARGED), SRD_CONTENT, A, 'wand-of-secrets'), 'expend'),
];

/**
 * SETUP, plus a Wand of Fireballs in A's hand — a wand whose charges buy a
 * casting rather than an economy on its own.
 *
 * Built twice over, attuned and not, because both are refusals this file is
 * about: a casting from an item is a real casting, and everything it can be
 * refused for has to leave the charges exactly where they were. SRD prints the
 * bracket, so the unattuned copy is a hand that legitimately holds the wand
 * and gets nothing from it.
 */
const wandInHand = (attune: boolean): readonly GameEvent[] => {
  const inHand = held(SETUP, 'wand-of-fireballs');
  return attune ? [...inHand, { type: 'attuned', id: A, item: 'wand-of-fireballs' }] : inHand;
};

const FIREBALL_WAND = wandInHand(true);
const UNATTUNED_WAND = wandInHand(false);

/**
 * SETUP, plus a Wind Fan in A's hand that has already been waved five times
 * today — so the next wave rolls at a hundred percent and tears it.
 *
 * The one command in the engine that can succeed without making a casting, and
 * the reason it is here: a failed use is an ordinary `ok` carrying
 * `castingId: null`, which makes it exactly the shape a retry can get wrong.
 * The stamp rides the loss rather than a `spell-cast`, and the ledger has to
 * remember that no casting came of it.
 *
 * The five uses are written rather than played, because uses two through five
 * fail on a percentage and a fixture that waved the fan five times would be a
 * fixture about the seed.
 */
const TORN_NEXT: readonly GameEvent[] = [
  ...held(SETUP, 'wind-fan'),
  ...Array.from({ length: 5 }, () => ({
    type: 'resource-spent' as const,
    id: A,
    key: 'wind-fan:uses',
    amount: 1,
    tally: 'dawn' as const,
  })),
];

/** What is left in the Wand of Fireballs, for the refusals that must not touch it. */
const wandCharges = (log: readonly GameEvent[]): number =>
  chargesLeft(fold('s', log), SRD_CONTENT, A, 'wand-of-fireballs');

/** Events out of whatever shape a command hands back. */
const eventsOf = (value: unknown): readonly GameEvent[] =>
  Array.isArray(value) ? (value as GameEvent[]) : ((value as { events: GameEvent[] }).events ?? []);

/**
 * One command, invoked against a state, with the id it was given.
 *
 * A table rather than a test each, because the point is that **no** command is
 * exempt: a new one added without a working guard fails here rather than
 * waiting to be found in play.
 */
interface Guarded {
  readonly name: string;
  /** The log this command needs to be legal. */
  readonly log: readonly GameEvent[];
  readonly run: (state: GameState, commandId: string) => Result<unknown>;
}

/**
 * B held in A's grapple, with the turn passed to B so the escape has an Action
 * to spend.
 *
 * Written as events rather than by running `grappleTarget`, because a fixture
 * that has to roll a failed save to exist is a fixture whose shape depends on
 * the generator. The escape DC is the one that command would have pinned.
 */
const HELD: readonly GameEvent[] = [
  ...SETUP,
  { type: 'condition-applied', id: B, condition: 'grappled', source: grappleSource(A) },
  {
    type: 'effect-scheduled',
    target: {
      kind: 'condition',
      on: B,
      instance: conditionInstanceId('grappled', grappleSource(A)),
    },
    deadline: { kind: 'indefinite' },
    check: {
      ability: 'str',
      skill: 'athletics',
      dc: 13,
      onSuccess: 'end-on-target',
      label: `check to escape ${A}'s grapple`,
    },
  },
  { type: 'turn-advanced' },
];

/** A holding B, with the swallowing line under Actions, on A's turn. */
const SWALLOWING: readonly GameEvent[] = HELD.filter((event) => event.type !== 'turn-advanced').map(
  (event) =>
    event.type === 'creature-added' && event.id === A
      ? { ...event, sheet: sheet({ stated: { unreadActions: [SWALLOWING_LINE] } }) }
      : event,
);

/**
 * A stirge fixed to B, so the two detach doors have something to let go of.
 *
 * The relation is on the creature that attached, which is the one thing an
 * attach does not share with the grapple above it — see `creature-attached`.
 */
const ATTACHED: readonly GameEvent[] = [
  ...SETUP,
  { type: 'creature-attached', id: A, attachment: { to: B, name: 'Proboscis' } },
];

/** The same hold, with the turn passed to the creature being held. */
const ATTACHED_THEIR_TURN: readonly GameEvent[] = [...ATTACHED, { type: 'turn-advanced' }];

/**
 * A behind total cover, with B declared unable to see them: the two facts SRD
 * Hide asks for before the check, so the command is legal enough to be run
 * twice under one id.
 */
const lurking = (): readonly GameEvent[] => [
  ...SETUP,
  { type: 'sight-declared', from: B, to: A, seen: false },
  { type: 'cover-declared', from: B, to: A, degree: 'total' },
];

const readied = (): readonly GameEvent[] => {
  const held = [
    ...SETUP,
    ...unwrap(takeReady(fold('s', SETUP), A, { trigger: 'when it moves', response: { kind: 'action' } }, SRD_CONTENT), 'ready'),
  ];
  return [...held, ...unwrap(resolveTurn(fold('s', held), supply()), 'turn').events];
};

const provoking = (): readonly GameEvent[] => {
  const out = unwrap(
    resolveMove(fold('s', SETUP), A, { placement: { from: { creature: B }, feet: 25, bearing: 180 } }, supply()),
    'move',
  );
  return [...SETUP, ...out.events];
};

/**
 * Circling at five feet, which provokes nothing.
 *
 * SRD offers the Opportunity Attack for *leaving* a reach, so a move that
 * starts and ends inside one is the ordinary case rather than an exotic one —
 * and it is the branch `resolveMove` takes whenever nobody is owed a swing.
 * The provoked branch has its own event to carry the stamp; this one did not,
 * which is exactly why a sweep has to exercise both.
 */
const CIRCLING = { from: { creature: B }, feet: 5, bearing: 90 } as const;

/**
 * An attack that has hit and whose damage nobody has rolled.
 *
 * The window SRD Divine Smite is cast into, and the state `resolveAttackDamage`
 * settles. A large bonus settles the attack roll outright, so the fixture is
 * the held branch every time rather than whichever way the dice fell.
 */
const holding = (): readonly GameEvent[] => [
  ...SETUP,
  ...unwrap(
    resolveAttack(
      fold('s', SETUP),
      A,
      {
        target: B,
        weapon: 'longsword',
        hold: true,
        attackBonuses: [{ source: 'the test insists', flat: 40 }],
      },
      supply(),
    ),
    'a hit held open',
  ).events,
];

/**
 * A turn-boundary save raised and left unrolled.
 *
 * Advancing without a generator is what leaves the debt in state, which is the
 * whole reason `resolvePendingSaves` exists — and the reason it needs an id:
 * it is the one settlement a caller comes back to later, from a different
 * machine, with the world some way further on.
 */
const owed = (): readonly GameEvent[] => {
  const cast = [
    ...SETUP,
    ...unwrap(
      castSpell(fold('s', SETUP), A, {
        spell: 'Hold Person',
        level: 1,
        concentration: true,
        slotLevel: 1,
      }),
      'hold person',
    ),
  ];
  const held = [
    ...cast,
    ...unwrap(
      applySpellEffect(fold('s', cast), B, 'paralyzed', A, {
        repeatSave: {
          at: 'end-of-turn',
          of: B,
          ability: 'wis',
          dc: 13,
          onSuccess: 'end-on-target',
          label: 'Wisdom save vs Hold Person',
        },
      }),
      'paralysed',
    ),
  ];
  let log: readonly GameEvent[] = held;
  // A's turn ends, then B's — and the end of B's own turn is what raises it.
  for (let n = 0; n < 2; n += 1) {
    log = [...log, ...unwrap(resolveTurn(fold('s', log)), `turn ${n}`).events];
  }
  return log;
};

/**
 * A pool that gives **one** use back on a Short Rest, with two spent.
 *
 * SRD writes that rule five times in the same words — Rage, both Channel
 * Divinities, Wild Shape, Second Wind. Built by hand rather than from a class
 * table, because every class that has it is also tagged `long-rest` and takes
 * the whole-refill branch first; `restoreOn` is pure over a pool, so the
 * partial branch is reachable by simply declaring one that recovers at dawn.
 * It is the branch that makes a retried restoration hand back a use nobody
 * rested for.
 */
const partiallySpent = (): readonly GameEvent[] => [
  ...SETUP,
  {
    type: 'resource-pool-declared',
    id: A,
    pool: {
      key: 'test:fury',
      label: 'a fury of sorts',
      max: 3,
      recovers: 'dawn',
      regainsOnShortRest: 1,
    },
  },
  { type: 'resource-spent', id: A, key: 'test:fury', amount: 2 },
];

/** A feature already switched on, so ending and extending it are legal. */
const stanced = (): readonly GameEvent[] => [
  ...SETUP,
  { type: 'feature-activated', id: A, feature: 'test:stance' },
];

/** A wearing a form, with a fresh turn come round, so leaving it is legal. */
const shaped = (): readonly GameEvent[] => {
  const log = vigorous();
  return [
    ...log,
    ...unwrap(
      assumeShape(fold('s', log), A, { feature: 'test:shape', form: 'wolf' }, SRD_CONTENT),
      'shape',
    ),
    { type: 'turn-advanced' },
    { type: 'turn-advanced' },
  ];
};

/** A is concentrating on something, so dismissing it is legal. */
const concentrating = (): readonly GameEvent[] => [
  ...SETUP,
  { type: 'concentration-started', id: A, castingId: 'cast:1', spell: 'Bless', level: 1 },
];

/** A has declared a casting and not yet settled it, so there is one to settle. */
const declaring = (): readonly GameEvent[] => [
  ...SETUP,
  ...unwrap(
    resolveSpell(
      fold('s', SETUP),
      A,
      { spellId: 'inflict-wounds', targets: [B], slotLevel: 1, hold: true },
      supply(),
    ),
    'declare',
  ).events,
];

/**
 * The one casting `declaring()` leaves open.
 *
 * Settlement addresses a casting **id**, and this sweep runs the command twice
 * under one command id — so the id has to be the same both times, which it
 * could not be if it were read off a state the first run has already settled.
 */
const DECLARED_CASTING = pendingCastingsOf(fold('s', declaring()))[0]!.castingId;

/**
 * An illusion standing there for somebody to look at.
 *
 * Disguise Self offers a check against its own casting, which is the branch of
 * `resolveEffectCheck` that emits **no settling event at all** — the stamp
 * rides on the roll alone. That is exactly the shape the sweep exists to
 * catch: a guard whose event never happens is a guard that never fires.
 */
const illusion = (): readonly GameEvent[] => {
  const cast = [
    ...SETUP,
    ...unwrap(
      resolveSpell(fold('s', SETUP), A, { spellId: 'disguise-self', targets: [], slotLevel: 1 }, supply()),
      'disguise',
    ).events,
  ];
  // On to B's turn, because the Study action that examines it is B's to spend
  // and A's went on the casting.
  return [...cast, ...unwrap(resolveTurn(fold('s', cast), supply()), 'turn').events];
};

/** A third creature nobody has typed, so declaring its type says something. */
const untyped = (): readonly GameEvent[] => [
  ...SETUP,
  { type: 'creature-added', id: C, name: C, sheet: sheet(), maxHp: 20, diesAtZero: true, side: 'foes' },
];

/**
 * A creature with a feature that gives another pool's uses back and one that
 * spends a use to heal, both built by hand rather than from a class table — so
 * the guard is tested on the mechanism rather than on the Sorcerer.
 */
const recovering = (): readonly GameEvent[] => [
  ...SETUP,
  {
    type: 'creature-added',
    id: C,
    name: C,
    sheet: sheet({
      recoveries: [
        {
          feature: 'test:recovery',
          name: 'A Second Wind Of Sorts',
          pool: 'test:recovery',
          restores: 'test:points',
          upTo: 'half-class-level',
          classLevel: 6,
          moment: 'declared',
        },
      ],
    }),
    maxHp: 20,
    diesAtZero: true,
    side: 'foes',
  },
  {
    type: 'resource-pool-declared',
    id: C,
    pool: { key: 'test:recovery', label: 'the feature', max: 1, recovers: 'long-rest' },
  },
  {
    type: 'resource-pool-declared',
    id: C,
    pool: { key: 'test:points', label: 'points', max: 6, recovers: 'long-rest' },
  },
  { type: 'resource-spent', id: C, key: 'test:points', amount: 6 },
];

/**
 * A creature who can pay for one pool's uses with another's, built by hand for
 * `recovering`'s reason — the guard is about the mechanism rather than about
 * the Druid.
 *
 * The pool it fills is spent, because a trade gives back what was spent: a
 * retry that was not caught would hand back two uses and charge for one.
 */
const trading = (): readonly GameEvent[] => [
  ...SETUP,
  {
    type: 'creature-added',
    id: C,
    name: C,
    sheet: sheet({
      trades: [
        {
          feature: 'test:trade',
          name: 'An Exchange Of Sorts',
          trade: 'points-for-vigour',
          action: 'none',
          spends: { key: 'test:points', uses: 1 },
          gains: { key: 'test:vigour', uses: 1 },
          limit: 'once-per-long-rest',
          pool: 'test:trade',
        },
      ],
    }),
    maxHp: 20,
    diesAtZero: true,
    side: 'foes',
  },
  {
    type: 'resource-pool-declared',
    id: C,
    pool: { key: 'test:trade', label: 'the feature', max: 1, recovers: 'long-rest' },
  },
  {
    type: 'resource-pool-declared',
    id: C,
    pool: { key: 'test:points', label: 'points', max: 6, recovers: 'long-rest' },
  },
  {
    type: 'resource-pool-declared',
    id: C,
    pool: { key: 'test:vigour', label: 'vigour', max: 2, recovers: 'long-rest' },
  },
  { type: 'resource-spent', id: C, key: 'test:vigour', amount: 2 },
];

/**
 * A is hurt and has something to spend on it — a self-heal built by hand, so
 * the guard is tested on the mechanism rather than on the Fighter.
 */
const vigorous = (): readonly GameEvent[] => [
  ...SETUP,
  {
    type: 'resource-pool-declared',
    id: A,
    pool: { key: 'test:vigour', label: 'vigour', max: 2, recovers: 'long-rest' },
  },
  { type: 'damage-taken', id: A, amount: 20, source: 'a trap' },
];

/**
 * A reaction feature built by hand, so the sweep tests the mechanism rather
 * than the Rogue. Three windows in one sheet, because the guards on all three
 * commands are the same guard and a table is how that gets said once.
 */
const reactive = (): CharacterSheet =>
  sheet({
    reactions: [
      {
        feature: 'test:blunt',
        name: 'Blunting',
        window: 'damage-rolled',
        costsReaction: true,
        pool: null,
        reach: { kind: 'self' },
        does: { kind: 'reduce-damage', amount: { halve: true }, fromAttackOnly: true },
      },
      {
        feature: 'test:push',
        name: 'A Nudge From Fate',
        window: 'test-rolled',
        costsReaction: false,
        pool: null,
        reach: { kind: 'self' },
        does: {
          kind: 'intervene',
          amount: { dice: '1d4' },
          direction: 'bonus',
          tests: ['ability-check', 'saving-throw'],
          outcome: 'either',
        },
      },
      {
        feature: 'test:riposte',
        name: 'Riposte',
        window: 'damaged-by-creature',
        costsReaction: true,
        pool: null,
        reach: { kind: 'self' },
        does: { kind: 'melee-attack', withinFeet: 5 },
      },
      {
        feature: 'test:parry',
        name: 'Parry',
        window: 'hit-by-attack',
        costsReaction: true,
        pool: null,
        reach: { kind: 'self' },
        does: { kind: 'raise-ac', amount: 2, meleeOnly: true, requiresWeapon: true },
      },
    ],
  });

/** B swings at A, whose Blunting holds the damage open. */
const blunting = (): readonly GameEvent[] => {
  const log: readonly GameEvent[] = [
    ...SETUP.map((e) =>
      e.type === 'creature-added' && e.id === A ? { ...e, sheet: reactive() } : e,
    ),
    {
      type: 'items-gained',
      id: B,
      items: [{ id: 'longsword', quantity: 1 }],
      source: 'kit',
    },
    { type: 'item-equipped', id: B, item: 'longsword', armor: SRD_CONTENT.item('longsword')?.armor ?? null },
  ];
  // B's turn, so B may take the Attack action.
  const turned = [...log, ...unwrap(resolveTurn(fold('s', log), supply()), 'turn').events];
  const swing = unwrap(
    resolveAttack(
      fold('s', turned),
      B,
      { target: A, weapon: 'longsword', attackBonuses: [{ source: 'forced', flat: 40 }] },
      supply(),
    ),
    'swing',
  );
  return [...turned, ...swing.events];
};

/** B's swing at A is held, so A's Parry has a blow to answer. */
const parried = (): readonly GameEvent[] => {
  const log: readonly GameEvent[] = [
    ...SETUP.map((e) =>
      e.type === 'creature-added' && e.id === A ? { ...e, sheet: reactive() } : e,
    ),
    { type: 'items-gained', id: B, items: [{ id: 'longsword', quantity: 1 }], source: 'kit' },
    {
      type: 'item-equipped',
      id: B,
      item: 'longsword',
      armor: SRD_CONTENT.item('longsword')?.armor ?? null,
    },
  ];
  const turned = [...log, ...unwrap(resolveTurn(fold('s', log), supply()), 'turn').events];
  // Forced high and **held**, which is what makes the window this one: the
  // hold is the attacker's to ask for, and Parry answers a hit that has one.
  const swing = unwrap(
    resolveAttack(
      fold('s', turned),
      B,
      {
        target: A,
        weapon: 'longsword',
        hold: true,
        attackBonuses: [{ source: 'forced', flat: 40 }],
      },
      supply(),
    ),
    'swing',
  );
  return [...turned, ...swing.events];
};

/** A has rolled a save that A's own feature could push. */
const tested = (): readonly GameEvent[] => {
  const log: readonly GameEvent[] = SETUP.map((e) =>
    e.type === 'creature-added' && e.id === A ? { ...e, sheet: reactive() } : e,
  );
  return [
    ...log,
    ...unwrap(
      resolveTest(fold('s', log), A, { kind: 'saving-throw', ability: 'dex', dc: 25 }, supply()),
      'test',
    ).events,
  ];
};

/** A has just been hurt by B, who is standing next to them. */
const stung = (): readonly GameEvent[] => {
  const log: readonly GameEvent[] = [
    ...SETUP.map((e) =>
      e.type === 'creature-added' && e.id === A ? { ...e, sheet: reactive() } : e,
    ),
    { type: 'items-gained', id: A, items: [{ id: 'mace', quantity: 1 }], source: 'kit' },
  ];
  return [
    ...log,
    ...unwrap(
      resolveDamage(fold('s', log), A, { amount: 9, source: 'Longsword', by: B }, supply()),
      'damage',
    ).events,
  ];
};

/**
 * A casting that is still running and can be acted through on a later turn.
 *
 * Vampiric Touch, because it is the shape: the casting spends the Action, the
 * turn comes round, and the spell strikes again through a record that has to
 * survive everything in between.
 */
/**
 * A glyph inscribed on the threshold beside A, with B standing in its Sphere:
 * the hour declared, waited out and settled, so `triggerGlyph` has a record to
 * fire and somebody to catch.
 */
const glyphed = (): readonly GameEvent[] => {
  const inscribing: readonly GameEvent[] = [
    // No fight, because the hour is declared on the clock — see OUT_OF_COMBAT.
    ...OUT_OF_COMBAT,
    {
      type: 'spellcasting-declared',
      id: A,
      spellcasting: declaredCasting({ ability: 'int', prepared: ['glyph-of-warding'] }),
    },
    {
      type: 'resource-pool-declared',
      id: A,
      pool: { key: spellSlotKey(3), label: 'level 3 spell slot', max: 2, recovers: 'long-rest' },
    },
  ];
  const declared = unwrap(
    resolveSpell(
      fold('s', inscribing),
      A,
      { spellId: 'glyph-of-warding', targets: [], at: { x: 100, y: 105, z: 0 }, damageType: 'fire' },
      supply(),
    ),
    'inscribe',
  );
  let log: readonly GameEvent[] = [...inscribing, ...declared.events];
  log = [...log, ...unwrap(advanceTime(fold('s', log), 3600, 'the hour'), 'the hour')];
  const settled = unwrap(resolveDeclaredCast(fold('s', log), 'cast:1', supply()), 'settle');
  return [...log, ...settled.events];
};

const draining = (): readonly GameEvent[] => {
  const armed: readonly GameEvent[] = [
    ...SETUP,
    {
      type: 'spellcasting-declared',
      id: A,
      spellcasting: declaredCasting({
        ability: 'int',
        prepared: ['inflict-wounds', 'disguise-self', 'vampiric-touch'],
      }),
    },
    {
      type: 'resource-pool-declared',
      id: A,
      pool: { key: spellSlotKey(3), label: 'level 3 spell slot', max: 2, recovers: 'long-rest' },
    },
  ];
  const cast = [
    ...armed,
    ...unwrap(
      resolveSpell(fold('s', armed), A, { spellId: 'vampiric-touch', targets: [B], slotLevel: 3 }, supply()),
      'drain',
    ).events,
  ];
  // The casting was the Action; the turn has to come round before the spell
  // can be used again.
  let log: readonly GameEvent[] = cast;
  for (let n = 0; n < 2; n += 1) {
    log = [...log, ...unwrap(resolveTurn(fold('s', log), supply()), 'turn').events];
  }
  return log;
};

/**
 * A in a mist of A's own making, with the Magic action the book charges for
 * getting out of it still unspent.
 *
 * SRD Gaseous Form is the one casting in the book whose **target** may end it,
 * and the caster may be the target — "a willing creature you touch", which
 * includes you — so one creature is enough for the retry to be about the
 * ending rather than about whose spell it is.
 */
const misting = (): readonly GameEvent[] => {
  const armed: readonly GameEvent[] = [
    ...SETUP,
    {
      type: 'spellcasting-declared',
      id: A,
      spellcasting: declaredCasting({ ability: 'int', prepared: ['gaseous-form'] }),
    },
    {
      type: 'resource-pool-declared',
      id: A,
      pool: { key: spellSlotKey(3), label: 'level 3 spell slot', max: 2, recovers: 'long-rest' },
    },
  ];
  const cast = [
    ...armed,
    ...unwrap(
      resolveSpell(fold('s', armed), A, { spellId: 'gaseous-form', targets: [A], slotLevel: 3 }, supply()),
      'the mist',
    ).events,
  ];
  // The casting was the Action; the turn has to come round before the cloud
  // has one to spend on getting out.
  let log: readonly GameEvent[] = cast;
  for (let n = 0; n < 2; n += 1) {
    log = [...log, ...unwrap(resolveTurn(fold('s', log), supply()), 'turn').events];
  }
  return log;
};

/**
 * A holding a conjured thing, and a hand that can let go of it.
 *
 * Goodberry, because it is the smallest of the shape: the casting puts ten
 * berries in A's hand and they are there until the spell ends. Letting go of
 * them is a command that emits a loss, and a retry that got past the guard
 * would drop a second handful nobody has.
 */
const berried = (): readonly GameEvent[] => {
  const armed: readonly GameEvent[] = [
    ...SETUP,
    {
      type: 'spellcasting-declared',
      id: A,
      spellcasting: declaredCasting({
        ability: 'int',
        prepared: ['inflict-wounds', 'disguise-self', 'goodberry'],
      }),
    },
  ];
  return [
    ...armed,
    ...unwrap(
      resolveSpell(fold('s', armed), A, { spellId: 'goodberry', targets: [], slotLevel: 1 }, supply()),
      'goodberry',
    ).events,
  ];
};

/**
 * The same, with Flame Blade let go of — so the blade can be evoked again.
 *
 * SRD: "If you let go of the blade, it disappears, but you can evoke the blade
 * again as a Bonus Action." A retry of the evocation that got past the guard
 * would conjure a second blade and spend a second Bonus Action.
 */
/**
 * A's longsword on the floor at A's feet, for the command that picks one up.
 *
 * Through `dropItem` rather than hand-written, because a hand-written
 * `item-dropped` is the one shape the fold refuses: the record on it has to be
 * the next one the engine would issue, and only the command knows which that
 * is.
 */
const dropped = (): readonly GameEvent[] => [
  ...SETUP,
  ...unwrap(dropItem(fold('s', SETUP), SRD_CONTENT, A, { item: 'longsword' }), 'put down'),
];

const blademless = (): readonly GameEvent[] => {
  const armed: readonly GameEvent[] = [
    ...SETUP,
    {
      type: 'spellcasting-declared',
      id: A,
      spellcasting: declaredCasting({
        ability: 'int',
        prepared: ['inflict-wounds', 'disguise-self', 'flame-blade'],
      }),
    },
    {
      type: 'resource-pool-declared',
      id: A,
      pool: { key: spellSlotKey(2), label: 'level 2 spell slot', max: 2, recovers: 'long-rest' },
    },
  ];
  const cast = [
    ...armed,
    ...unwrap(
      resolveSpell(fold('s', armed), A, { spellId: 'flame-blade', targets: [], slotLevel: 2 }, supply()),
      'flame-blade',
    ).events,
  ];
  // The casting was A's Bonus Action; the turn has to come round before the
  // blade can be evoked again, exactly as `draining` waits for the Action.
  let log: readonly GameEvent[] = [
    ...cast,
    ...unwrap(dropConjured(fold('s', cast), SRD_CONTENT, A, 'flame-blade'), 'let go'),
  ];
  for (let n = 0; n < 2; n += 1) {
    log = [...log, ...unwrap(resolveTurn(fold('s', log), supply()), 'turn').events];
  }
  return log;
};

/**
 * A holding a Heroism on itself, which owes it Temporary Hit Points at the
 * start of each of its turns.
 *
 * The fixture for the boundary a fight *opens* on: `beginCombat` starts the
 * first combatant's turn, so opening a fight on A pays the payout — and a
 * retried opening that got past the guard would pay one turn twice.
 */
const heroic = (): readonly GameEvent[] => {
  const armed: readonly GameEvent[] = [
    ...SETUP,
    {
      type: 'spellcasting-declared',
      id: A,
      spellcasting: declaredCasting({
        ability: 'int',
        prepared: ['inflict-wounds', 'disguise-self', 'heroism'],
      }),
    },
  ];
  return [
    ...armed,
    ...unwrap(
      resolveSpell(fold('s', armed), A, { spellId: 'heroism', targets: [A], slotLevel: 1 }, supply()),
      'heroism',
    ).events,
  ];
};

/**
 * The same boundary, over a payout that throws dice.
 *
 * **Why a homebrew spell and not one out of the book.** Every SRD per-turn
 * payout hands over a printed number or an ability modifier — Heroism's
 * Temporary Hit Points, Regenerate's one Hit Point — so `heroic()` drives the
 * arm of `settleTurnPayouts` that rolls nothing, and the sweep below it
 * reported `drawn: 0` for a command that rolls at every other boundary it
 * pays. A fixture is the only way to reach the arm that does, and the door a
 * fixture reaches it through is the one homebrew already uses: a definition,
 * validated by `createContent`, over a `Content` built with `extendContent`.
 * Not one line of the engine knows this spell exists, which is rule 4 working
 * rather than an exception to it.
 */
const ROLLING_PAYOUT: SpellDefinition = {
  id: 'ember-vigil',
  name: 'Ember Vigil',
  level: 1,
  school: 'abjuration',
  castingTime: 'action',
  concentration: true,
  durationSeconds: 60,
  range: { kind: 'touch' },
  targets: { count: 1, self: true },
  effects: [
    // The whole of the fixture: a payout carrying a notation, so the boundary
    // that settles it has a die to throw.
    { kind: 'turn-payout', at: 'start-of-turn', payout: 'temporary-hit-points', dice: '1d4' },
  ],
};

/** The book, plus that one spell. */
const WITH_A_ROLLING_PAYOUT: Content = unwrap(
  extendContent(SRD_CONTENT, { spells: [ROLLING_PAYOUT] }),
  'the book with a rolling payout in it',
);

/** A holding that spell on itself, exactly as `heroic()` holds Heroism. */
const vigilant = (): readonly GameEvent[] => {
  const armed: readonly GameEvent[] = [
    ...SETUP,
    {
      type: 'spellcasting-declared',
      id: A,
      spellcasting: declaredCasting({ ability: 'int', prepared: ['ember-vigil'] }),
    },
  ];
  return [
    ...armed,
    ...unwrap(
      resolveSpell(
        fold('s', armed),
        A,
        { spellId: 'ember-vigil', targets: [A], slotLevel: 1 },
        supply('s', WITH_A_ROLLING_PAYOUT),
      ),
      'the vigil',
    ).events,
  ];
};

/**
 * A Spiritual Weapon standing in the scene, one turn old.
 *
 * A different shape from `draining()` above and the reason it is here: the
 * activation moves a **point** as well as rolling an attack, so a retry that
 * slipped past the guard would walk the force twenty feet a second time. The
 * casting is a Bonus Action, so the turn has to come round before it can be
 * used again.
 */
const conjured = (): readonly GameEvent[] => {
  const armed: readonly GameEvent[] = [
    ...SETUP,
    {
      type: 'resource-pool-declared',
      id: A,
      pool: { key: spellSlotKey(2), label: 'level 2 spell slot', max: 2, recovers: 'long-rest' },
    },
    {
      type: 'spellcasting-declared',
      id: A,
      spellcasting: declaredCasting({ ability: 'int', prepared: ['spiritual-weapon'] }),
    },
  ];
  const cast = [
    ...armed,
    ...unwrap(
      resolveSpell(
        fold('s', armed),
        A,
        { spellId: 'spiritual-weapon', targets: [], at: { x: 100, y: 120, z: 0 }, slotLevel: 2 },
        supply(),
      ),
      'conjure',
    ).events,
  ];
  let log: readonly GameEvent[] = cast;
  for (let n = 0; n < 2; n += 1) {
    log = [...log, ...unwrap(resolveTurn(fold('s', log), supply()), 'turn').events];
  }
  return log;
};

/**
 * A creature standing in a Grease it has just walked into, with the save owed.
 *
 * The debt is raised by the fold of `creature-moved` rather than by any
 * command, so the retry that matters is the **settlement**: a second run would
 * roll a second Dexterity save against a slick the first one already dealt
 * with.
 *
 * Three details, each of which the fixture was silently wrong about before:
 *
 * - **A Cube does not include its point of origin**, so walking to the
 *   landmark the Grease was cast at enters nothing. Five feet further in is
 *   what puts a creature in the area, and the earlier fixture's zero-foot walk
 *   raised no debt at all — the same trap `area-triggers.test.ts` records
 *   under "a test that passes for the wrong reason".
 * - **A declared move raises nothing.** Leaving A's reach provokes, and the
 *   entry comes from the `creature-moved` that completing the move writes.
 * - **B walks in rather than A**, so the creature that owes the save still has
 *   an Action, a Bonus Action and a Reaction — which is what lets the `mayAct`
 *   sweep below say that the debt is the only reason anything was refused.
 */
const greased = (): readonly GameEvent[] => {
  const armed: readonly GameEvent[] = [
    ...SETUP,
    {
      type: 'spellcasting-declared',
      id: A,
      spellcasting: declaredCasting({ ability: 'int', prepared: ['grease'] }),
    },
    { type: 'landmark-added', name: 'the slick', at: { x: 120, y: 100, z: 0 } },
  ];
  const cast = [
    ...armed,
    ...unwrap(
      resolveSpell(
        fold('s', armed),
        A,
        {
          spellId: 'grease',
          targets: [],
          at: { x: 120, y: 100, z: 0 },
          towards: { x: 200, y: 100, z: 0 },
          slotLevel: 1,
        },
        supply(),
      ),
      'grease',
    ).events,
  ];
  const turned = [...cast, ...unwrap(resolveTurn(fold('s', cast), supply()), 'on to B').events];
  const declared = [
    ...turned,
    ...unwrap(
      resolveMove(
        fold('s', turned),
        B,
        {
          placement: { from: { landmark: 'the slick' }, feet: 5, bearing: 0 },
          // **The grease is Difficult Terrain now**, which changes two things
          // about this walk and neither is the fixture's subject.
          //
          // The ruler will not guess which spaces a move crossed when they
          // charge different rates, so the route is stated: four steps from
          // (100, 105) to (120, 105), of which only the last is on the slick.
          //
          // And it goes **north** of the point rather than east of it,
          // because five feet east is a second space of grease and a
          // 25-foot walk with two of them costs 35 — more than a Speed of
          // 30. One space in is still in, which is all the entry clause
          // asks, and the origin space itself is still excluded.
          route: [
            { x: 105, y: 105, z: 0 },
            { x: 110, y: 105, z: 0 },
            { x: 115, y: 105, z: 0 },
            { x: 120, y: 105, z: 0 },
          ],
        },
        supply(),
      ),
      'walking in',
    ).events,
  ];
  return [...declared, ...unwrap(declineOpportunity(fold('s', declared), A, {}), 'A lets B go')];
};

/**
 * `greased()`'s shape with one thing changed: the casting that owes the save is
 * the one its caster is **concentrating** on.
 *
 * SRD Web is "Concentration, up to 1 hour" and calls for its Dexterity save on
 * entry, so A holds the casting and the save B owes belongs to that same
 * casting. That is the world the guard on `endConcentration` is about: letting
 * go runs `releaseCasting`, which drops the casting's outstanding
 * `OwedAreaEffect`s, so an unguarded door out would forgive a save the boundary
 * had already raised rather than merely acting while somebody else's debt
 * stood.
 *
 * A second-level slot and a second `spellcasting-declared` are all it takes
 * over `greased()`: Web is level 2 where Grease is level 1, and the rest of the
 * choreography — the landmark, the five feet past it, the declared move
 * completed by A declining the Opportunity Attack — is deliberately the same,
 * so the two blocks below differ in the casting and in nothing else.
 */
const webbed = (): readonly GameEvent[] => {
  const armed: readonly GameEvent[] = [
    ...SETUP,
    {
      type: 'resource-pool-declared',
      id: A,
      pool: { key: spellSlotKey(2), label: 'level 2 spell slot', max: 3, recovers: 'long-rest' },
    },
    {
      type: 'spellcasting-declared',
      id: A,
      spellcasting: declaredCasting({ ability: 'int', prepared: ['web'] }),
    },
    { type: 'landmark-added', name: 'the webs', at: { x: 120, y: 100, z: 0 } },
  ];
  const cast = [
    ...armed,
    ...unwrap(
      resolveSpell(
        fold('s', armed),
        A,
        {
          spellId: 'web',
          targets: [],
          at: { x: 120, y: 100, z: 0 },
          towards: { x: 200, y: 100, z: 0 },
          slotLevel: 2,
        },
        supply(),
      ),
      'web',
    ).events,
  ];
  const turned = [...cast, ...unwrap(resolveTurn(fold('s', cast), supply()), 'on to B').events];
  const declared = [
    ...turned,
    ...unwrap(
      resolveMove(
        fold('s', turned),
        B,
        {
          // The same walk `greased()` makes, and the same two reasons for its
          // shape: the webs are Difficult Terrain, so the route is stated
          // rather than guessed, and it goes north of the point rather than
          // east so that one space of webbing is crossed instead of two.
          placement: { from: { landmark: 'the webs' }, feet: 5, bearing: 0 },
          route: [
            { x: 105, y: 105, z: 0 },
            { x: 110, y: 105, z: 0 },
            { x: 115, y: 105, z: 0 },
            { x: 120, y: 105, z: 0 },
          ],
        },
        supply(),
      ),
      'walking in',
    ).events,
  ];
  return [...declared, ...unwrap(declineOpportunity(fold('s', declared), A, {}), 'A lets B go')];
};

/** B on the floor at 0 hit points, which is the only state a stabilisation has. */
const DYING: readonly GameEvent[] = [
  ...SETUP,
  ...unwrap(damageCreature(fold('s', SETUP), B, { amount: 60, source: 'a spear' }), 'down'),
];

/** A carrying a bonus that no casting hung, so no cleanup would ever remove it. */
const BLESSED: readonly GameEvent[] = [
  ...SETUP,
  {
    type: 'bonus-applied',
    id: A,
    bonus: {
      source: 'a quiet word',
      bonus: { source: 'a quiet word', flat: 1 },
      applies: ['save'],
      direction: 'add',
    },
  },
];

/**
 * A Large horse beside A, because SRD requires a mount "at least one size
 * larger than a rider" and every creature in `SETUP` is Medium.
 */
const HORSE = id('horse');
const STABLED: readonly GameEvent[] = [
  ...SETUP,
  added(HORSE, 'party'),
  {
    type: 'creature-placed',
    id: HORSE,
    placement: { from: { creature: A }, feet: 10, bearing: 180, size: 'large' },
  },
];

const RIDING: readonly GameEvent[] = [
  ...STABLED,
  ...unwrap(mountCreature(fold('s', STABLED), A, HORSE, { willing: true }), 'up'),
];

/**
 * A rite of a minute or more, open, with the turn come round to its caster.
 *
 * SRD "Longer Casting Times" puts the Magic action on **each of the caster's
 * turns**, so the retry that matters here is the second one: it would spend a
 * second Action on a turn that has none left, and the boundary reads which turn
 * last saw the rite — so a retry arriving on the *next* turn would keep alive a
 * casting the rules had already failed.
 *
 * `resolveCast` is the low-level half, which takes the casting time and the
 * seconds directly, because no definition in the catalogue declares a long
 * casting time yet.
 */
const reciting = (): readonly GameEvent[] => {
  const declared: readonly GameEvent[] = [
    ...SETUP,
    ...unwrap(
      resolveCast(fold('s', SETUP), A, {
        spell: 'Comprehend Languages',
        level: 1,
        slotLevel: 1,
        castingTime: 'long',
        castingSeconds: 60,
        hold: { spellId: 'comprehend-languages', targets: [], unverified: [] },
      }),
      'the rite',
    ),
  ];
  // A's own turn ends with the declaration standing in for its Magic action;
  // B's ends owing nothing. The turn is then A's again, and the rite is owed.
  let log: readonly GameEvent[] = declared;
  for (let n = 0; n < 2; n += 1) {
    log = [...log, ...unwrap(resolveTurn(fold('s', log), supply()), 'turn').events];
  }
  return log;
};

const RECITING = reciting();
const RITE = Object.keys(fold('s', RECITING).pendingCastings)[0]!;

/**
 * A parsed stat block, for the one command that takes one.
 *
 * `addCreature` takes the stat block's **id** and reads the block out of
 * content, so the sweep names one the SRD catalogue holds and nothing here
 * opens the bestiary.
 */
const ZOMBIE = 'zombie';

/**
 * A creature standing on a spell that has already ended.
 *
 * `dismissStrandedSummons` sweeps what the fold noticed, so a fixture with
 * nothing stranded would run it twice with nothing to do and prove nothing
 * about its identity. A's Disguise Self holds a Zombie; the Disguise Self is
 * then dismissed, and the Zombie is owed a departure.
 */
/**
 * B elsewhere under a casting that has ended, so the way back is open and the
 * return is the debt `resolveTurn` refuses on.
 */
const AWAY: readonly GameEvent[] = [
  ...SETUP,
  { type: 'creature-sent-elsewhere', id: B, kind: 'ethereal', source: 'Gone#cast:9', returns: { within: 10 } },
];

/** A's Rope Trick hanging beside B, with room inside for B to climb. */
const ROPED: readonly GameEvent[] = (() => {
  const roped: readonly GameEvent[] = [
    ...SETUP.map((event) =>
      event.type === 'spellcasting-declared' && event.id === A
        ? { ...event, spellcasting: declaredCasting({ ability: 'int', prepared: ['rope-trick'] }) }
        : event,
    ),
    {
      type: 'resource-pool-declared',
      id: A,
      pool: { key: spellSlotKey(2), label: 'level 2 spell slot', max: 2, recovers: 'long-rest' },
    },
  ];
  const cast = unwrap(
    resolveSpell(
      fold('s', roped),
      A,
      { spellId: 'rope-trick', targets: [], at: { x: 100, y: 100, z: 0 }, slotLevel: 2 },
      supply(),
    ),
    'the rope',
  );
  return [...roped, ...cast.events];
})();

/** An owl A keeps on Find Familiar's terms, with the pocket the spell prints. */
const KEPT: readonly GameEvent[] = [
  ...SETUP,
  ...unwrap(
    summonCreature(fold('s', SETUP), SRD_CONTENT, {
      id: id('an-owl'),
      monsterId: 'owl',
      by: A,
      kept: { spell: 'find-familiar', untilSummonerDies: false, pocket: { within: 30 } },
      placement: { from: { creature: A }, feet: 10, bearing: 180 },
      initiative: 15,
    }),
    'the owl',
  ).events,
];

/** And the same owl dismissed to its pocket, so a recall has something to recall. */
const POCKETED: readonly GameEvent[] = [
  ...KEPT,
  {
    type: 'creature-sent-elsewhere',
    id: id('an-owl'),
    kind: 'extradimensional',
    source: 'kept:a/find-familiar',
    returns: { within: 30, near: A },
  },
];

const STRANDED: readonly GameEvent[] = (() => {
  const cast = unwrap(
    resolveSpell(fold('s', SETUP), A, { spellId: 'disguise-self', targets: [] }, supply()),
    'the disguise',
  );
  let log: readonly GameEvent[] = [...SETUP, ...cast.events];
  log = [
    ...log,
    ...unwrap(
      summonCreature(fold('s', log), SRD_CONTENT, {
        id: id('a-summoned-thing'),
        monsterId: ZOMBIE,
        by: A,
        castingId: cast.castingId!,
        initiative: 14,
      }),
      'the summons',
    ).events,
  ];
  return [...log, ...unwrap(endOngoingSpell(fold('s', log), A, cast.castingId!, null), 'the end')];
})();

/**
 * A thing a feature made, standing five feet from its maker.
 *
 * SRD Gnomish Lineage's clockwork device in the sweep's own vocabulary: the
 * making is refused inside a fight — ten minutes of casting is not something a
 * round holds — so it is built in the world with no fight in it, which is the
 * same reading `advanceTime`'s fixture takes and for the same reason.
 */
const DEVICE = id('a-tinkered-thing');

const TINKERED: readonly GameEvent[] = [
  ...OUT_OF_COMBAT,
  ...unwrap(
    createDevice(fold('s', OUT_OF_COMBAT), A, {
      feature: 'test:tinker',
      device: DEVICE,
      name: 'a tinkered thing',
      function: 'it whistles',
      placement: { from: { creature: A }, feet: 5, bearing: 180 },
    }),
    'the tinkering',
  ),
];

/**
 * And the same world with the fight started afterwards, for the one command
 * whose price only exists inside one: pressing the button costs a Bonus
 * Action, and outside a fight there is no economy to spend from — so a sweep
 * run out of combat would be reading a command that did nothing.
 */
const TINKERED_IN_COMBAT: readonly GameEvent[] = [
  ...TINKERED,
  ...SETUP.filter((event) => event.type === 'combat-started'),
];

const GUARDED: readonly Guarded[] = [
  {
    // The making itself, which is the retry question `addCreature` asks with a
    // clock attached: the same id twice is one device, and a second run that
    // got past the guard would spend another ten minutes and stand a second
    // thing in the room.
    name: 'createDevice',
    log: OUT_OF_COMBAT,
    run: (s, commandId) =>
      createDevice(s, A, {
        feature: 'test:tinker',
        device: DEVICE,
        name: 'a tinkered thing',
        function: 'it whistles',
        placement: { from: { creature: A }, feet: 5, bearing: 180 },
        commandId,
      }),
  },
  {
    name: 'dismantleDevice',
    log: TINKERED,
    run: (s, commandId) => dismantleDevice(s, A, { device: DEVICE, commandId }),
  },
  {
    // In the fight, because what a retry could spend twice is the Bonus Action.
    name: 'activateDevice',
    log: TINKERED_IN_COMBAT,
    run: (s, commandId) => activateDevice(s, A, { device: DEVICE, commandId }),
  },
  {
    name: 'settleAreaEffects',
    log: greased(),
    run: (s, commandId) => settleAreaEffects(s, supply(), { commandId }),
  },
  {
    name: 'addCreature',
    log: SETUP,
    run: (s, commandId) => addCreature(s, SRD_CONTENT, id('a-zombie'), ZOMBIE, { commandId }),
  },
  {
    name: 'dismissStrandedSummons',
    // A's Disguise Self was holding a Zombie and has already been dismissed,
    // so the sweep has exactly one creature to take away — and a retry under
    // one id is the difference between one departure and a refusal.
    log: STRANDED,
    run: (s, commandId) => dismissStrandedSummons(s, { commandId }),
  },
  {
    name: 'summonCreature',
    log: SETUP,
    // A fight is running in SETUP, so the total is supplied rather than
    // asked for; the summons is bound to no casting, which is the Animate
    // Dead reading and keeps this entry about the identity and nothing else.
    run: (s, commandId) =>
      summonCreature(
        s,
        SRD_CONTENT,
        { id: id('a-hound'), monsterId: ZOMBIE, by: A, initiative: 14 },
        { commandId },
      ),
  },
  {
    name: 'continueCasting',
    log: RECITING,
    run: (s, commandId) => continueCasting(s, A, RITE, { commandId }),
  },
  /**
   * Letting go of a conjured thing, and evoking it again. Each emits an
   * inventory event of its own — a handful that disappears, a blade that comes
   * back — and the second spends a Bonus Action with it.
   */
  {
    name: 'dropConjured',
    log: berried(),
    run: (s, commandId) => dropConjured(s, SRD_CONTENT, A, 'goodberry', commandId),
  },
  {
    name: 'evokeConjured',
    log: blademless(),
    run: (s, commandId) => evokeConjured(s, A, { item: 'flame-blade', commandId }, supply()),
  },
  /**
   * Putting something down and taking it up again. Both write one event
   * apiece — the item leaves the pack and lies in the room, and the reverse —
   * and both are exactly the sort a retry would do twice: a second drop of a
   * longsword the first drop already put on the floor mints a second record
   * for a sword that is not there.
   */
  {
    name: 'dropItem',
    log: SETUP,
    run: (s, commandId) => dropItem(s, SRD_CONTENT, A, { item: 'longsword', commandId }),
  },
  {
    name: 'takeItemUp',
    log: dropped(),
    run: (s, commandId) => takeItemUp(s, SRD_CONTENT, A, { item: 'longsword', commandId }),
  },
  /**
   * The Unarmed Strike's other two options. Each throws the target's save, so
   * a retry that was not caught would throw a second one — a creature saving
   * twice against one grab.
   */
  {
    name: 'grappleTarget',
    log: SETUP,
    run: (s, commandId) => grappleTarget(s, A, { target: B, save: 'dex', commandId }, supply()),
  },
  {
    name: 'shoveTarget',
    log: SETUP,
    run: (s, commandId) =>
      shoveTarget(s, A, { target: B, save: 'dex', outcome: 'prone', commandId }, supply()),
  },
  {
    name: 'escapeGrapple',
    log: HELD,
    run: (s, commandId) => escapeGrapple(s, B, { ability: 'str', commandId }, supply()),
  },
  {
    name: 'detachFrom',
    log: ATTACHED_THEIR_TURN,
    run: (s, commandId) => detachFrom(s, B, { holder: A, from: B, commandId }, supply()),
  },
  {
    name: 'letGoOfAttachment',
    log: ATTACHED,
    run: (s, commandId) => letGoOfAttachment(s, A, { from: B, commandId }),
  },
  {
    name: 'damageCreature',
    log: SETUP,
    run: (s, commandId) => damageCreature(s, B, { amount: 7, source: 'a trap', commandId }),
  },
  {
    name: 'healCreature',
    log: [...SETUP, ...unwrap(damageCreature(fold('s', SETUP), B, { amount: 30, source: 'a trap' }), 'd')],
    run: (s, commandId) => healCreature(s, B, 5, { commandId }),
  },
  {
    name: 'takeStatedBonusAction',
    log: LINED,
    run: (s, commandId) => takeStatedBonusAction(s, A, { line: PRINTED_LINE.name, commandId }),
  },
  {
    name: 'takeStatedAction',
    log: UNREAD,
    run: (s, commandId) => takeStatedAction(s, A, { line: PRINTED_LINE.name, commandId }),
  },
  {
    name: 'forcePrintedSave',
    log: FORCED,
    run: (s, commandId) =>
      forcePrintedSave(s, A, { line: SAVING_LINE.name, targets: [B], commandId }, supply()),
  },
  /**
   * The same shape again, on the third door one line can be taken through. A
   * retry that was not guarded would spend a second Action and move the
   * creature a second time, which is the most visible kind of double landing
   * there is.
   */
  {
    name: 'takePrintedTeleport',
    log: BLINKING,
    run: (s, commandId) =>
      takePrintedTeleport(s, A, {
        line: TELEPORTING_LINE.name,
        to: { from: { landmark: 'here' }, feet: 10, bearing: 180 },
        commandId,
      }),
  },
  /**
   * And the fourth door one line can be taken through. A retry that was not
   * guarded would spend a second Action and put the creature into the form
   * twice — which, on a line whose form prints a size, is a second resizing.
   */
  {
    name: 'takePrintedForm',
    log: SHIFTING,
    run: (s, commandId) =>
      takePrintedForm(s, A, { line: SHIFTING_LINE.name, form: 'wolf', commandId }),
  },
  /**
   * And the fifth. Nothing is held in this fixture, so the pull moves nobody
   * and the guard is about the *slot*: a retry that was not guarded would
   * spend a second Action for the same line.
   */
  {
    name: 'takePrintedPull',
    log: PULLING,
    run: (s, commandId) => takePrintedPull(s, A, { line: PULLING_LINE.name, commandId }),
  },
  /**
   * The legendary door, on the moment just after B's turn began with nothing
   * spent. A retry that was not guarded would spend a second use and shield
   * twice under one id.
   */
  {
    name: 'takeLegendaryAction',
    log: LEGENDARY,
    run: (s, commandId) =>
      takeLegendaryAction(s, A, { line: SHIELD_LINE.name, commandId }, supply()),
  },
  /**
   * The two roads a stat block prints into the second place. A retry that was
   * not guarded would spend a second Action; on the swallow it would also be
   * refused by the fold as a creature leaving the scene twice.
   */
  {
    name: 'takePrintedSwallow',
    log: SWALLOWING,
    run: (s, commandId) => takePrintedSwallow(s, A, { line: SWALLOWING_LINE.name, target: B, commandId }),
  },
  {
    name: 'takePrintedPlaneShift',
    log: STEPPING,
    run: (s, commandId) => takePrintedPlaneShift(s, A, { line: STEPPING_LINE.name, commandId }),
  },
  /**
   * The second place's way back and the two doors on a kept summons. A retry
   * that was not guarded would stand B in the scene twice — the second time
   * refused by the fold as a return from nowhere — or spend a second Action.
   */
  {
    name: 'returnFromElsewhere',
    log: AWAY,
    run: (s, commandId) =>
      returnFromElsewhere(s, B, { to: { from: { landmark: 'here' }, feet: 5, bearing: 90 }, commandId }),
  },
  {
    name: 'enterElsewhere',
    log: ROPED,
    run: (s, commandId) => enterElsewhere(s, B, SRD_CONTENT, { castingId: 'cast:1', commandId }),
  },
  {
    name: 'dismissKeptSummons',
    log: KEPT,
    run: (s, commandId) => dismissKeptSummons(s, A, { who: id('an-owl'), commandId }),
  },
  {
    name: 'recallKeptSummons',
    log: POCKETED,
    run: (s, commandId) =>
      recallKeptSummons(s, A, { who: id('an-owl'), to: { from: { creature: A }, feet: 10, bearing: 180 }, commandId }),
  },
  /**
   * And the sixth, which is the most expensive retry of them: a second
   * run under one id would be a second casting with a second id, a second
   * Concentration and a second day's use gone.
   */
  {
    name: 'castPrintedLine',
    log: CASTING,
    run: (s, commandId) =>
      castPrintedLine(
        s,
        A,
        { line: CASTING_LINE.name, spell: 'bless', casting: { targets: [A] }, commandId },
        supply(),
      ),
  },
  /**
   * The five the glossary prints that arrived with their spenders. Each is a
   * command a retry would do twice in a visible way: a Utilize is a second
   * Action gone, a Search or a Study or an Influence is a second turn of the
   * dice, and a Help is a second Advantage hung on the ally.
   */
  { name: 'takeUtilize', log: SETUP, run: (s, commandId) => takeUtilize(s, A, { commandId }) },
  /**
   * SRD *Burning*: an Action to put a fire out. A retry is a second Action
   * gone and a second Prone, on a fire that was already out.
   */
  {
    name: 'extinguishFire',
    log: [...SETUP, { type: 'hazard-caught', id: A, hazard: { hazard: 'burning', lit: 'Burn' } }],
    run: (s, commandId) => extinguishFire(s, A, { commandId }),
  },
  {
    name: 'takeSearch',
    log: SETUP,
    run: (s, commandId) => takeSearch(s, A, { skill: 'perception', dc: 10, commandId }, supply()),
  },
  {
    name: 'takeStudy',
    log: SETUP,
    run: (s, commandId) => takeStudy(s, A, { skill: 'arcana', dc: 10, commandId }, supply()),
  },
  {
    name: 'takeInfluence',
    log: SETUP,
    run: (s, commandId) =>
      takeInfluence(s, A, { skill: 'persuasion', dc: 10, target: B, commandId }, supply()),
  },
  {
    // An ally who is not in the order: SRD hangs the benefit on them and the
    // deadline on the **helper's** next turn, so only the helper needs a place
    // in it.
    name: 'takeHelp',
    log: [...SETUP, added(C, 'party')],
    run: (s, commandId) => takeHelp(s, A, { kind: 'attack', ally: C, enemy: B, commandId }),
  },
  { name: 'takeDash', log: SETUP, run: (s, commandId) => takeDash(s, A, { commandId }) },
  { name: 'takeDisengage', log: SETUP, run: (s, commandId) => takeDisengage(s, A, { commandId }) },
  { name: 'takeDodge', log: SETUP, run: (s, commandId) => takeDodge(s, A, { commandId }) },
  {
    // SRD Sleep: "someone within 5 feet of it takes an action to shake it out
    // of the spell's effect." B is five feet from A and holds a condition a
    // printed line marked, which is what the verb refuses without.
    name: 'wakeCreature',
    log: [
      ...SETUP,
      {
        type: 'condition-applied',
        id: B,
        condition: 'unconscious',
        source: 'a pseudodragon sting',
        endsWhenWoken: ['unconscious'],
      },
    ],
    run: (s, commandId) => wakeCreature(s, A, { target: B }, { commandId }),
  },
  {
    name: 'takeHide',
    log: lurking(),
    run: (s, commandId) => takeHide(s, A, { commandId }, supply()),
  },
  {
    name: 'takeReady',
    log: SETUP,
    run: (s, commandId) => takeReady(s, A, { trigger: 'when it moves', response: { kind: 'action' }, commandId }, SRD_CONTENT),
  },
  { name: 'releaseReady', log: readied(), run: (s, commandId) => releaseReady(s, A, { commandId }, supply()) },
  {
    name: 'declineOpportunity',
    log: provoking(),
    run: (s, commandId) => declineOpportunity(s, B, { commandId }),
  },
  {
    name: 'resolveMove',
    log: SETUP,
    run: (s, commandId) =>
      resolveMove(s, A, { placement: { from: { creature: B }, feet: 15, bearing: 180 }, commandId }, supply()),
  },
  {
    name: 'resolveMove (provoking nobody)',
    log: SETUP,
    run: (s, commandId) => resolveMove(s, A, { placement: CIRCLING, commandId }, supply()),
  },
  {
    name: 'relocateCreature',
    log: SETUP,
    run: (s, commandId) =>
      relocateCreature(s, A, {
        placement: { from: { creature: B }, feet: 15, bearing: 180 },
        within: 60,
        commandId,
      }),
  },
  {
    name: 'takeOpportunityAttack',
    log: provoking(),
    run: (s, commandId) => takeOpportunityAttack(s, B, { commandId }, supply()),
  },
  {
    name: 'resolveAttack',
    log: SETUP,
    run: (s, commandId) => resolveAttack(s, A, { target: B, weapon: 'longsword', commandId }, supply()),
  },
  {
    name: 'resolveCast',
    log: SETUP,
    run: (s, commandId) =>
      resolveCast(s, A, { spell: 'Inflict Wounds', level: 1, slotLevel: 1, commandId }),
  },
  /**
   * The five the derived sweep found missing. Each calls `identify` and each
   * was absent from the hand-written list, which is exactly the silence that
   * made the list worth deriving: three of them are top-level entry points
   * with a live guard nothing exercised.
   */
  {
    name: 'castSpell',
    log: SETUP,
    run: (s, commandId) =>
      castSpell(s, A, { spell: 'Inflict Wounds', level: 1, slotLevel: 1, commandId }),
  },
  {
    name: 'activateFeature',
    log: SETUP,
    run: (s, commandId) => activateFeature(s, A, { feature: 'test:stance', commandId }, SRD_CONTENT),
  },
  {
    name: 'resolveDamage',
    log: SETUP,
    run: (s, commandId) => resolveDamage(s, B, { amount: 7, source: 'a trap', commandId }, supply()),
  },
  /**
   * The same damage with the dice still to throw, which is the retry that
   * costs something: an unguarded second send is a second 2d6 and a generator
   * two rolls further on than the log says.
   */
  {
    name: 'rollImprovisedDamage',
    log: SETUP,
    run: (s, commandId) =>
      rollImprovisedDamage(
        s,
        B,
        { dice: '2d6', damageType: 'fire', source: 'a falling brazier', commandId },
        supply(),
      ),
  },
  /**
   * And the landing, which is the same shape with the dice derived from a
   * height rather than stated: a retry that got through is a second 3d6 and a
   * second Prone.
   */
  {
    name: 'resolveFall',
    log: SETUP,
    run: (s, commandId) => resolveFall(s, B, { feet: 30, commandId }, supply()),
  },
  {
    // A hit whose damage is still to be rolled — the second half of a held
    // attack, and the most retry-vulnerable shape there is, because the caller
    // has already been round the loop once to get here.
    name: 'resolveAttackDamage',
    log: holding(),
    run: (s, commandId) => resolveAttackDamage(s, A, { commandId }, supply()),
  },
  { name: 'beginRest', log: SETUP, run: (s, commandId) => beginRest(s, A, 'short', commandId) },
  /**
   * And the other end of the same rest, which had been excused from this sweep
   * with a sentence that described the gap rather than closing it: "a retry
   * finds nobody resting and is refused `not_resting`, so no Hit Die is rolled
   * twice — but the caller cannot tell that from never having rested."
   *
   * A transport retry is the case that makes that matter. `end_rest` was the
   * one call on the tool surface whose duplicate came back as a refusal, so a
   * session that lost its connection between sending the settlement and
   * hearing the answer had no way to ask again — and the settlement it could
   * not confirm is the one that rolls dice and heals.
   */
  {
    name: 'endRest',
    log: RESTED,
    run: (s, commandId) =>
      endRest(s, A, { hitDice: [hitDieKey(8)], commandId }, supply()),
  },
  /**
   * The two the audit found taking no id at all. One **rolls dice** for
   * whatever the state happens to owe, and the other takes a creature out of
   * the game — a retry of which used to report `unknown_creature` for a
   * removal that had succeeded.
   */
  {
    name: 'resolvePendingSaves',
    log: owed(),
    run: (s, commandId) => resolvePendingSaves(s, supply(), { commandId }),
  },
  {
    name: 'removeCreatureEverywhere',
    log: SETUP,
    run: (s, commandId) => removeCreatureEverywhere(s, B, { commandId }),
  },
  {
    /**
     * And the one the sweep had been excusing with a sentence that was not
     * true. A whole refill applied twice is a whole refill, but SRD's partial
     * rule is not: "you regain **one** expended use when you finish a Short
     * Rest" subtracts from `spent`, so the fixture is a pool with that rule
     * and two uses gone — where a second run gives back a use nobody rested
     * for.
     */
    name: 'restoreResourcesOn',
    log: partiallySpent(),
    run: (s, commandId) => restoreResourcesOn(s, A, 'short-rest', { commandId }),
  },
  { name: 'resolveTurn', log: SETUP, run: (s, commandId) => resolveTurn(s, supply(), { commandId }) },
  {
    // The touch that only *lifts* a condition heals nothing and rolls
    // nothing, so the stamp has nowhere to ride but the spend itself — which
    // is exactly the shape this sweep exists to catch.
    name: 'useHealingTouch',
    log: [...vigorous(), { type: 'condition-applied', id: B, condition: 'poisoned', source: 'a spider' }],
    run: (s, commandId) =>
      useHealingTouch(s, A, { feature: 'test:healing-touch', target: B, lift: ['poisoned'], commandId }),
  },
  {
    // The conferral spends a pool use on the giver and hangs a grant on
    // somebody else, so a retry that was not caught would cost the giver twice
    // and leave the recipient holding one die — the asymmetry that makes this
    // worth sweeping rather than assuming.
    name: 'conferReaction',
    log: vigorous(),
    run: (s, commandId) => conferReaction(s, A, { feature: 'test:inspire', target: B, commandId }),
  },
  {
    name: 'useSelfHeal',
    log: vigorous(),
    run: (s, commandId) => useSelfHeal(s, A, { feature: 'test:self-heal', commandId }, supply()),
  },
  {
    name: 'assumeShape',
    log: vigorous(),
    run: (s, commandId) =>
      assumeShape(s, A, { feature: 'test:shape', form: 'wolf', commandId }, SRD_CONTENT),
  },
  {
    name: 'revertShape',
    log: shaped(),
    run: (s, commandId) => revertShape(s, A, { commandId }),
  },
  {
    name: 'useRecovery',
    log: recovering(),
    run: (s, commandId) => useRecovery(s, C, { feature: 'test:recovery', commandId }, supply()),
  },
  {
    // The trade spends one pool and refills another in one batch, so an
    // uncaught retry costs one use twice and hands two back — the same
    // asymmetry `conferReaction` above is swept for.
    name: 'tradeResource',
    log: trading(),
    run: (s, commandId) =>
      tradeResource(s, C, { feature: 'test:trade', trade: 'points-for-vigour', commandId }),
  },
  { name: 'endFeature', log: stanced(), run: (s, commandId) => endFeature(s, A, { feature: 'test:stance', commandId }) },
  {
    name: 'extendFeature',
    log: stanced(),
    run: (s, commandId) => extendFeature(s, A, { feature: 'test:stance', by: 'attack', commandId }),
  },
  /**
   * The DM-facing state changes a narrating layer reaches for constantly, and
   * the ones the first sweep did not cover. Each is a mutating tool on the
   * Maestro surface, and CLAUDE.md is explicit that every one of those takes a
   * command id — a retried "you are Frightened" is a second Frightened.
   */
  {
    name: 'applyConditionTo',
    log: SETUP,
    run: (s, commandId) => applyConditionTo(s, B, 'frightened', 'a dragon', [], undefined, undefined, { commandId }),
  },
  {
    /**
     * And the other half of the pair, which a DM reaches for exactly as
     * often: the ruling that imposed a condition is over. It emits one
     * `condition-removed` and nothing else, so the stamp has nowhere to ride
     * but that event — the shape this sweep exists to catch.
     */
    name: 'liftConditionFrom',
    log: [...SETUP, { type: 'condition-applied', id: B, condition: 'frightened', source: 'a dragon' }],
    run: (s, commandId) => liftConditionFrom(s, B, 'frightened', 'a dragon', { commandId }),
  },
  {
    name: 'endConcentration',
    log: concentrating(),
    run: (s, commandId) => endConcentration(s, A, 'voluntary', { commandId }),
  },
  { name: 'setExhaustionLevel', log: SETUP, run: (s, commandId) => setExhaustionLevel(s, B, 2, { commandId }) },
  { name: 'grantTemporaryHpTo', log: SETUP, run: (s, commandId) => grantTemporaryHpTo(s, B, 8, { commandId }) },
  {
    name: 'declareCreatureType',
    log: untyped(),
    run: (s, commandId) => declareCreatureType(s, C, 'Fey', { commandId }),
  },
  {
    /**
     * The word a stat block declined to print, ruled on by the table — and
     * **re-declarable**, which is the sharper retry question of the two above
     * it: the same id twice is one ruling, and a second under a new id is a
     * table changing its mind about which dragon this is.
     */
    name: 'declareDamageType',
    log: SETUP,
    run: (s, commandId) => declareDamageType(s, B, 'fire', { commandId }),
  },
  {
    /**
     * A door into the room, which is a creature on the roster and therefore
     * exactly the retry question `addCreature` asks: the same id twice is one
     * door, and a second under a new id would be a second thing in the world.
     */
    name: 'declareObject',
    log: SETUP,
    run: (s, commandId) =>
      declareObject(
        s,
        SRD_CONTENT,
        id('the-oak-door'),
        { name: 'the oak door', material: 'wood', size: 'medium', build: 'resilient' },
        { commandId },
      ),
  },
  {
    /**
     * A momentary fact, so the retry question is the sharper one: declaring a
     * fall again under a *new* id is a second fall and must land, while the
     * same id twice is one fall however many times it is sent.
     */
    name: 'declareFalling',
    log: SETUP,
    run: (s, commandId) => declareFalling(s, B, { commandId }),
  },
  {
    name: 'declareDifficultTerrain',
    log: SETUP,
    run: (s, commandId) =>
      declareDifficultTerrain(
        s,
        'the rubble',
        {
          region: {
            origin: { space: { x: 100, y: 100, z: 0 } },
            shape: { kind: 'sphere', radius: 10 },
          },
          commandId,
        },
      ),
  },
  {
    name: 'declareLight',
    log: SETUP,
    run: (s, commandId) =>
      declareLight(s, 'the lantern', {
        region: {
          origin: { space: { x: 100, y: 100, z: 0 } },
          shape: { kind: 'sphere', radius: 20 },
        },
        level: 'bright',
        commandId,
      }),
  },
  {
    name: 'declareObscurement',
    log: SETUP,
    run: (s, commandId) =>
      declareObscurement(s, 'the smoke', {
        region: {
          origin: { space: { x: 100, y: 100, z: 0 } },
          shape: { kind: 'sphere', radius: 20 },
        },
        degree: 'heavily',
        commandId,
      }),
  },
  /**
   * The interruptible casting pair. Both halves need the guard and for
   * different reasons: a retried declaration would open a second casting with
   * a second action gone, and a retried settlement would spend a second slot
   * and roll the spell's dice again.
   */
  {
    name: 'resolveSpell (declaring a casting)',
    log: SETUP,
    run: (s, commandId) =>
      resolveSpell(s, A, { spellId: 'inflict-wounds', targets: [B], slotLevel: 1, hold: true, commandId }, supply()),
  },
  {
    name: 'resolveDeclaredCast',
    log: declaring(),
    run: (s, commandId) => resolveDeclaredCast(s, DECLARED_CASTING, supply(), { commandId }),
  },
  /**
   * The same command on the one exit that makes no casting: the Wind Fan that
   * fails to work. A retry has no `spell-cast` to recover an id from and a fan
   * that is already in tatters, so an unguarded one would answer `not_equipped`
   * for a command that landed — the exact confusion command ids exist to
   * prevent.
   */
  {
    name: 'resolveSpell (a use of an item that fails)',
    log: TORN_NEXT,
    run: (s, commandId) =>
      resolveSpell(
        s,
        A,
        // The wind blows down a Line, so it needs a direction like any other
        // aimed area — which is the spell's own shape and not the fan's.
        { spellId: 'gust-of-wind', targets: [], towards: { x: 200, y: 100, z: 0 }, item: 'wind-fan', commandId },
        supply(),
      ),
  },
  {
    name: 'resolveEffectCheck',
    log: illusion(),
    run: (s, commandId) =>
      resolveEffectCheck(
        s,
        B,
        { effectKey: availableChecks(s, B)[0]?.effectKey ?? 'none', commandId },
        supply(),
      ),
  },
  /**
   * The reaction windows. Every one of these is a second round trip by
   * construction, which makes them the most retry-vulnerable commands in the
   * engine — and each of their guards has to precede the validation that
   * would otherwise report the world its own first run made.
   */
  {
    name: 'takeDamageReaction',
    log: blunting(),
    run: (s, commandId) => takeDamageReaction(s, A, { feature: 'test:blunt', commandId }, supply()),
  },
  {
    name: 'declineDamageReaction',
    log: blunting(),
    run: (s, commandId) => declineDamageReaction(s, A, { commandId }),
  },
  {
    name: 'declineDamageReaction (one feature)',
    log: blunting(),
    run: (s, commandId) => declineDamageReaction(s, A, { feature: 'test:blunt', commandId }),
  },
  {
    name: 'settleDamage',
    log: blunting(),
    run: (s, commandId) => settleDamage(s, supply(), { commandId }),
  },
  {
    name: 'resolveTest',
    log: SETUP,
    run: (s, commandId) =>
      resolveTest(s, A, { kind: 'saving-throw', ability: 'dex', dc: 15, commandId }, supply()),
  },
  {
    name: 'takeTestReaction',
    log: tested(),
    run: (s, commandId) => takeTestReaction(s, A, { feature: 'test:push', commandId }, supply()),
  },
  {
    name: 'declineTestReaction',
    log: tested(),
    run: (s, commandId) => declineTestReaction(s, A, { commandId }),
  },
  {
    name: 'declineTestReaction (one feature)',
    log: tested(),
    run: (s, commandId) => declineTestReaction(s, A, { feature: 'test:push', commandId }),
  },
  { name: 'settleTest', log: tested(), run: (s, commandId) => settleTest(s, { commandId }) },
  {
    name: 'takeDamageResponse',
    log: stung(),
    run: (s, commandId) =>
      takeDamageResponse(s, A, { feature: 'test:riposte', weapon: 'mace', commandId }, supply()),
  },
  {
    name: 'takeAttackReaction',
    log: parried(),
    run: (s, commandId) =>
      takeAttackReaction(s, A, { feature: 'test:parry', commandId }, supply()),
  },
  /**
   * Acting through a spell that is still running. The most retry-vulnerable
   * casting there is: it spends an Action and rolls an attack, and the attack
   * may miss — so the stamp rides on the activation rather than on damage that
   * a miss never deals.
   */
  {
    name: 'activateSpell',
    log: draining(),
    run: (s, commandId) =>
      activateSpell(s, A, { castingId: 'cast:1', targets: [B], commandId }, supply()),
  },
  /**
   * Letting go of a casting by its id. A retry that got past the guard would
   * find no such casting and report `not_ongoing` for a dismissal that had in
   * fact landed — the trap this repository has sprung eight times, met by a
   * command whose own first run is what makes the world answer that way.
   */
  /**
   * A DM's decision that a glyph's trigger occurred. A retry that got past the
   * guard would find the casting gone — the rune ended it — and report
   * `not_ongoing` for a decision that had in fact been taken, which is the
   * same trap `endOngoingSpell` below names.
   */
  {
    name: 'triggerGlyph',
    log: glyphed(),
    run: (s, commandId) => triggerGlyph(s, { castingId: 'cast:1', commandId }, supply()),
  },
  {
    name: 'endOngoingSpell',
    log: draining(),
    run: (s, commandId) => endOngoingSpell(s, A, 'cast:1', null, { commandId }),
  },
  /**
   * And the **target's** door out of the same casting, which is a spender: a
   * retry that got past the guard would charge a second Magic action for an
   * ending that had already happened.
   */
  {
    name: 'endOngoingSpellOnSelf',
    log: misting(),
    run: (s, commandId) => endOngoingSpellOnSelf(s, A, 'cast:1', { commandId }),
  },
  {
    // And the same command when it also moves a point. A retry that got past
    // the guard would move the force a second twenty feet, which no event
    // would explain and every later range check would read.
    name: 'activateSpell (moving an origin)',
    log: conjured(),
    run: (s, commandId) =>
      activateSpell(
        s,
        A,
        { castingId: 'cast:1', targets: [], to: { x: 100, y: 140, z: 0 }, commandId },
        supply(),
      ),
  },
  /**
   * The scene-setup family, which had no commands at all until IE-012 and
   * which the sweep named the moment the module appeared — eight exports
   * handing back events with nowhere to be accounted for, which is exactly
   * the silence a derived list buys.
   *
   * `placeCreatureInScene` is the one whose guard is load-bearing rather than
   * conventional: its own first run is what makes the world answer
   * `already_placed`, so a guard written above the duplicate check would tell
   * a retry that its command was impossible when it had in fact succeeded.
   * Ninth instance of that trap in this repository, and the first met by a
   * test that existed before the command did.
   */
  {
    name: 'setScene',
    log: SETUP,
    run: (s, commandId) => setScene(s, { width: 60, depth: 40, height: 20 }, { commandId }),
  },
  {
    name: 'addSceneLandmark',
    log: SETUP,
    run: (s, commandId) => addSceneLandmark(s, 'the hearth', { x: 20, y: 30, z: 0 }, { commandId }),
  },
  {
    name: 'placeCreatureInScene',
    log: untyped(),
    run: (s, commandId) =>
      placeCreatureInScene(s, C, { from: { landmark: 'here' }, feet: 10, bearing: 90 }, { commandId }),
  },
  {
    name: 'declareSightBetween',
    log: SETUP,
    run: (s, commandId) => declareSightBetween(s, A, B, false, { commandId }),
  },
  {
    name: 'declareCoverBetween',
    log: SETUP,
    run: (s, commandId) => declareCoverBetween(s, A, B, 'half', { commandId }),
  },
  {
    name: 'beginCombat',
    log: SETUP,
    run: (s, commandId) =>
      beginCombat(
        s,
        [
          { id: A, initiative: 21, speed: 30 },
          { id: B, initiative: 3, speed: 30 },
        ],
        { commandId },
      ),
  },
  {
    // And the same command where the opening boundary owes something. Starting
    // the fight starts the first combatant's turn, so a creature holding SRD
    // Heroism is paid its Temporary Hit Points here — and a retry that got
    // past the guard would pay a second time for the one turn.
    name: 'beginCombat (paying the opening boundary)',
    log: heroic(),
    run: (s, commandId) =>
      beginCombat(
        s,
        [
          { id: A, initiative: 21, speed: 30 },
          { id: B, initiative: 3, speed: 30 },
        ],
        { commandId },
        supply(),
      ),
  },
  {
    // And the same boundary where the payout it owes **throws a die**. The
    // entry above owes Temporary Hit Points off an ability modifier and turns
    // the generator not at all, so it is the idempotency guard it exercises
    // and nothing else; this one is what the counting sweep below needed, and
    // the hole it found was a whole command's dice going unrecorded.
    name: 'beginCombat (paying a payout that rolls)',
    log: vigilant(),
    run: (s, commandId) =>
      beginCombat(
        s,
        [
          { id: A, initiative: 21, speed: 30 },
          { id: B, initiative: 3, speed: 30 },
        ],
        { commandId },
        supply('s', WITH_A_ROLLING_PAYOUT),
      ),
  },
  {
    // The other end of the same fight. `SETUP` puts A on `party` and B on
    // `foes`, so the surrender is a side somebody standing is actually on —
    // and a retry that got past the guard would write a second `combat-ended`
    // into a log where the fight is already over.
    name: 'endCombat',
    log: SETUP,
    run: (s, commandId) => endCombat(s, { kind: 'surrender', side: 'foes' }, { commandId }),
  },
  {
    // The dangerous retry of the two: a second run rolls Initiative again,
    // which moves the generator for a fight that already started. The order
    // would look well-formed and every number after it would be off by two
    // dice.
    name: 'rollInitiativeAndBeginCombat',
    log: SETUP,
    run: (s, commandId) =>
      rollInitiativeAndBeginCombat(
        s,
        [
          { id: A, speed: 30 },
          { id: B, speed: 30 },
        ],
        supply(),
        { commandId },
      ),
  },
  {
    // The same, over a world where the opening boundary owes a payout: the
    // rolls and the payment are one command, so a retry that ran again would
    // move the generator *and* pay a second time. A's place in the order is
    // bought rather than rolled for, because the payout is only due if the
    // fight opens on the creature holding the spell.
    name: 'rollInitiativeAndBeginCombat (paying the opening boundary)',
    log: heroic(),
    run: (s, commandId) =>
      rollInitiativeAndBeginCombat(
        s,
        [
          { id: A, speed: 30, options: { bonuses: [{ source: 'the fixture', flat: 100 }] } },
          { id: B, speed: 30 },
        ],
        supply(),
        { commandId },
      ),
  },
  {
    // And the same hazard without a fight to show for it: the rolls happened,
    // and a retry that threw them again would leave the log saying the
    // generator moved twice as far as it did.
    name: 'recordInitiativeRolls',
    log: SETUP,
    run: (s, commandId) => recordInitiativeRolls(s, [{ id: A, speed: 30 }], supply(), { commandId }),
  },
  {
    // A retried join is the duplicate that adds a **second** creature to the
    // order under one id, which changes the number of turns in a round and
    // looks perfectly well-formed in the log — the same hazard `resolveTurn`
    // names for a retried advance, from the other direction.
    name: 'joinCombat',
    log: [...SETUP, added(C, 'onlookers')],
    run: (s, commandId) => joinCombat(s, { id: C, initiative: 15, speed: 30 }, { commandId }),
  },
  {
    // The one entry that cannot use `SETUP`: a declared advance is refused
    // inside a fight, so the identity is swept in the world the command is
    // for. See {@link OUT_OF_COMBAT}.
    name: 'advanceTime',
    log: OUT_OF_COMBAT,
    run: (s, commandId) => advanceTime(s, 600, 'searching the vault', { commandId }),
  },
  {
    name: 'declareSpellcasting',
    log: SETUP,
    run: (s, commandId) =>
      declareSpellcasting(s, B, declaredCasting({ ability: 'wis', prepared: ['bless'] }), {
        commandId,
      }),
  },
  {
    /**
     * The retry that pays a party twice. Its stamp has nowhere to ride —
     * the whole batch is one `coins-changed` — so this is the entry that
     * would have caught a coin command written before that event declared a
     * stamp of its own.
     */
    name: 'changeCoins',
    log: SETUP,
    run: (s, commandId) => changeCoins(s, A, 5_000, 'the reward for the caravan', commandId),
  },
  { name: 'purchaseItem', log: SETUP, run: (s, commandId) => purchaseItem(s, SRD_CONTENT, A, 'rope', 1, commandId) },
  { name: 'equipItem', log: SETUP, run: (s, commandId) => equipItem(s, SRD_CONTENT, A, 'chain-shirt', commandId) },
  {
    name: 'unequipItem',
    log: [...SETUP, ...unwrap(equipItem(fold('s', SETUP), SRD_CONTENT, A, 'chain-shirt'), 'eq')],
    run: (s, commandId) => unequipItem(s, SRD_CONTENT, A, 'chain-shirt', commandId),
  },
  /**
   * Attuning, whose retry is the dangerous one of the pair: its own first run
   * is what makes the world answer `already_attuned`, so a guard written above
   * the duplicate check would tell a retry its attunement was impossible when
   * it had in fact landed.
   */
  {
    name: 'attuneItem',
    log: ATTUNING,
    run: (s, commandId) => attuneItem(s, SRD_CONTENT, A, 'cloak-of-elvenkind', commandId),
  },
  {
    name: 'endAttunement',
    log: [
      ...ATTUNING,
      ...unwrap(attuneItem(fold('s', ATTUNING), SRD_CONTENT, A, 'cloak-of-elvenkind'), 'attune'),
    ],
    run: (s, commandId) => endAttunement(s, SRD_CONTENT, A, 'cloak-of-elvenkind', commandId),
  },
  {
    name: 'expendCharges',
    log: CHARGED,
    run: (s, commandId) => expendCharges(s, SRD_CONTENT, A, 'wand-of-secrets', 1, commandId),
  },
  /**
   * Dawn, over a world where something was spent that a die gives back. A
   * retried dawn that ran twice would roll twice and hand back twice, which is
   * the same shape `restoreResourcesOn` is not idempotent by construction for.
   */
  {
    name: 'declareDawn',
    log: SPENT_A_CHARGE,
    run: (s, commandId) => declareDawn(s, supply(), { commandId }),
  },
  // The nine facts a DM declares, which had no command at all until IE-016.
  {
    name: 'declareCreatureSide',
    log: SETUP,
    run: (s, commandId) => declareCreatureSide(s, B, 'the watch', { commandId }),
  },
  {
    name: 'declareCreatureHeads',
    log: SETUP,
    run: (s, commandId) => declareCreatureHeads(s, B, 3, { commandId }),
  },
  {
    name: 'swapInitiativeBetween',
    log: SETUP,
    run: (s, commandId) => swapInitiativeBetween(s, A, B, { commandId, willing: true }),
  },
  {
    name: 'stabiliseCreature',
    log: DYING,
    run: (s, commandId) => stabiliseCreature(s, B, { commandId }),
  },
  {
    name: 'declareCreatureDead',
    log: SETUP,
    run: (s, commandId) => declareCreatureDead(s, B, 'the pit', { commandId }),
  },
  {
    name: 'loseItems',
    log: SETUP,
    run: (s, commandId) =>
      loseItems(s, A, [{ id: 'longsword', quantity: 1 }], 'a thief', { commandId }),
  },
  {
    // A charged copy on purpose: a retried gift moves the copy's **pool**
    // again, and the second move lands it on a creature that already holds
    // the key — which the fold calls a contradiction and throws on, so an
    // unguarded retry here is a `CorruptLogError` rather than a quiet second
    // wand.
    name: 'transferItem',
    log: awarded(SETUP, 'wand-of-secrets'),
    run: (s, commandId) => transferItem(s, A, B, 'item:1', 1, 'a gift', { commandId }),
  },
  {
    // A retried award hands the party a second hoard, and for an item whose
    // count the book rolls it throws the dice again — the shape `declareDawn`
    // is guarded for, arriving at the moment a copy is born.
    name: 'awardItems',
    log: SETUP,
    run: (s, commandId) =>
      awardItems(s, supply(), A, [{ id: 'wand-of-secrets' }], 'the barrow', { commandId }),
  },
  {
    name: 'removeBonusFrom',
    log: BLESSED,
    run: (s, commandId) => removeBonusFrom(s, A, 'a quiet word', { commandId }),
  },
  {
    name: 'useFreeObjectInteraction',
    log: SETUP,
    run: (s, commandId) => useFreeObjectInteraction(s, A, { commandId }),
  },
  {
    name: 'mountCreature',
    log: STABLED,
    run: (s, commandId) => mountCreature(s, A, HORSE, { willing: true }, { commandId }),
  },
  {
    name: 'dismountRider',
    log: RIDING,
    run: (s, commandId) =>
      dismountRider(s, A, { from: { creature: HORSE }, feet: 15, bearing: 90 }, { commandId }),
  },
  /**
   * A potion drunk. The most retry-vulnerable shape an item has: the bottle is
   * emptied and the healing rolled in one batch, so an unguarded retry is a
   * second heal from a potion that no longer exists.
   */
  {
    name: 'useItem',
    log: POTIONED,
    run: (s, commandId) => useItem(s, A, { item: 'potion-of-healing', commandId }, supply()),
  },
  /**
   * A feature's pool use, which is the item's shape with the bottle taken out:
   * the use goes and the effects resolve in one batch, so an unguarded retry
   * is a second use of a pool that has one less in it.
   */
  /**
   * A feature's pool use, where what the use buys is room in the turn's own
   * budget: an unguarded retry is a second point spent and a second action
   * added to a turn that is entitled to one.
   */
  {
    name: 'useBudgetPurchase',
    log: vigorous(),
    run: (s, commandId) =>
      useBudgetPurchase(s, A, { feature: 'test:channelling', purchase: 'surge', commandId }),
  },
  {
    name: 'usePoolOption',
    log: vigorous(),
    run: (s, commandId) =>
      usePoolOption(
        s,
        A,
        { feature: 'test:channelling', option: 'mend', target: A, commandId },
        supply(),
      ),
  },
  /**
   * SRD Pact of the Chain's forgone attack. An unguarded retry is a second
   * Reaction taken by a familiar that has one, and a second swing out of an
   * Attack action that holds one.
   */
  {
    name: 'orderSummonsAttack',
    log: CHAINED,
    run: (s, commandId) =>
      orderSummonsAttack(
        s,
        A,
        { feature: 'test:chain', summons: C, target: B, commandId },
        supply(),
      ),
  },
];

describe('a retried command changes nothing the first one did not', () => {
  /**
   * The guarantee a model-driven loop actually needs. A retry happens for
   * reasons that have nothing to do with the game — a dropped connection, a
   * `pause_turn` resume, a tool re-invocation after a stream error — and an
   * unguarded one is a second casting, a second heal, or a skipped turn.
   */
  for (const entry of GUARDED) {
    it(`${entry.name}: applying it twice lands where applying it once did`, () => {
      const first = entry.run(fold('s', entry.log), 'cmd-1');
      expect(isErr(first) ? `${first.code}: ${first.reason}` : 'ok').toBe('ok');
      if (isErr(first)) return;

      // **And the first run must actually do something.** A fixture in which a
      // command succeeds by having nothing to do passes both assertions below
      // while testing neither — which is what `greased()` was silently doing,
      // by walking to the point a Grease was cast at rather than into it.
      expect(eventsOf(first.value).length, `${entry.name} did nothing`).toBeGreaterThan(0);

      const once = [...entry.log, ...eventsOf(first.value)];
      const after = fold('s', once);

      const retry = entry.run(after, 'cmd-1');
      expect(isErr(retry) ? `${retry.code}: ${retry.reason}` : 'ok').toBe('ok');
      if (isErr(retry)) return;

      // The retry may report what the first one did, but it may not *do* it
      // again: appending its events must leave the world exactly as it was.
      const twice = fold('s', [...once, ...eventsOf(retry.value)]);
      expect(twice).toEqual(after);
    });
  }

  /** And the guard must be real rather than an unused fingerprint. */
  for (const entry of GUARDED) {
    it(`${entry.name}: the second run emits nothing at all`, () => {
      const first = entry.run(fold('s', entry.log), 'cmd-1');
      if (isErr(first)) return;
      const after = fold('s', [...entry.log, ...eventsOf(first.value)]);

      const retry = entry.run(after, 'cmd-1');
      expect(isErr(retry)).toBe(false);
      if (isErr(retry)) return;
      expect(eventsOf(retry.value)).toEqual([]);
    });
  }

  /**
   * And the fixture must exercise the branch it was written for.
   *
   * A move that provokes takes a different exit from `resolveMove` than one
   * that does not, and only the first had an event carrying the stamp. Pinning
   * which branch this fixture reaches is what stops the sweep quietly going
   * back to covering one of the two.
   */
  it('the unprovoked move fixture really does provoke nobody', () => {
    const out = unwrap(resolveMove(fold('s', SETUP), A, { placement: CIRCLING }, supply()), 'move');
    expect(out.events.map((e) => e.type)).toEqual(['movement-spent', 'creature-moved']);
  });

  /**
   * And the same for the opening boundary, for the same reason. Both paying
   * arms above are `combat-started` plus a payment, and the sweep's only claim
   * about what the first run did is that it emitted *something* — which
   * `combat-started` satisfies on its own. So a Heroism that stopped falling
   * due, or an ability modifier that dropped the grant to nothing, would leave
   * two arms that read as tests of the payment and are copies of the arms
   * above it. This is what makes them arms.
   */
  it('the opening-boundary fixture really does owe a payout', () => {
    const state = fold('s', heroic());
    expect(state.creatures[A]?.payouts.map((payout) => payout.at)).toEqual(['start-of-turn']);

    const opened = unwrap(
      beginCombat(
        state,
        [
          { id: A, initiative: 21, speed: 30 },
          { id: B, initiative: 3, speed: 30 },
        ],
        { commandId: 'opening' },
        supply(),
      ),
      'opening the fight',
    );
    expect(opened.map((event) => event.type)).toEqual(['combat-started', 'temporary-hp-granted']);
    // And it hands over something. A grant worth nothing is skipped before the
    // event is written, so the type alone would not catch the modifier going
    // to zero — but a caller reading `amount` would notice either way, and the
    // claim above is about the arm exercising a payment.
    expect(opened.some((event) => event.type === 'temporary-hp-granted' && event.amount > 0)).toBe(true);
  });

  /**
   * Reusing an id for different work is refused rather than swallowed. A
   * silent no-op there is the worst available outcome: the second command
   * never runs and nobody is told.
   */
  it('refuses a command id reused for different inputs', () => {
    const first = unwrap(damageCreature(fold('s', SETUP), B, { amount: 7, source: 't', commandId: 'x' }), 'd');
    const after = fold('s', [...SETUP, ...first]);
    const reused = damageCreature(after, B, { amount: 9, source: 't', commandId: 'x' });
    expect(isErr(reused)).toBe(true);
    if (isErr(reused)) expect(reused.code).toBe('command_id_reused');
  });
});

/**
 * Every die a command draws is on the log, with the generator's new position.
 *
 * **The hole rule 1 fell through.** CLAUDE.md's first rule is enforced by
 * reachability — only `rolls.ts` stamps a roll `engine`, and every door an AI
 * holds reaches only commands that roll — and reachability is worth nothing if
 * the rolls a command makes go unrecorded. `rolls-issued` is the only event
 * that moves `rng` and `rollsIssued`, so a command that turns the generator
 * and emits none of it leaves a log that folds to a state whose generator is
 * standing where it was before the command ran. Resume from that log and the
 * *next* command rebuilds the same stream from the same position and draws the
 * very same faces under the very same roll ids — two different events wearing
 * one `RollId`, which is a corrupt audit trail rather than an unlucky one.
 * Rule 3 says a seed and a log fold to one state forever; a stream that
 * silently rewinds is the one way that stops being true.
 *
 * `forcePrintedSave` shipped in exactly that state — four dice per call, no
 * event — and was found by a builder throwing it twice and noticing the
 * identical numbers, not by any guard. The nearest guard,
 * `beginning-a-fight.test.ts`, catches the opposite mistake: a *non*-command
 * writing a `rolls-issued` by hand. It has nothing at all to say about a
 * command that rolls and forgets one.
 *
 * **Measured rather than listed.** The claim is about what a command *did*,
 * so it is taken from a counting generator rather than from the source: the
 * three answers — recorded, forgot, never rolled — are told apart by the draw
 * count and the issuer, and no command has to be remembered as a roller.
 * There is no allow-list here and there is nothing to keep up to date; a
 * command added to the corpus above is swept by this the same day.
 *
 * What it can and cannot see is worth saying plainly. It sees the branch the
 * corpus drives, once per command, and a rolling branch the corpus never
 * reaches is invisible to it — the same bound the idempotency sweep beside it
 * has, and the reason `GUARDED` is held against the module's own exports
 * rather than against memory. The companion further down — *every command
 * that can reach a die can reach the event that records it* — reads every
 * branch instead and is blunt where this one is exact. Neither is the guard
 * on its own.
 *
 * **That bound cost something, and what it cost is now a fixture rather than a
 * paragraph.** `settleTurnPayouts` throws the dice a payout carries, and every
 * SRD payout carries none — Heroism hands over an ability modifier, Regenerate
 * a printed number — so the corpus drove `beginCombat` and `resolveTurn` down
 * the arm that rolls nothing, this sweep saw a command that never rolled, and
 * the command emitted no `rolls-issued` for a die it really threw. The corpus
 * entry `beginCombat (paying a payout that rolls)` is what closes it: a
 * homebrew spell whose `turn-payout` names `1d4`, cast through the door
 * homebrew already uses, over a `Content` built with `extendContent`. It fails
 * on the commit before the emission and passes on it — which is the only kind
 * of evidence a sweep's blind spot admits.
 */
interface Turned {
  /** Dice drawn through every generator the command was handed. */
  readonly drawn: number;
  /** Roll ids issued against them. */
  readonly issued: number;
  /** Where the generators stand now, in the order they were handed over. */
  readonly snapshots: readonly RngState[];
}

/** What the probes saw, collapsed into the three numbers the rule is about. */
const turnedBy = (probes: readonly Probe[]): Turned => ({
  drawn: probes.reduce((n, probe) => n + probe.drawn(), 0),
  issued: probes.reduce((n, probe) => n + probe.issuer.count, 0),
  snapshots: probes.map((probe) => probe.rng.snapshot()),
});

/**
 * What a batch of events fails to say about a generator that moved. Empty is
 * a pass.
 *
 * Separate from the `it` that drives it so the same judgement can be shown a
 * batch that was never run — the discipline every sweep in this file follows,
 * because an analysis that can only be run against source it already agrees
 * with reports no problems and checks nothing.
 */
const unrecordedRolls = (events: readonly GameEvent[], turned: Turned): readonly string[] => {
  const recorded = events.filter(
    (event): event is Extract<GameEvent, { type: 'rolls-issued' }> => event.type === 'rolls-issued',
  );

  // Nothing happened. Nothing to record — and nothing to claim either: a
  // `rolls-issued` from a command that neither threw a die nor issued an id
  // would move `rollsIssued` past ids nobody holds.
  //
  // **The ids and not the dice**, which is a distinction with no consequence
  // today and one the physical-dice door arrives on. `resolveStatedD20` in
  // `checks.ts` records a face somebody at a table read off their own die: an
  // id issued, the generator untouched. That roll still has to advance
  // `rollsIssued` or the next command reissues its id, so the question the
  // whole judgement asks is *did the ledger move*, of which a die drawn is one
  // way. No command passes a `statedRoll` yet, and keying this on the dice
  // would have been correct until the first one did.
  if (turned.drawn === 0 && turned.issued === 0) {
    return recorded.length === 0
      ? []
      : [`drew no dice, issued no ids and emitted ${recorded.length} rolls-issued anyway`];
  }

  if (recorded.length === 0) {
    return [
      `drew ${turned.drawn} ${turned.drawn === 1 ? 'die' : 'dice'} and issued ${turned.issued} roll id(s), and emitted no rolls-issued: the generator rewinds on replay and the next command draws the same faces under the same ids`,
    ];
  }

  const complaints: string[] = [];

  // The ids, so a replayed log reproduces every `RollId` it references and the
  // next command starts where this one stopped.
  const counted = recorded.reduce((n, event) => n + event.count, 0);
  if (counted !== turned.issued) {
    complaints.push(`issued ${turned.issued} roll id(s) and recorded ${counted}`);
  }

  // The position, so the stream resumes where it stopped. The *last* record,
  // because a command may write one partway and roll again after it.
  const last = recorded[recorded.length - 1]!.rng;
  const now = turned.snapshots[turned.snapshots.length - 1]!;
  if (last.join() !== now.join()) {
    complaints.push(`recorded the generator at [${last.join()}] and left it at [${now.join()}]`);
  }

  return complaints;
};

describe('a command that turns the generator says so on the log', () => {
  for (const entry of GUARDED) {
    it(`${entry.name}: records every die it drew, or drew none`, () => {
      PROBES.length = 0;
      const out = entry.run(fold('s', entry.log), 'cmd-rolled');
      expect(isErr(out) ? `${out.code}: ${out.reason}` : 'ok').toBe('ok');
      if (isErr(out)) return;

      // One command, one generator: a second supply inside a single run would
      // make "where the generator stands now" two answers, and the judgement
      // above reads the last. Nothing does that today, and this is what would
      // say so rather than letting the reading go quietly wrong.
      expect(PROBES.length, `${entry.name} was handed ${PROBES.length} generators`).toBeLessThan(2);

      expect(unrecordedRolls(eventsOf(out.value), turnedBy(PROBES))).toEqual([]);
    });
  }

  /**
   * And the corpus really does contain rollers, so the sweep above is not a
   * row of commands that each drew nothing.
   *
   * A floor rather than a list, for the reason the stamp sweep keeps one: a
   * command that stops rolling is a rules change and not a failure here, and a
   * derivation that quietly stopped counting is. It sits close under the
   * measured value — 27 the day it was written — because a floor of ten would
   * have let two thirds of the rolling corpus stop drawing before it noticed,
   * which is a guard that passes rather than a guard.
   */
  it('drives commands that actually roll', () => {
    const rollers: string[] = [];
    for (const entry of GUARDED) {
      PROBES.length = 0;
      const out = entry.run(fold('s', entry.log), 'cmd-counted');
      if (isErr(out)) continue;
      if (turnedBy(PROBES).drawn > 0) rollers.push(entry.name);
    }
    expect(rollers.length).toBeGreaterThan(24);
    expect(rollers).toContain('forcePrintedSave');
  });

  /**
   * The defect itself, rebuilt out of the live command.
   *
   * `forcePrintedSave` really is run, really does draw, and the one event that
   * records it is taken back out of the batch — which is byte for byte the log
   * the command used to write. The judgement has to complain about it, and its
   * complaint has to be about the dice rather than about anything else.
   */
  it('would catch the forcePrintedSave defect, reconstructed', () => {
    PROBES.length = 0;
    const out = forcePrintedSave(
      fold('s', FORCED),
      A,
      { line: SAVING_LINE.name, targets: [B], commandId: 'cmd-reconstructed' },
      supply(),
    );
    expect(isErr(out)).toBe(false);
    if (isErr(out)) return;

    const turned = turnedBy(PROBES);
    expect(turned.drawn).toBeGreaterThan(0);
    expect(turned.issued).toBeGreaterThan(0);

    const written = eventsOf(out.value);
    expect(written.filter((event) => event.type === 'rolls-issued')).toHaveLength(1);
    expect(unrecordedRolls(written, turned)).toEqual([]);

    const asItShipped = written.filter((event) => event.type !== 'rolls-issued');
    expect(unrecordedRolls(asItShipped, turned)).toEqual([
      `drew ${turned.drawn} dice and issued ${turned.issued} roll id(s), and emitted no rolls-issued: the generator rewinds on replay and the next command draws the same faces under the same ids`,
    ]);
  });

  /** And the three other ways a record can be wrong, each shown to it. */
  it('tells a short count from a stale snapshot from an honest record', () => {
    const at = (a: number): RngState => [a, 2, 3, 4];
    const two: Turned = { drawn: 5, issued: 2, snapshots: [at(9)] };

    expect(unrecordedRolls([{ type: 'rolls-issued', count: 2, rng: at(9) }], two)).toEqual([]);

    expect(unrecordedRolls([{ type: 'rolls-issued', count: 1, rng: at(9) }], two)).toEqual([
      'issued 2 roll id(s) and recorded 1',
    ]);

    expect(unrecordedRolls([{ type: 'rolls-issued', count: 2, rng: at(1) }], two)).toEqual([
      'recorded the generator at [1,2,3,4] and left it at [9,2,3,4]',
    ]);

    // Two records, the second of which is where the generator actually stands:
    // a command may write one partway and roll again after it.
    expect(
      unrecordedRolls(
        [
          { type: 'rolls-issued', count: 1, rng: at(1) },
          { type: 'rolls-issued', count: 1, rng: at(9) },
        ],
        two,
      ),
    ).toEqual([]);

    // A command that did nothing at all and said it had.
    expect(
      unrecordedRolls([{ type: 'rolls-issued', count: 0, rng: at(1) }], {
        drawn: 0,
        issued: 0,
        snapshots: [],
      }),
    ).toEqual(['drew no dice, issued no ids and emitted 1 rolls-issued anyway']);

    // And silence from a command that threw nothing is the pass it should be.
    expect(unrecordedRolls([], { drawn: 0, issued: 0, snapshots: [] })).toEqual([]);

    // **An id with no die behind it is still a ledger that moved.** A face read
    // off a table's own dice issues an id and leaves the generator exactly
    // where it was, and a command that recorded nothing would let the next one
    // reissue that id. Nothing reaches `resolveStatedD20` today, which is why
    // this arm is synthetic and why it is here rather than waiting.
    const still: Turned = { drawn: 0, issued: 1, snapshots: [at(4)] };
    expect(unrecordedRolls([], still)).toEqual([
      'drew 0 dice and issued 1 roll id(s), and emitted no rolls-issued: the generator rewinds on replay and the next command draws the same faces under the same ids',
    ]);
    expect(unrecordedRolls([{ type: 'rolls-issued', count: 1, rng: at(4) }], still)).toEqual([]);
  });
});

// — the two sweeps that are derived from the module, not recalled ————————————

/**
 * The engine's own source, read so that a sweep enumerates what is *there*
 * rather than what somebody remembered to list.
 *
 * Both sweeps below were hand-written arrays until the third whole-engine
 * audit measured them: the `mayAct` list covered nine of sixteen spenders and
 * `GUARDED` was silent in both directions. A list that has to be maintained by
 * hand is a list that goes stale between the commit that adds a command and
 * the play session that finds out. The precedent is `spell-schema.test.ts`'s
 * special-case scan, and so is the discipline that goes with it: each analysis
 * is driven over a synthetic sample that it must catch, so the sweep cannot
 * quietly stop seeing anything.
 *
 * **The enumeration is a directory listing, not a list of file names**, and
 * that is the whole of what the domain split changed here. A hard-coded list
 * of the modules under `commands/` would be the hand-maintained array these
 * sweeps were written to replace, arriving one level up: a domain module added
 * and not listed is a command that silently leaves both sweeps, which is
 * exactly the silence they exist to prevent.
 */
const SRC = fileURLToPath(new URL('.', import.meta.url));

const COMMAND_MODULES = readdirSync(`${SRC}commands`)
  .filter((file) => file.endsWith('.ts'))
  .map((file) => `commands/${file}`);

const MODULE_SOURCE: Readonly<Record<string, string>> = Object.fromEntries(
  [...COMMAND_MODULES, 'rest.ts'].map((file) => [file, readFileSync(`${SRC}${file}`, 'utf8')]),
);

/**
 * The command layer's public surface, read off the barrel.
 *
 * A helper is `export`ed in its own module so a sibling may call it, and is
 * **not** a command. Before the split those were the same word because there
 * was one file, and `export` alone meant "reachable from outside the command
 * layer"; `commands.ts` is now where the two are told apart, so it is what the
 * sweeps read to know which of the modules' exports they are about.
 *
 * Without this both sweeps would widen to every cross-module helper —
 * `landDamage`, `moveWithin`, `castOrRelease` — and demand a `mayAct` guard or
 * a command id from functions that are halves of a command rather than
 * commands, which is a different claim from the one they are making.
 */
const PUBLIC_COMMANDS: readonly string[] = [
  ...readFileSync(`${SRC}commands.ts`, 'utf8').matchAll(/^export (?!type )\{([\s\S]*?)\} from/gm),
]
  .flatMap((match) => match[1]!.split(','))
  .map((name) => name.trim())
  .filter((name) => name.length > 0);

/**
 * Everything the sweeps below are about: the command layer's public surface,
 * plus `rest.ts`, which has no barrel of its own and whose exports therefore
 * still mean what `export` used to mean in `commands.ts`.
 */
const COMMAND_SURFACE: ReadonlySet<string> = new Set([
  ...PUBLIC_COMMANDS,
  ...[
    ...MODULE_SOURCE['rest.ts']!.matchAll(/^export (?:(?:async )?function|const) (\w+)/gm),
  ].map((match) => match[1]!),
]);

/**
 * Every top-level declaration in a module, with the text that follows it.
 *
 * A body runs to the next top-level declaration, which is all the call graph
 * below needs: it asks which *names* a declaration mentions, not where they
 * sit.
 *
 * **Both `function` and `const`**, because the module already contains
 * function-valued consts (`anchoringFor`) and a classifier that recognised
 * only one form would answer "not a spender" to a shape it had simply never
 * heard of — which is what `animals.md` taught and what the two sweeps below
 * exist to stop happening to guards.
 */
const DECLARATION = /^(export )?(?:(?:async )?function|const) (\w+)/gm;

const functionsIn = (
  source: string,
): readonly { readonly name: string; readonly exported: boolean; readonly body: string }[] => {
  DECLARATION.lastIndex = 0;
  const found: { name: string; exported: boolean; at: number }[] = [];
  for (let m = DECLARATION.exec(source); m !== null; m = DECLARATION.exec(source)) {
    found.push({ name: m[2]!, exported: m[1] !== undefined, at: m.index });
  }
  return found.map((entry, i) => ({
    name: entry.name,
    exported: entry.exported,
    body: source.slice(entry.at, found[i + 1]?.at ?? source.length),
  }));
};

/**
 * Which functions spend something a creature only has so much of.
 *
 * The seeds are the action economy's own primitives in `combat.ts` and the two
 * events whose reducer takes a resource away — a pool use (`resource-spent`,
 * which is every feature's uses and a feat's free casting) and a spell slot
 * (`spell-cast`, where the slot actually goes). Everything else is reached
 * transitively, because a command that spends through a helper is spending
 * just the same: `activateFeature` never names `spendBonusAction`, and it
 * spends one.
 *
 * **`useFreeInteraction` is the sixth primitive and was missing.** A turn
 * budget has six fields and this consumes one of them — SRD's "one free
 * interaction per turn. Any additional interactions require the Utilize
 * action" — so a command that spends it is spending exactly as much as one
 * that spends a Bonus Action. Nothing called it until `useFreeObjectInteraction`
 * did, which is why the omission cost nothing and why adding the seed sweeps
 * up exactly one command.
 */
const ECONOMY = [
  'spendAction',
  'spendBonusAction',
  'spendReaction',
  'spendMovement',
  'spendAttack',
  'useFreeInteraction',
];
const SPENT_EVENTS = ["'resource-spent'", "'spell-cast'"];

/**
 * The transitive closure both sweeps below are made of: every exported
 * declaration that reaches a seed — a named primitive or a declaration that
 * writes one of the seed events — through any number of helpers.
 *
 * One function rather than two copies of the fixed point, because there are
 * now two questions asked of this module in the same shape: *what does this
 * command spend*, and *does it end a casting*. A second hand-written walk would
 * be a second answer to one question, and the pair would drift at exactly the
 * moment somebody added a module.
 */
const reachedFrom = (
  source: string,
  seeds: readonly string[],
  seedEvents: readonly string[],
): ReadonlySet<string> => {
  const functions = functionsIn(source);
  const reached = new Set(seeds);
  for (const fn of functions) {
    if (seedEvents.some((event) => fn.body.includes(event))) reached.add(fn.name);
  }
  for (let grew = true; grew; ) {
    grew = false;
    for (const fn of functions) {
      if (reached.has(fn.name)) continue;
      if ([...reached].some((callee) => new RegExp(`\\b${callee}\\s*\\(`).test(fn.body))) {
        reached.add(fn.name);
        grew = true;
      }
    }
  }
  return new Set(functions.filter((fn) => fn.exported && reached.has(fn.name)).map((fn) => fn.name));
};

const spendersIn = (source: string): ReadonlySet<string> => reachedFrom(source, ECONOMY, SPENT_EVENTS);

/**
 * Which commands end a casting, spending nothing to do it.
 *
 * **The shape the action-economy sweep structurally cannot see.** That sweep
 * classifies *spenders*, so a command that takes no Action, Bonus Action,
 * Reaction, movement or pool use is never classified and never asked for an
 * exemption — and `endConcentration` sat in that blind spot for as long as it
 * existed, forgiving exactly the outstanding `OwedAreaEffect`s the guard beside
 * it exists to protect. IE-048 found it and reported rather than fixed it,
 * because a command that ends a casting while spending nothing is not a thing
 * the closure above has a name for.
 *
 * So it gets its own closure, seeded on the two events that end a casting
 * rather than on the six that spend something. Everything the seeds reach
 * transitively is included for the same reason the spender sweep includes it: a
 * command that ends a casting through a helper ends one just the same.
 */
const ENDING_EVENTS = ["'concentration-ended'", "'spell-ended'"];

const castingEndersIn = (source: string): ReadonlySet<string> => reachedFrom(source, [], ENDING_EVENTS);

/** Which declarations ask `mayAct` in their own body — the code, not the prose. */
const guardedIn = (source: string): ReadonlySet<string> =>
  new Set(
    functionsIn(source)
      .filter((fn) =>
        /\bmayAct\s*\(/.test(
          fn.body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''),
        ),
      )
      .map((fn) => fn.name),
  );

/**
 * One spender, run against a world that owes a mandatory area effect.
 *
 * The command's arguments need only be well-formed. `mayAct` is checked
 * immediately after the duplicate check and before the creature, the feature
 * or the target is looked up, which is the whole point of it — so a command
 * naming a feature nobody has is still refused for the debt, and the second
 * assertion below is what proves the debt is what did it.
 */
interface Spender {
  readonly name: string;
  readonly run: (state: GameState) => Result<unknown>;
}

/**
 * A world with an area effect owed by somebody, and a creature whose turn has
 * just begun with everything unspent.
 *
 * A is the caster and stays clear of the slick; B walks into it on B's own
 * turn, so B still has an Action, a Bonus Action and a Reaction when the debt
 * lands. Every refusal below is therefore the debt and nothing else.
 */
const owing = greased;

const SPENDERS: readonly Spender[] = [
  { name: 'takeDash', run: (s) => takeDash(s, B, {}) },
  // The debt is checked before the moment, the line or the pool, so a
  // legendary use asked for by a creature owing a save is refused for the
  // debt whatever its block prints.
  {
    name: 'takeLegendaryAction',
    run: (s) => takeLegendaryAction(s, B, { line: SHIELD_LINE.name }, supply()),
  },
  // The two doors on a kept summons spend the summoner's Magic action, and
  // the debt is asked before the bond is looked at — so a caster keeping
  // nothing is still refused for the debt, which is the guard sitting where
  // it does.
  { name: 'dismissKeptSummons', run: (s) => dismissKeptSummons(s, B, { who: A }) },
  { name: 'recallKeptSummons', run: (s) => recallKeptSummons(s, B, { who: A }) },
  // And the two printed roads, refused for the debt before the line is read.
  { name: 'takePrintedSwallow', run: (s) => takePrintedSwallow(s, B, { line: 'A Printed Line', target: A }) },
  { name: 'takePrintedPlaneShift', run: (s) => takePrintedPlaneShift(s, B, { line: 'A Printed Line' }) },
  { name: 'takeDisengage', run: (s) => takeDisengage(s, B, {}) },
  { name: 'takeDodge', run: (s) => takeDodge(s, B, {}) },
  // The debt is checked before the target is looked at, so a shake aimed at a
  // creature holding nothing wakeable is still refused for the debt — which
  // is the whole point of the guard sitting where it does.
  { name: 'wakeCreature', run: (s) => wakeCreature(s, B, { target: A }, {}) },
  { name: 'takeHide', run: (s) => takeHide(s, B, {}, supply()) },
  { name: 'takeUtilize', run: (s) => takeUtilize(s, B, {}) },
  // The debt is asked before the fire is, so a creature who is not burning
  // at all is still refused for the debt — the guard sitting where it does.
  { name: 'extinguishFire', run: (s) => extinguishFire(s, B, {}) },
  { name: 'takeSearch', run: (s) => takeSearch(s, B, { skill: 'perception', dc: 10 }, supply()) },
  { name: 'takeStudy', run: (s) => takeStudy(s, B, { skill: 'arcana', dc: 10 }, supply()) },
  {
    name: 'takeInfluence',
    run: (s) => takeInfluence(s, B, { skill: 'persuasion', dc: 10, target: A }, supply()),
  },
  { name: 'takeHelp', run: (s) => takeHelp(s, B, { kind: 'attack', ally: A, enemy: A }) },
  {
    name: 'takeReady',
    run: (s) => takeReady(s, B, { trigger: 'when it moves', response: { kind: 'action' } }, SRD_CONTENT),
  },
  { name: 'resolveMove', run: (s) => resolveMove(s, B, { placement: CIRCLING }, supply()) },
  { name: 'resolveAttack', run: (s) => resolveAttack(s, B, { target: A, weapon: null }, supply()) },
  {
    name: 'activateSpell',
    run: (s) => activateSpell(s, B, { castingId: 'cast:1', targets: [A] }, supply()),
  },
  { name: 'activateFeature', run: (s) => activateFeature(s, B, { feature: 'test:stance' }, SRD_CONTENT) },
  // `createDevice` is deliberately absent: it charges no action at all — the
  // clock is its whole price and it is refused inside a fight — so the derived
  // sweep does not find it and an entry here would be inventing a spender.
  { name: 'activateDevice', run: (s) => activateDevice(s, B, { device: A }) },
  {
    name: 'useHealingTouch',
    run: (s) => useHealingTouch(s, B, { feature: 'test:healing-touch', target: A, lift: ['poisoned'] }),
  },
  { name: 'conferReaction', run: (s) => conferReaction(s, B, { feature: 'test:inspire', target: A }) },
  { name: 'useSelfHeal', run: (s) => useSelfHeal(s, B, { feature: 'test:self-heal' }, supply()) },
  { name: 'useRecovery', run: (s) => useRecovery(s, B, { feature: 'test:recovery' }, supply()) },
  {
    name: 'assumeShape',
    run: (s) => assumeShape(s, B, { feature: 'test:shape', form: 'wolf' }, SRD_CONTENT),
  },
  { name: 'revertShape', run: (s) => revertShape(s, B, {}) },
  {
    name: 'tradeResource',
    run: (s) => tradeResource(s, B, { feature: 'test:trade', trade: 'points-for-vigour' }),
  },
  {
    name: 'extendFeature',
    run: (s) => extendFeature(s, B, { feature: 'test:stance', by: 'bonus-action' }),
  },
  /**
   * SRD Pact of the Chain's forgone attack, which spends an Attack action and
   * somebody else's Reaction. The feature need only be well-formed: `mayAct`
   * is asked immediately after the duplicate check and before the sheet, the
   * familiar or either budget is looked at.
   */
  {
    name: 'orderSummonsAttack',
    run: (s) =>
      orderSummonsAttack(s, B, { feature: 'test:chain', summons: A, target: A }, supply()),
  },
  {
    name: 'resolveEffectCheck',
    run: (s) => resolveEffectCheck(s, B, { effectKey: 'condition|b|nothing' }, supply()),
  },
  {
    name: 'resolveSpell',
    run: (s) => resolveSpell(s, B, { spellId: 'inflict-wounds', targets: [A], slotLevel: 1 }, supply()),
  },
  /**
   * The Magic action SRD's "Longer Casting Times" asks for on each of the
   * caster's turns. The casting id need only be well-formed: `mayAct` is asked
   * immediately after the duplicate check and before the record is looked up
   * at all, which is what this case is here to hold it to.
   */
  { name: 'continueCasting', run: (s) => continueCasting(s, B, 'cast:1', {}) },
  /**
   * The Magic action SRD Gaseous Form charges its **target** for ending the
   * spell on itself. The casting id need only be well-formed: `mayAct` is
   * asked immediately after the duplicate check and before the record is
   * looked up, which is what this case holds it to.
   */
  { name: 'endOngoingSpellOnSelf', run: (s) => endOngoingSpellOnSelf(s, B, 'cast:1', {}) },
  /**
   * The three of the nine DM-declared events that are **not** declarations.
   *
   * SRD spends "an amount of movement equal to half your Speed" on mounting and
   * on dismounting, and caps object interactions at "one free interaction per
   * turn" — so all three draw on the turn budget and all three are found here
   * by the closure rather than by being listed. The arguments need only be
   * well-formed: `mayAct` is checked immediately after the duplicate check and
   * before the scene, the mount or the budget is looked at.
   */
  { name: 'mountCreature', run: (s) => mountCreature(s, B, A, { willing: true }) },
  {
    name: 'dismountRider',
    run: (s) => dismountRider(s, B, { from: { creature: A }, feet: 5, bearing: 180 }),
  },
  { name: 'useFreeObjectInteraction', run: (s) => useFreeObjectInteraction(s, B) },
  /**
   * A line a stat block prints under Bonus Actions. SRD spends a Bonus Action
   * on one, and a creature owing a mandatory area effect may not spend it. The
   * line need not be printed on anything: `mayAct` is asked immediately after
   * the duplicate check and before the sheet is read at all.
   */
  {
    name: 'takeStatedBonusAction',
    run: (s) => takeStatedBonusAction(s, B, { line: 'A Printed Line' }),
  },
  /**
   * A line a stat block prints under Actions that the parser read nothing out
   * of. It spends the Action, and a creature owing a mandatory area effect may
   * not spend it. The line need not be printed on anything, for the reason its
   * Bonus Action sibling's need not be.
   */
  {
    name: 'takeStatedAction',
    run: (s) => takeStatedAction(s, B, { line: 'A Printed Line' }),
  },
  /**
   * The same line, taken through the door that rolls the save it prints. It
   * spends the same Action and is refused for the same debt — and, like its
   * sibling, before the line, the save or the targets are looked at.
   */
  {
    name: 'forcePrintedSave',
    run: (s) => forcePrintedSave(s, B, { line: 'A Printed Line', targets: [A] }, supply()),
  },
  /**
   * And the third door on one line, which spends the same slot and is refused
   * for the same debt — before the line, the destination or the geometry, like
   * its two siblings.
   */
  {
    name: 'takePrintedTeleport',
    run: (s) =>
      takePrintedTeleport(s, B, {
        line: 'A Printed Line',
        to: { from: { landmark: 'here' }, feet: 10, bearing: 180 },
      }),
  },
  /**
   * And the fourth door on one line, which spends the same slot to change the
   * creature's form — refused for the same debt before the line, the form or
   * the size are looked at, like its siblings.
   */
  {
    name: 'takePrintedForm',
    run: (s) => takePrintedForm(s, B, { line: 'A Printed Line', form: 'wolf' }),
  },
  /**
   * And the fifth door on one line, which spends the same slot to drag what
   * the creature is holding — refused for the same debt before the line or
   * anybody's grapple is looked at, like its siblings.
   */
  {
    name: 'takePrintedPull',
    run: (s) => takePrintedPull(s, B, { line: 'A Printed Line' }),
  },
  /**
   * And the sixth door on one line, which spends the same slot through the
   * casting the route opens — and is refused for the same debt before the
   * line, the menu or the targets are looked at, like its siblings.
   */
  {
    name: 'castPrintedLine',
    run: (s) =>
      castPrintedLine(s, B, { line: 'A Printed Line', spell: 'bless' }, supply()),
  },
  /**
   * A wand's charge. It spends no Action here — what a charge *buys* is not
   * resolved from an item yet — but it takes a pool use, which is the sweep's
   * own definition of spending, and a creature owing a mandatory area effect
   * may not reach for a wand any more than for a spell. The wand need not even
   * be owned: `mayAct` is asked immediately after the duplicate check and
   * before the item is looked up at all.
   */
  {
    name: 'expendCharges',
    run: (s) => expendCharges(s, SRD_CONTENT, B, 'wand-of-secrets'),
  },
  /**
   * A potion drunk. SRD spends a Bonus Action on it, and a creature owing a
   * mandatory area effect may not reach for a bottle any more than for a
   * spell. The potion need not even be owned: `mayAct` is asked immediately
   * after the duplicate check and before the item is looked up at all.
   */
  { name: 'useItem', run: (s) => useItem(s, B, { item: 'potion-of-healing' }, supply()) },
  /**
   * A feature's pool use. SRD spends an Action or a Bonus Action on one, and a
   * creature owing a mandatory area effect may not spend either. The arguments
   * need only be well-formed: `mayAct` is asked immediately after the
   * duplicate check and before the feature is looked up at all.
   */
  {
    name: 'usePoolOption',
    run: (s) => usePoolOption(s, B, { feature: 'test:channelling', option: 'mend' }, supply()),
  },
  /**
   * The Unarmed Strike's Grapple and Shove options. Each spends the Attack
   * action's one attack, and a creature owing a mandatory area effect may not
   * spend it. The target need not be reachable or the right size: `mayAct` is
   * asked immediately after the two creatures are found and before the
   * distance or either size is looked at.
   */
  { name: 'grappleTarget', run: (s) => grappleTarget(s, B, { target: A, save: 'dex' }, supply()) },
  {
    name: 'shoveTarget',
    run: (s) => shoveTarget(s, B, { target: A, save: 'dex', outcome: 'prone' }, supply()),
  },
  /**
   * Tearing free of a grapple. SRD spends the Action on it, and a creature
   * owing a mandatory area effect may not spend one. Nothing need be holding
   * them: `mayAct` is asked immediately after the duplicate check and before
   * any grapple is looked for.
   */
  { name: 'escapeGrapple', run: (s) => escapeGrapple(s, B, { ability: 'str' }, supply()) },
  /**
   * Pulling a creature off somebody. SRD Stirge: "The target or a creature
   * within 5 feet of it can detach the stirge **as an action**" — so a
   * creature owing a mandatory area effect may not. Nothing need be attached:
   * `mayAct` is asked immediately after the duplicate check and before any
   * attach is looked for.
   */
  { name: 'detachFrom', run: (s) => detachFrom(s, B, { holder: A, from: B }, supply()) },
  /**
   * Letting go. SRD spends five feet of the attacher's own movement on it, and
   * a creature owing a mandatory area effect may spend none — the rule
   * `mountCreature` already states of the same spend. Nothing need be
   * attached: `mayAct` is asked immediately after the duplicate check.
   */
  { name: 'letGoOfAttachment', run: (s) => letGoOfAttachment(s, B, { from: A }) },
  /**
   * A feature's pool use that buys room in the turn budget. It takes a pool
   * use — the sweep's own definition of spending — and may take a Bonus Action
   * with it, and a creature owing a mandatory area effect may spend neither.
   * The arguments need only be well-formed: `mayAct` is asked immediately
   * after the duplicate check and before the feature is looked up at all.
   */
  {
    name: 'useBudgetPurchase',
    run: (s) => useBudgetPurchase(s, B, { feature: 'test:channelling', purchase: 'surge' }),
  },
  /**
   * Evoking a conjured thing again. It spends the Bonus Action the spell
   * prints, and a creature owing a mandatory area effect may not spend one.
   * Nothing need have been conjured: `mayAct` is asked immediately after the
   * creature is found and before any casting is looked for.
   */
  {
    name: 'evokeConjured',
    run: (s) => evokeConjured(s, B, { item: 'flame-blade' }, supply()),
  },
];

/**
 * The spenders that deliberately do **not** consult `mayAct`, each with the
 * sentence that exempts it. CLAUDE.md states the policy; this is the list it
 * applies to, so that adding a command to it is a visible act.
 */
const UNGUARDED_ON_PURPOSE: Readonly<Record<string, string>> = {
  releaseReady:
    'a Reaction: it answers a window that is already open, and refusing it would strand a legal one',
  takeOpportunityAttack: 'a Reaction, taken on somebody else’s turn',
  resolveFall:
    'the ground: the one thing it spends is the Reaction a faller elects to land with — SRD Slow Fall — and that is a Reaction taken while falling, on whoever’s turn the fall happens, which is `takeOpportunityAttack`’s exemption. The height is a fact the table states rather than an action anybody takes, and a guard would refuse to let a creature hit the floor because somebody else owed a saving throw',
  takeAttackReaction: 'a Reaction, and it answers a window somebody else opened',
  resolveTest:
    'a D20 Test the table asked for, which is not an action in anybody’s turn: SRD spends no Action, Bonus Action or Reaction on a check or a save, and a guard here would refuse a creature the very saving throw an outstanding area effect is owed as. What the closure sees is the pool an **election** spends — SRD Heroic Inspiration bought before the die rather than answered after it — and that is a use the roller elected on the roll itself, priced, refused if unaffordable, and spent only where the condition the roller stated was met',
  takeDamageReaction: 'a Reaction, and it closes a window somebody else opened',
  takeTestReaction: 'a Reaction, and it closes a window somebody else opened',
  takeDamageResponse: 'a Reaction, and it closes a window somebody else opened',
  resolveAttackDamage:
    'the settlement of an attack already made — a guard here would strand the held roll',
  settleDamage:
    'the settlement of a damage window the engine is already holding open; refusing it would strand the roll, the Concentration save that roll may call for, and the rider the blow is holding until the defender has answered. It spends a pool only on somebody else’s behalf: the rider it resolves was asked for, checked and paid for by the swing that opened this window, and the point comes out of the attacker rather than out of whoever is settling',
  resolveDeclaredCast:
    'the settlement of a casting the engine is already holding open; refusing it would deadlock the window',
  castSpell:
    'the documented low-level half, for a caller reconstructing a log or scripting a fixture; the economy is already accounted for',
  endRest:
    'not an action in the turn economy: SRD spends no Action, Bonus Action or Reaction on a rest, and the Hit Dice it spends are the rest’s own payout rather than something taken during a turn. Whether an outstanding area effect should block a rest is a question neither the SRD nor this engine has asked; naming it here is how it gets asked',
  settleAreaEffects:
    'the settlement itself, and a guard that refused its own settlement would be a deadlock wearing a rule’s clothes — this is the command that discharges the debt every other one is waiting on. It moved here from `ENDS_A_CASTING_UNGUARDED` the day a `chance` effect began counting its casting: the count is a `resource-spent`, so an effect list this settles can reach one and the closure above finds it. The two lists are disjoint by construction and a name on both would be an exemption gone stale',
  triggerGlyph:
    'a DM’s decision that a glyph’s invented trigger occurred — SRD Glyph of Warding’s "You decide what triggers the glyph" — which is not an action in anybody’s turn: nobody spends anything to be caught by a rune, and a guard would refuse the eruption because somebody in the room owed a saving throw. What the closure sees is the effect list the rune resolves, which is `settleAreaEffects`’ exemption one door along: a `chance` effect in it would count its casting with a `resource-spent`, and the count is the spell’s bookkeeping rather than a thing the DM chose to spend',
  resolveTurn:
    'the turn boundary, which is not anybody’s action: nothing in the turn economy is spent on a turn beginning or ending, and a guard would refuse to end the very turn an outstanding debt is owed on. What the closure sees is the effect list a boundary may resolve — a payout, an area trigger — and a `chance` effect in one of those counts its casting with a `resource-spent`; the count is the spell’s bookkeeping rather than a thing the creature whose turn it is chose to spend',
};

describe('every command that spends something asks whether it may', () => {
  // Every module at once, because the closure crosses them: `resolveAttack`
  // lands its damage through `damage.ts` and casts through `casting.ts`, and
  // asking each module on its own would stop the transitive walk at the
  // import that carries it — a spender would then be invisible for no better
  // reason than which file it came to live in. `rest.ts` is in the same
  // string, because `endRest` spends Hit Dice: a pool use by the sweep's own
  // definition, in a file the first draft of this did not read at all.
  const spenders = new Set(
    [...spendersIn(Object.values(MODULE_SOURCE).join('\n'))].filter((name) =>
      COMMAND_SURFACE.has(name),
    ),
  );

  /**
   * The sweep is enumerated from the module, so a command added with a guard
   * missing has nowhere to hide: it is neither exercised below nor written
   * into the exemption list, and this fails naming it.
   */
  it('accounts for every exported spender, and invents none', () => {
    const accounted = new Set([...SPENDERS.map((s) => s.name), ...Object.keys(UNGUARDED_ON_PURPOSE)]);
    expect([...spenders].filter((name) => !accounted.has(name)).sort()).toEqual([]);
    expect([...accounted].filter((name) => !spenders.has(name)).sort()).toEqual([]);
  });

  /** And the analysis is not vacuous: it finds a spender it is shown. */
  it('would find an unguarded spender if one were added', () => {
    const smuggled = [
      'export function takeALittleSomething(state: GameState): Result<GameEvent[]> {',
      '  const spent = spendBonusAction(state.combat, id, undefined);',
      '  return ok([]);',
      '}',
    ].join('\n');
    expect([...spendersIn(smuggled)]).toEqual(['takeALittleSomething']);
    // And a command that spends nothing is not swept up with it.
    expect([...spendersIn('export function lookAtSomething(): number {\n  return 1;\n}')]).toEqual([]);
  });

  it('really does owe an area effect in this fixture', () => {
    const state = fold('s', owing());
    expect(state.owedAreaEffects.length).toBeGreaterThan(0);
    // And B is the one acting, with a turn they have barely begun to spend.
    expect(state.combat?.order[state.combat.turnIndex]?.id).toBe(B);
    expect(state.combat?.budgets[B]?.action).toBe(true);
    expect(state.combat?.budgets[B]?.bonusAction).toBe(true);
  });

  for (const spender of SPENDERS) {
    it(`${spender.name}: refused while an area effect is owed`, () => {
      const out = spender.run(fold('s', owing()));
      expect(isErr(out) ? out.code : 'ok').toBe('area_effect_owed');
    });

    /**
     * And it is the debt talking, not the fixture. Settling the debt and
     * running exactly the same command must produce anything *but* that
     * refusal — otherwise the assertion above would pass for a command that
     * was never reachable in this world at all.
     */
    it(`${spender.name}: and lets it through once the debt is settled`, () => {
      const log = owing();
      const settled = [...log, ...unwrap(settleAreaEffects(fold('s', log), supply()), 'settle').events];
      const out = spender.run(fold('s', settled));
      expect(isErr(out) ? out.code : 'ok').not.toBe('area_effect_owed');
    });
  }

  /**
   * And a command that spends **nothing** is guarded anyway, which is the
   * combination `relocateCreature` already documents and which the derived
   * sweep above structurally cannot see: the closure classifies spenders, and
   * `endOngoingSpell` takes no Action, Bonus Action, Reaction, movement or
   * pool use — SRD dismisses a spell with "no action required".
   *
   * It is guarded because ending a casting **forgives what that casting
   * already owes**: `releaseCasting` drops the casting's outstanding
   * `OwedAreaEffect`s, so dismissing the Grease here while B's save is still
   * owed would lose a rule the boundary had already raised. A guard nobody
   * asserts is the thing this repository keeps finding, so it is asserted in
   * both directions — the second case is what says the command was reachable
   * in this world at all.
   */
  describe('and a dismissal spends nothing and is guarded regardless', () => {
    const dismiss = (s: GameState) => endOngoingSpell(s, A, 'cast:1', null);

    it('really is A’s own Grease that is running here', () => {
      const state = fold('s', owing());
      expect(state.ongoing['cast:1']?.caster).toBe(A);
      expect(state.owedAreaEffects.map((o) => o.castingId)).toContain('cast:1');
    });

    it('is refused while that area effect is owed', () => {
      const out = dismiss(fold('s', owing()));
      expect(isErr(out) ? out.code : 'ok').toBe('area_effect_owed');
    });

    it('and lets it through once the debt is settled', () => {
      const log = owing();
      const settled = [...log, ...unwrap(settleAreaEffects(fold('s', log), supply()), 'settle').events];
      expect(isErr(dismiss(fold('s', settled)))).toBe(false);
    });

    /** And the sweep above is right not to list it: it spends nothing. */
    it('is not classified as a spender', () => {
      const spenders = new Set(
        [...spendersIn(Object.values(MODULE_SOURCE).join('\n'))].filter((name) =>
          COMMAND_SURFACE.has(name),
        ),
      );
      expect(spenders.has('endOngoingSpell')).toBe(false);
      expect(COMMAND_SURFACE.has('endOngoingSpell')).toBe(true);
    });
  });

  /**
   * And so does the **other** door out of a casting, which was the one left
   * open.
   *
   * `endConcentration` and `endOngoingSpell` converge on `releaseCasting`, so
   * they forgive exactly the same thing — the casting's outstanding
   * `OwedAreaEffect`s — and a guard on one of them only is two doors out of one
   * room disagreeing about whether the world has to be settled first. That is
   * `relocateCreature`'s sentence about two operations that both move a
   * creature, arriving at the two operations that both end a casting.
   *
   * **The SRD sentence is not the objection it looks like.** "The creator can
   * end Concentration at any time (no action required)" is the same licence the
   * dismissal one paragraph away prints — "you can dismiss it (no action
   * required)" — and that command is guarded. `mayAct` is not a claim about the
   * action economy here: it is the engine refusing to act into a world that
   * owes a mandatory mechanical fact, and it says *settle the save, then let
   * go*, never *you may not let go*. Nothing in the book makes a caster's
   * letting go pre-empt a save that has already been triggered, and the debt
   * may be what ends the Concentration anyway: damage owed is a Constitution
   * save owed.
   *
   * Asserted in both directions, in a world where the outstanding save belongs
   * to the casting being let go of.
   */
  describe('and so does the other door out of a casting', () => {
    const letGo = (s: GameState) => endConcentration(s, A, 'voluntary');

    it('really is A’s own Web that A is concentrating on, and it owes the save', () => {
      const state = fold('s', webbed());
      expect(state.creatures[A]?.concentration?.castingId).toBe('cast:1');
      expect(state.owedAreaEffects.map((o) => o.castingId)).toContain('cast:1');
    });

    it('is refused while that area effect is owed', () => {
      const out = letGo(fold('s', webbed()));
      expect(isErr(out) ? out.code : 'ok').toBe('area_effect_owed');
    });

    it('and lets it through once the debt is settled', () => {
      const log = webbed();
      const settled = [...log, ...unwrap(settleAreaEffects(fold('s', log), supply()), 'settle').events];
      const out = letGo(fold('s', settled));
      expect(isErr(out) ? out.code : 'ok').toBe('ok');
      expect(isErr(out) ? [] : out.value.map((event) => event.type)).toEqual(['concentration-ended']);
    });

    /** And the sweep above is right not to list it: it spends nothing. */
    it('is not classified as a spender', () => {
      const spenders = new Set(
        [...spendersIn(Object.values(MODULE_SOURCE).join('\n'))].filter((name) =>
          COMMAND_SURFACE.has(name),
        ),
      );
      expect(spenders.has('endConcentration')).toBe(false);
      expect(COMMAND_SURFACE.has('endConcentration')).toBe(true);
    });

    /**
     * And the guard sits **inside** the duplicate check, which is the trap this
     * repository has now sprung nine times: a retry arrives at the debt its own
     * first run may have raised, and must be told its command landed.
     *
     * A lets go of a Bless nobody's save depends on, and B is then swept back
     * into the slick by two moves that are nobody's command — so the retry
     * meets a debt that did not exist when the command was sent.
     */
    describe('and asks after the duplicate check, never before it', () => {
      const LET_GO = 'the-one-letting-go';

      const letGoThenCaught = (): readonly GameEvent[] => {
        const log = owing();
        const settled = [
          ...log,
          ...unwrap(settleAreaEffects(fold('s', log), supply()), 'settle').events,
          {
            type: 'concentration-started',
            id: A,
            castingId: 'cast:9',
            spell: 'Bless',
            level: 1,
          } satisfies GameEvent,
        ];
        const ended = [
          ...settled,
          ...unwrap(endConcentration(fold('s', settled), A, 'voluntary', { commandId: LET_GO }), 'let go'),
        ];
        // Out of the slick and back into it: the second step is what the area
        // catches, and neither is a command A sent.
        return [
          ...ended,
          { type: 'creature-moved', id: B, placement: { from: { landmark: 'the slick' }, feet: 60, bearing: 90 } },
          { type: 'creature-moved', id: B, placement: { from: { landmark: 'the slick' }, feet: 5, bearing: 90 } },
        ];
      };

      it('tells a retry that its command already landed', () => {
        const state = fold('s', letGoThenCaught());
        // The fixture really does owe something, or neither assertion means
        // anything.
        expect(state.owedAreaEffects.length).toBeGreaterThan(0);

        const retry = endConcentration(state, A, 'voluntary', { commandId: LET_GO });
        expect(isErr(retry) ? retry.code : 'ok').toBe('ok');
        expect(isErr(retry) ? ['not empty'] : retry.value).toEqual([]);
      });

      /**
       * And a genuinely new command into that same world is refused for the
       * debt — not told `not_concentrating`, which is the world its own
       * predecessor made and which the guard precedes.
       */
      it('refuses a fresh command sent into that same world', () => {
        const out = endConcentration(fold('s', letGoThenCaught()), A, 'voluntary', {
          commandId: 'a-second',
        });
        expect(isErr(out) ? out.code : 'ok').toBe('area_effect_owed');
      });
    });
  });

  /**
   * And `resolveCast` keeps its guard, written down here rather than derived.
   *
   * It was on the list above while it was a barrel command; IE-048 demoted it
   * to a module export — its one production use, the Divine Smite inside
   * `resolveAttackDamage`, goes through `resolveCastWith` — so the derived
   * sweep no longer sees it, because that sweep is about **commands**. The
   * guard is unchanged and its exemption stayed discharged, so the case moves
   * rather than being deleted: what would otherwise happen is a guard quietly
   * losing the only thing that exercised it, on the day it stopped being
   * published.
   */
  describe('and the low-level half beneath resolveSpell keeps its guard', () => {
    const cast = (s: GameState) =>
      resolveCast(s, B, { spell: 'Bless', level: 1, concentration: false, slotLevel: 1 });

    it('is refused while an area effect is owed', () => {
      const out = cast(fold('s', owing()));
      expect(isErr(out) ? out.code : 'ok').toBe('area_effect_owed');
    });

    it('and lets it through once the debt is settled', () => {
      const log = owing();
      const settled = [...log, ...unwrap(settleAreaEffects(fold('s', log), supply()), 'settle').events];
      const out = cast(fold('s', settled));
      expect(isErr(out) ? out.code : 'ok').not.toBe('area_effect_owed');
    });
  });

  /**
   * And the guard sits **inside** the duplicate check, which is the trap this
   * repository has sprung eight times: *a retry looks at the world its own
   * first run made*, and must be told its command landed rather than told
   * about that world.
   *
   * `resolveCast` is the newest guard, so it is the one worth pinning here.
   * The debt arrives between the first run and the retry and is owed by
   * somebody else's move, which is precisely the case a guard written above
   * `once` would answer wrongly.
   */
  describe('and asks after the duplicate check, never before it', () => {
    const CAST = {
      spell: 'Bless',
      level: 1,
      concentration: false,
      slotLevel: 1,
      commandId: 'the-one-casting',
    } as const;

    /** B, with a slot, having cast once — and then caught by the slick again. */
    const castThenCaught = (): readonly GameEvent[] => {
      const log = owing();
      const settled = [
        ...log,
        ...unwrap(settleAreaEffects(fold('s', log), supply()), 'settle').events,
        {
          type: 'resource-pool-declared',
          id: B,
          pool: { key: spellSlotKey(1), label: 'level 1 spell slot', max: 4, recovers: 'long-rest' },
        } satisfies GameEvent,
      ];
      const cast = [...settled, ...unwrap(resolveCast(fold('s', settled), B, CAST), 'the casting')];
      // Out of the slick and back into it: the second step is what the area
      // catches, and neither is a command B sent.
      return [
        ...cast,
        { type: 'creature-moved', id: B, placement: { from: { landmark: 'the slick' }, feet: 60, bearing: 90 } },
        { type: 'creature-moved', id: B, placement: { from: { landmark: 'the slick' }, feet: 5, bearing: 90 } },
      ];
    };

    it('tells a retry that its casting already landed', () => {
      const state = fold('s', castThenCaught());
      // The fixture really does owe something, or neither assertion means
      // anything.
      expect(state.owedAreaEffects.length).toBeGreaterThan(0);

      const retry = resolveCast(state, B, CAST);
      expect(isErr(retry) ? retry.code : 'ok').toBe('ok');
      expect(isErr(retry) ? [] : retry.value).toEqual([]);
    });

    /** And a genuinely new casting into the same world is refused. */
    it('refuses a second casting sent into that same world', () => {
      const out = resolveCast(fold('s', castThenCaught()), B, { ...CAST, commandId: 'a-second' });
      expect(isErr(out) ? out.code : 'ok').toBe('area_effect_owed');
    });
  });
});

/**
 * The commands that end a casting without spending anything — and the sweep
 * that can see them, which the action-economy closure cannot.
 *
 * **Why this is its own sweep.** Ending a casting **forgives what that casting
 * owes**: `releaseCasting` is the single door and it drops the casting's
 * outstanding `OwedAreaEffect`s along with its conditions, bonuses and timers.
 * That is a reason to consult `mayAct` which has nothing to do with the action
 * economy — and the sweep above finds commands by what they spend, so a command
 * that ends a casting and spends nothing is invisible to it. Two were:
 * `endOngoingSpell`, which IE-048 guarded deliberately, and `endConcentration`,
 * which IE-048 found and reported because its brief did not name it. Nothing
 * asked the question in general, which is why the second one could sit there.
 *
 * So the question is asked in general: every command the ending closure reaches
 * that the spender closure does not must either consult `mayAct` in its own
 * body or carry a sentence here saying why not — and never both, in either
 * direction. A command added to the command layer that ends a casting is then
 * one of the two, rather than neither.
 */
const ENDS_A_CASTING_UNGUARDED: Readonly<Record<string, string>> = {
  beginCombat:
    'the moment the turn economy starts existing, so there is nobody yet acting for a guard to ask about: the first combatant’s turn starts with the fight, the payout that boundary owes is settled by the command that opened it, and a casting can end only because that settlement was damage — refusing to start a fight while something stood owed would leave the debt with no turn to be settled on',
  rollInitiativeAndBeginCombat:
    'the same moment reached through the dice, which is the whole of what it adds: it rolls Initiative and hands the order to beginCombat, so the casting it can end is the one that boundary’s payout ends, and it is exempt for the same reason and no other',
  declareLight:
    'the casting it ends is ended by the **book** rather than by anybody acting: SRD Darkness and SRD Daylight put each other out where their areas overlap, and this command is the table saying where the light is. Nobody in the fight spends a thing on a declaration, the dispel is a consequence of the geometry rather than a decision, and a guard would refuse to let a DM describe the room because somebody owed a saving throw — which is `rollImprovisedDamage`’s exemption in the same words',
  removeCreatureEverywhere:
    'the casting leaves with its caster, and the creature leaving is bookkeeping about the cast rather than an action: refusing it while a debt stood would leave a fight unable to continue without somebody who is already gone',
  dismissStrandedSummons:
    'it is removeCreatureEverywhere aimed at whoever the fold already noticed was standing on a spell that is over, so it ends a casting for exactly that command\u2019s reason and no other \u2014 a summons sustaining a summons takes the second one with it \u2014 and it is the settlement of a thing the reducer raised, which settleAreaEffects is exempt for in the same words: a guard that refused its own settlement would be a deadlock wearing a rule\u2019s clothes',
  resolveDamage:
    'the outcome of damage rather than a decision anybody makes: SRD ends the Concentration through the Constitution saving throw this command rolls, and settling the debt is frequently what sent the damage here in the first place',
  resolvePendingSaves:
    'it settles the debt the reducer raised, which is `dismissStrandedSummons`’ exemption in the same words: a guard that refused its own settlement would be a deadlock wearing a rule’s clothes — the engine refuses to advance another turn while a save stands owed, so a `mayAct` here would leave the fight unable to reach the command that clears it. What it can end a casting through is the damage a boundary deals before the save it owes — SRD Searing Smite’s burning — and that reaches `dealSpellDamage`, whose Concentration save is `resolveDamage`’s exemption above, arriving one settlement earlier',
  rollImprovisedDamage:
    'the same outcome with the dice still to throw, and exempt for the same reason: the falling brazier is not anybody’s action, nobody in the fight spends a thing on it, and the Concentration it can end is ended by the save `resolveDamage` beneath it rolls — a guard would refuse the ceiling coming down because somebody owed a saving throw',
  // `settleAreaEffects` was here until a `chance` effect began counting its
  // casting. The count is a `resource-spent`, so an effect list this command
  // settles can reach one and the spender closure finds it — its exemption
  // moved to `UNGUARDED_ON_PURPOSE` with its reason, exactly as `settleDamage`
  // did below and for the same structural reason.
  // `settleDamage` was here until it began resolving the rider a blow holds
  // for the defender's answer. Spending that rider's pool makes it a spender,
  // so the closure above finds it now and its exemption lives there — the two
  // lists are disjoint by construction and a name on both is an exemption
  // gone stale.
};

describe('every command that ends a casting asks whether it may, or says why not', () => {
  const all = Object.values(MODULE_SOURCE).join('\n');
  const spenders = new Set([...spendersIn(all)].filter((name) => COMMAND_SURFACE.has(name)));
  const enders = [...castingEndersIn(all)]
    .filter((name) => COMMAND_SURFACE.has(name) && !spenders.has(name))
    .sort();
  const guarded = guardedIn(all);

  /** The analysis is not vacuous: it finds the shape it is shown. */
  it('would find a casting-ender if one were added', () => {
    const smuggled = [
      'export function letItGoQuietly(state: GameState): Result<GameEvent[]> {',
      "  return ok([{ type: 'concentration-ended', id, castingId, reason: 'voluntary' }]);",
      '}',
    ].join('\n');
    expect([...castingEndersIn(smuggled)]).toEqual(['letItGoQuietly']);
    // And a command that ends nothing is not swept up with it.
    expect([...castingEndersIn('export function lookAtSomething(): number {\n  return 1;\n}')]).toEqual([]);
  });

  it('finds the two doors out of a casting, and finds them guarded', () => {
    expect(enders).toContain('endConcentration');
    expect(enders).toContain('endOngoingSpell');
    expect(guarded.has('endConcentration')).toBe(true);
    expect(guarded.has('endOngoingSpell')).toBe(true);
  });

  it('accounts for every one that is unguarded, and invents none', () => {
    const unguarded = enders.filter((name) => !guarded.has(name));
    expect(unguarded).toEqual(Object.keys(ENDS_A_CASTING_UNGUARDED).sort());
    expect(Object.values(ENDS_A_CASTING_UNGUARDED).every((reason) => reason.length > 20)).toBe(true);
  });

  /** And no name is on the list *and* guarded, which is an exemption gone stale. */
  it('holds no exemption for a command that consults mayAct after all', () => {
    expect(Object.keys(ENDS_A_CASTING_UNGUARDED).filter((name) => guarded.has(name))).toEqual([]);
  });
});

/**
 * The commands that are not actions at all, and the other half of the sweep
 * above.
 *
 * `UNGUARDED_ON_PURPOSE` is the exemption list for a command that **spends**
 * something and consults `mayAct` anyway — every entry in it is a name the
 * derived sweep found and a sentence saying why the guard is absent. The
 * scene-setup family is a different claim: these commands spend nothing, so
 * the sweep never classifies one as a spender and adding a name here would
 * have failed its own "invents none" assertion. The decision would then have
 * lived nowhere.
 *
 * So it lives here, in the shape the exemption lists use and with the same
 * discipline: derived from the modules rather than typed out, so a command
 * added to either of them fails this until somebody writes the sentence — and
 * checked behaviourally, because a reason nothing tests is prose.
 *
 * **`DECLARING_MODULES` is the scope, and a module joins it only when every
 * public command in it declares rather than acts.** That is what the second
 * assertion below checks, and it is why the three DM-declared events that
 * *do* spend — `mounted`, `dismounted` and `free-interaction-used` — live in
 * `commands/movement.ts` and `commands/actions.ts` rather than beside the six
 * here. Filing them together would have forced this list to be filtered by the
 * spender analysis, and the filter would have made "none of these spends" true
 * by construction instead of by test.
 *
 * **`commands/creatures.ts` joined on that rule rather than for
 * `addCreature`'s sake**, and the consequence is the five entries beside it. A
 * monster walking through the door spends nobody anything; so does damage,
 * healing, an Exhaustion level, Temporary Hit Points and a creature leaving,
 * every one of which is the *outcome* of something that spent its own cost
 * through its own command — `stabiliseCreature`'s reading, applied to the
 * module `addCreature` belongs to. Filing `addCreature` here without the other
 * five was not an option: the scope is the module, and a module that is in it
 * makes the claim about all of its commands.
 */
const DECLARING_MODULES = [
  'commands/scene.ts',
  'commands/declarations.ts',
  'commands/creatures.ts',
  // The fourth, and it joined on the same rule the third did: the one public
  // command in it declares that a thing is in the room, which is as pure a
  // declaration as this list holds.
  'commands/objects.ts',
];

const DECLARED_NOT_ACTED: Readonly<Record<string, string>> = {
  setScene:
    'not an action in the turn economy: the room the fight is happening in is a fact the DM declares, and no SRD rule spends anything to describe it',
  addSceneLandmark:
    'not an action in the turn economy: laying out the room is map-making, and a bar nobody had mentioned costs its describer nothing',
  placeCreatureInScene:
    'not an action in the turn economy: a creature walking into the scene is placed rather than moved, and SRD spends movement only on a move from somewhere',
  declareSightBetween:
    'not an action in the turn economy: whether one creature can see another is a fact about the room, declared because computing it would need walls',
  declareCoverBetween:
    'not an action in the turn economy: cover is declared for the same reason sight is, and a creature does not spend anything to be behind a bar',
  beginCombat:
    'not an action in the turn economy: it is the moment the economy starts existing, so there is no budget yet for it to spend',
  endCombat:
    'not an action in the turn economy: a fight being over is a fact about the room rather than a thing anybody does in it — SRD prices no action for the moment the last enemy falls, the moment they throw down their weapons or the moment the party lets them run, and the budget it closes is the very thing it would have had to spend from',
  advanceTime:
    'not an action in the turn economy: outside combat there are no turns, and how long the party spent searching the vault is narration. Inside one it is refused — the clock there is the turn order’s — and that refusal is about who owns the clock rather than about anybody’s budget, which is what REFUSED_BY_THE_CLOCK below makes a test rather than a sentence',
  declareDawn:
    'not an action in the turn economy: the sun coming up is a fact the DM declares, it happens to the world rather than to anybody in it, and no SRD rule spends a turn’s budget on a sunrise — it costs the fighter mid-swing exactly nothing',
  declareSpellcasting:
    'not an action in the turn economy: it states what a creature with no class table can cast, which is a fact about the creature and not a casting',
  declareCreatureSide:
    'not an action in the turn economy: who counts as an ally is fiction, and a bandit being bribed costs the bandit nothing on anybody’s turn',
  declareCreatureHeads:
    'not an action in the turn economy: how many heads a creature has is a fact about the creature, and SRD prices nothing for having them — the Attack action those heads size is spent by the swing that takes it, through its own command',
  swapInitiativeBetween:
    'not an action in the turn economy: SRD Alert spends nothing on the swap — "immediately after you roll Initiative, you can swap" — and at that moment no budget has been handed out yet',
  stabiliseCreature:
    'not an action in the turn economy: the Help action or the Healer’s Kit use that stabilised the creature was spent through its own command, and this records what happened to the creature on the floor',
  declareCreatureDead:
    'not an action in the turn economy: whatever killed them spent its own cost, and a death the engine did not compute is a fact somebody declares',
  loseItems:
    'not an action in the turn economy: a thief in the night, a mimic, a DM’s ruling — SRD spends nothing when something is taken away from you',
  transferItem:
    'not an action in the turn economy: dividing a hoard happens between fights and costs nobody a turn, and the one moment SRD does price — handing something over mid-combat — is the free object interaction, which is spent through useFreeObjectInteraction by whoever is having the turn',
  awardItems:
    'not an action in the turn economy: what the party found in the barrow is a fact the DM declares, it happens to the world rather than on anybody’s turn, and SRD spends nothing to be handed treasure',
  removeBonusFrom:
    'not an action in the turn economy: a bonus stopping is the end of something, and nobody spends anything to have an effect wear off',
  addCreature:
    'not an action in the turn economy: a monster walking through the door is a fact the DM declares, and SRD spends nothing on anybody’s turn to have one arrive',
  dismissStrandedSummons:
    'not an action in the turn economy: the spell that was holding the creature here has already ended, through whatever spent its own cost \u2014 a dismissal, a deadline, a rockfall \u2014 and clearing away what that ending left behind costs nobody a turn\u2019s budget, exactly as removeCreatureEverywhere beside it costs nobody one',
  strandedSummons:
    'not an action in the turn economy, and not an action at all: it is the question "who is standing here on a spell that is over", read off state and answering it changes nothing. It is in this list rather than exempt from it because the list\u2019s scope is the module \u2014 and the entry earns its place rather than excusing anything, because being named here is strictly harder than being absent: the roster is derived from the module and the barrel, so a sentence can only explain a name the derivation already found, and the behavioural half below then demands the function actually succeed. For this one that is a real claim rather than a formality. resolveTurn now refuses to advance while this answers anybody, so a query that refused while a mandatory area effect stood owed would be a deadlock rather than a rule',
  summonCreature:
    'not an action in the turn economy: the casting that conjured the creature spent its own Action, its slot and its Concentration through resolveSpell, and the creature then arriving costs nobody a second budget — the same reading damage and healing take, applied to the thing a spell produced rather than to the thing it did',
  damageCreature:
    'not an action in the turn economy: damage is the outcome of an attack, a spell or a trap, each of which spent its own cost through its own command',
  healCreature:
    'not an action in the turn economy: the spell, the potion or the feature that healed spent its own cost, and this records what reached the hit points',
  setExhaustionLevel:
    'not an action in the turn economy: an Exhaustion level is set by a march, a rule or a DM’s ruling, and none of them is a turn’s Action to spend',
  grantTemporaryHpTo:
    'not an action in the turn economy: whatever granted them spent its own cost, and receiving Temporary Hit Points costs the receiver nothing',
  removeCreatureEverywhere:
    'not an action in the turn economy: a creature leaving the game is bookkeeping about the cast, and nobody spends a turn’s budget to have somebody gone',
  declareObject:
    'not an action in the turn economy: that there is a barred oak door in the room is a fact the DM declares, it was true before anybody’s turn began, and SRD prices nothing for the world containing something — what a creature then does to the door is the swing that takes it, through its own command',
};

describe('the DM-declared commands declare facts rather than taking actions', () => {
  /** Every command those modules publish, read off them and off the barrel. */
  const declared = DECLARING_MODULES.flatMap((module) =>
    functionsIn(MODULE_SOURCE[module]!)
      .filter((fn) => fn.exported && COMMAND_SURFACE.has(fn.name))
      .map((fn) => fn.name),
  ).sort();

  it('accounts for every one of them, and invents none', () => {
    expect(declared.length).toBeGreaterThan(0);
    expect(declared).toEqual(Object.keys(DECLARED_NOT_ACTED).sort());
    expect(Object.values(DECLARED_NOT_ACTED).every((reason) => reason.length > 20)).toBe(true);
  });

  /**
   * And the claim is about the code rather than the comment. None of them
   * spends anything the action-economy sweep can see, and none of them names
   * `mayAct` — so a later edit that started guarding one, or that started
   * spending, fails here rather than silently changing what the list says.
   */
  it('spends nothing, and asks nothing about whose turn it is', () => {
    const spenders = spendersIn(Object.values(MODULE_SOURCE).join('\n'));
    for (const name of declared) expect([name, spenders.has(name)]).toEqual([name, false]);
    // The **code**, not the prose: the module's own docstring says it does not
    // consult `mayAct`, and a claim checked against the sentence that makes it
    // would be checking nothing.
    for (const module of DECLARING_MODULES) {
      const code = MODULE_SOURCE[module]!
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      expect(code, module).not.toMatch(/\bmayAct\b/);
      // And the stripping did not simply remove the whole file.
      expect(code, module).toMatch(/\bonce\(/);
    }
  });

  /**
   * The half that bites. A creature owing a mandatory area effect may not
   * act — and the DM may still describe the room, place the creature that
   * just walked in, and start the fight. Every one of these **succeeds**
   * against the world that refuses every spender above, which is what makes
   * "these are not actions" a behaviour rather than an assertion.
   */
  const declaring: readonly { readonly name: string; readonly run: (s: GameState) => Result<unknown> }[] = [
    { name: 'setScene', run: (s) => setScene(s, { width: 400, depth: 400, height: 40 }) },
    { name: 'addSceneLandmark', run: (s) => addSceneLandmark(s, 'the hearth', { x: 20, y: 30, z: 0 }) },
    {
      name: 'placeCreatureInScene',
      run: (s) => placeCreatureInScene(s, C, { from: { landmark: 'the slick' }, feet: 30, bearing: 90 }),
    },
    { name: 'declareSightBetween', run: (s) => declareSightBetween(s, A, B, false) },
    { name: 'declareCoverBetween', run: (s) => declareCoverBetween(s, A, B, 'half') },
    {
      name: 'beginCombat',
      run: (s) =>
        beginCombat(s, [
          { id: A, initiative: 21, speed: 30 },
          { id: B, initiative: 3, speed: 30 },
        ]),
    },
    // A surrender, because it is the ending this fixture can state without
    // hurting anybody: `SETUP` has A on `party` and B on `foes`, both on their
    // feet. An owed area effect is not a reason a fight cannot be over — the
    // debt outlives the fight and `settleAreaEffects` still pays it.
    { name: 'endCombat', run: (s) => endCombat(s, { kind: 'surrender', side: 'foes' }) },
    { name: 'advanceTime', run: (s) => advanceTime(s, 600, 'the storm passes') },
    { name: 'declareDawn', run: (s) => declareDawn(s, supply()) },
    {
      name: 'declareSpellcasting',
      run: (s) => declareSpellcasting(s, B, declaredCasting({ ability: 'wis', prepared: ['bless'] })),
    },
    { name: 'declareCreatureSide', run: (s) => declareCreatureSide(s, C, 'the watch') },
    { name: 'declareCreatureHeads', run: (s) => declareCreatureHeads(s, C, 3) },
    { name: 'swapInitiativeBetween', run: (s) => swapInitiativeBetween(s, A, B, { willing: true }) },
    { name: 'stabiliseCreature', run: (s) => stabiliseCreature(s, C) },
    { name: 'declareCreatureDead', run: (s) => declareCreatureDead(s, C, 'off-screen') },
    {
      name: 'loseItems',
      run: (s) => loseItems(s, A, [{ id: 'longsword', quantity: 1 }], 'a thief'),
    },
    {
      name: 'transferItem',
      run: (s) => transferItem(s, A, B, 'longsword', 1, 'a gift'),
    },
    {
      name: 'awardItems',
      run: (s) => awardItems(s, supply(), A, [{ id: 'rope' }], 'the barrow'),
    },
    { name: 'removeBonusFrom', run: (s) => removeBonusFrom(s, A, 'a quiet word') },
    { name: 'addCreature', run: (s) => addCreature(s, SRD_CONTENT, id('a-latecomer'), ZOMBIE) },
    {
      name: 'summonCreature',
      run: (s) => summonCreature(s, SRD_CONTENT, {
          id: id('a-conjured-thing'),
          monsterId: ZOMBIE,
          by: A,
          initiative: 14,
        }),
    },
    // Nothing is stranded in this fixture, so what it proves is the half the
    // list is about: a command that may be sent while a mandatory area effect
    // stands owed. The sweep it does is driven in `summoning.test.ts`.
    //
    // It matters more now than it did. `resolveTurn` refuses to advance while
    // a summons is stranded, so a settlement that could itself be refused
    // while an area effect stood owed would be two debts each waiting on the
    // other — the deadlock `settleAreaEffects` is exempt for in the same
    // words.
    { name: 'dismissStrandedSummons', run: (s) => dismissStrandedSummons(s) },
    // A question rather than a command, wrapped so this list can ask it: what
    // it proves here is that the engine goes on answering while a debt stands
    // — which is what the turn's own refusal is now reading.
    { name: 'strandedSummons', run: (s) => ok(strandedSummons(s)) },
    // C is the creature on the floor at 0 hit points, so healing has something
    // to do and a removal has somebody to remove; A is whole, so damage does.
    { name: 'damageCreature', run: (s) => damageCreature(s, A, { amount: 5, source: 'a trap' }) },
    { name: 'healCreature', run: (s) => healCreature(s, C, 3) },
    { name: 'setExhaustionLevel', run: (s) => setExhaustionLevel(s, A, 2) },
    { name: 'grantTemporaryHpTo', run: (s) => grantTemporaryHpTo(s, A, 4) },
    { name: 'removeCreatureEverywhere', run: (s) => removeCreatureEverywhere(s, C) },
    {
      name: 'declareObject',
      run: (s) =>
        declareObject(s, SRD_CONTENT, id('a-barred-door'), {
          name: 'a barred door',
          material: 'wood',
          size: 'medium',
          build: 'resilient',
        }),
    },
  ];

  /**
   * The spenders' own fixture, plus what these six need to do something.
   *
   * C is a creature nobody has placed, on the floor at 0 hit points; A carries
   * a bonus no casting hung. Without those two facts `stabiliseCreature` would
   * be refused and `removeBonusFrom` would succeed by having nothing to do —
   * and a case that passes by being unreachable proves nothing, which is the
   * lesson `greased()` itself already carries.
   */
  const owedAndWatching = (): readonly GameEvent[] => [
    ...owing(),
    added(C, 'onlookers'),
    { type: 'damage-taken', id: C, amount: 60, source: 'something off-screen' },
    {
      type: 'bonus-applied',
      id: A,
      bonus: {
        source: 'a quiet word',
        bonus: { source: 'a quiet word', flat: 1 },
        applies: ['save'],
        direction: 'add',
      },
    },
  ];

  it('covers every command those modules publish', () => {
    expect(declaring.map((entry) => entry.name).sort()).toEqual(declared);
  });

  it('really does owe an area effect in this fixture', () => {
    expect(fold('s', owedAndWatching()).owedAreaEffects.length).toBeGreaterThan(0);
  });

  /**
   * The one command here that this fixture refuses, and the code it refuses
   * with — because the fixture is a **fight** and the clock inside one is the
   * turn order's, not because anybody owes anything.
   *
   * Written down rather than skipped, and then checked three ways below: the
   * code is the one named, the same refusal comes back from a fight owing
   * nothing at all, and the command succeeds against the same world with the
   * fight taken out. Together those say the refusal tracks the fight and not
   * the debt, which is the claim this whole sweep is about. A second entry
   * here would have to earn the same three.
   */
  const REFUSED_BY_THE_CLOCK: Readonly<Record<string, string>> = {
    advanceTime: 'in_combat',
  };

  /**
   * The one command here that this fixture refuses because of **when** it is,
   * and the code it refuses with.
   *
   * SRD Alert's swap happens "immediately after you roll Initiative", and this
   * fixture has moved on a turn to put somebody in the grease — so the window
   * is shut for the same reason it would be shut in any fight a round old.
   * Earned the same three ways as the entry above, with the axes swapped: the
   * code is the one named, a fight one turn in and owing **nothing** refuses
   * identically, and the same fight still at the moment does not refuse at
   * all.
   */
  const REFUSED_BY_THE_MOMENT: Readonly<Record<string, string>> = {
    swapInitiativeBetween: 'not_the_moment',
  };

  it('names only commands this sweep actually runs', () => {
    const names = new Set(declaring.map((entry) => entry.name));
    expect(Object.keys(REFUSED_BY_THE_CLOCK).filter((name) => !names.has(name))).toEqual([]);
    expect(Object.keys(REFUSED_BY_THE_MOMENT).filter((name) => !names.has(name))).toEqual([]);
  });

  for (const entry of declaring) {
    it(`${entry.name}: allowed while an area effect is owed`, () => {
      const out = entry.run(fold('s', owedAndWatching()));
      const moment = REFUSED_BY_THE_MOMENT[entry.name];
      if (moment !== undefined) {
        expect(isErr(out) ? out.code : 'ok').toBe(moment);
        // A fight one turn in and owing nothing answers the same, so the debt
        // is not what refused it …
        const movedOn = [
          ...SETUP,
          ...unwrap(resolveTurn(fold('s', SETUP), supply()), 'on to B').events,
        ];
        expect(fold('s', movedOn).owedAreaEffects).toEqual([]);
        expect(isErr(entry.run(fold('s', movedOn))) ? 'refused' : 'ok').toBe('refused');
        // … and the same fight still at the moment does not refuse at all.
        expect(isErr(entry.run(fold('s', SETUP))) ? 'refused' : 'ok').toBe('ok');
        return;
      }

      const refusal = REFUSED_BY_THE_CLOCK[entry.name];
      if (refusal === undefined) {
        expect(isErr(out) ? `${out.code}: ${out.reason}` : 'ok').toBe('ok');
        return;
      }

      expect(isErr(out) ? out.code : 'ok').toBe(refusal);
      // A fight with nothing owed answers the same, so the debt is not what
      // refused it …
      expect(fold('s', SETUP).owedAreaEffects).toEqual([]);
      const quiet = entry.run(fold('s', SETUP));
      expect(isErr(quiet) ? quiet.code : 'ok').toBe(refusal);
      // … and the same world with no fight in it does not refuse at all.
      const peace = entry.run(fold('s', OUT_OF_COMBAT));
      expect(isErr(peace) ? `${peace.code}: ${peace.reason}` : 'ok').toBe('ok');
    });
  }

  /**
   * And the peacetime fixture is `SETUP` with one event taken out, rather than
   * a second setup that could drift away from it.
   */
  it('takes nothing but the fight out of the peacetime fixture', () => {
    expect(fold('s', SETUP).combat).not.toBeNull();
    expect(fold('s', OUT_OF_COMBAT).combat).toBeNull();
    expect(SETUP.length - OUT_OF_COMBAT.length).toBe(1);
  });
});

/**
 * Which exports hand back events, so the idempotency sweep can be told what it
 * has not covered.
 *
 * Read off the declared return type rather than guessed: `Result<GameEvent[]>`
 * or a `Result<X>` whose `X` carries an `events` field. A named type nothing
 * declares is reported rather than skipped — a classifier that silently
 * answers "no" to a shape it does not understand reports no problems and
 * checks nothing, which is what `animals.md` taught.
 */
const DECLARATIONS = Object.values(MODULE_SOURCE)
  .join('\n')
  .concat(
    ['attack.ts', 'combat.ts', 'events.ts', 'positioning.ts', 'resources.ts', 'spells.ts', 'time.ts', 'timers.ts']
      .map((f) => readFileSync(`${SRC}${f}`, 'utf8'))
      .join('\n'),
  );

const returnTypesIn = (
  source: string,
): readonly { readonly name: string; readonly returns: string }[] => {
  const lines = linesOf(source);
  const found: { name: string; returns: string }[] = [];
  // Both declaration forms and both signature layouts. A function-valued
  // export whose shape is matched by none of these comes back with an empty
  // return type and is reported by the test below, rather than being quietly
  // classified as "hands the caller no events" — the failure mode `animals.md`
  // taught and the one these sweeps exist to prevent.
  const OPENS = [/^export (?:async )?function (\w+)\(/, /^export const (\w+) = (?:async )?\(/];
  const INLINE = [
    /^export (?:async )?function \w+\(.*\): (.+) \{$/,
    /^export const \w+ = (?:async )?\(.*\): (.+?) =>/,
  ];
  const CLOSES = [/^\): (.+) \{$/, /^\): (.+?) =>/];

  for (let i = 0; i < lines.length; i += 1) {
    const head = OPENS.map((re) => re.exec(lines[i]!)).find((m) => m !== null);
    if (head === undefined || head === null) continue;
    const inline = INLINE.map((re) => re.exec(lines[i]!)).find((m) => m !== null);
    if (inline !== undefined && inline !== null) {
      found.push({ name: head[1]!, returns: inline[1]! });
      continue;
    }
    let returns = '';
    for (let j = i + 1; j < lines.length; j += 1) {
      const close = CLOSES.map((re) => re.exec(lines[j]!)).find((m) => m !== null);
      if (close !== undefined && close !== null) {
        returns = close[1]!;
        break;
      }
      if (/^(export )?(?:(?:async )?function|const) /.test(lines[j]!)) break;
    }
    found.push({ name: head[1]!, returns });
  }
  return found;
};

/**
 * Whether a type expression has a `|` at its own level, rather than inside a
 * type argument, an object or a tuple.
 */
const isUnion = (payload: string): boolean => {
  let depth = 0;
  for (const character of payload) {
    if ('<{(['.includes(character)) depth += 1;
    else if ('>})]'.includes(character)) depth -= 1;
    else if (character === '|' && depth === 0) return true;
  }
  return false;
};

/** Whether a declared return type hands the caller events. */
const carriesEvents = (returns: string): boolean | 'unresolved' => {
  const inner = /^Result<([\s\S]*)>$/.exec(returns.trim());
  if (inner === null) return false;
  const payload = inner[1]!.trim().replace(/^readonly /, '');
  // **A union is not a shape this can classify**, and answering `false` was
  // the silence the whole classifier exists to prevent: one arm may carry
  // events and another may not, so `Result<A | B>` needs a person to look
  // rather than a regex that has quietly decided. IE-003's reviewer left this
  // as the one place the classifier still answered "no" to something it had
  // simply never heard of.
  if (isUnion(payload)) return 'unresolved';
  if (/^GameEvent\[\]$/.test(payload)) return true;
  if (/readonly events:/.test(payload)) return true;
  if (!/^[A-Z]\w*$/.test(payload)) return false;
  const declared = new RegExp(
    `export interface ${payload}(?: extends [^{]+)? \\{([\\s\\S]*?)\\n\\}`,
  ).exec(DECLARATIONS);
  if (declared === null) return 'unresolved';
  return /readonly events:/.test(declared[1]!);
};

/**
 * Event-returning exports that deliberately take no command id, each with the
 * reason. CLAUDE.md names four as fixture and log-reconstruction halves; the
 * rest are pure builders that emit an event without deciding anything.
 */
const UNIDENTIFIED_ON_PURPOSE: Readonly<Record<string, string>> = {
  applySpellEffect:
    'a builder for a caller reconstructing a log or scripting a fixture; it decides nothing and spends nothing',
  declareResourcePool: 'declaring a pool twice is refused outright, so a retry cannot double one',
};

describe('the idempotency sweep covers every command that hands back events', () => {
  // Every module, and only the exports the barrel publishes as commands: a
  // cross-module helper is `export`ed so a sibling can call it, and demanding
  // a command id from half a command is a different claim from the one this
  // sweep makes.
  const eventReturning = Object.keys(MODULE_SOURCE).flatMap((file) =>
    returnTypesIn(MODULE_SOURCE[file]!)
      .filter((entry) => COMMAND_SURFACE.has(entry.name))
      .map((entry) => ({ file, ...entry })),
  );

  it('classifies every export’s return type, resolving every named one', () => {
    const unresolved = eventReturning
      .filter((entry) => carriesEvents(entry.returns) === 'unresolved')
      .map((entry) => `${entry.name}: ${entry.returns}`);
    expect(unresolved).toEqual([]);
  });

  /**
   * And it read a return type off **every** function-valued export, rather
   * than off the ones whose declaration form it happened to recognise. A
   * signature laid out in a way the regexes do not know comes back empty here
   * instead of silently answering "no events", which is the whole difference
   * between a guard and a guard-shaped thing.
   */
  it('reads a return type off every function-valued export', () => {
    const silent = eventReturning.filter((entry) => entry.returns.trim() === '');
    expect(silent.map((entry) => `${entry.file}:${entry.name}`)).toEqual([]);

    // And it saw as many commands as the modules declare, so a form it does
    // not open at all cannot go unnoticed either.
    for (const file of Object.keys(MODULE_SOURCE)) {
      const declared = functionsIn(MODULE_SOURCE[file]!)
        .filter((fn) => fn.exported && COMMAND_SURFACE.has(fn.name))
        .filter((fn) => /^(export const \w+ = (?:async )?\(|export (?:async )?function)/m.test(fn.body))
        .map((fn) => fn.name)
        .sort();
      const classified = returnTypesIn(MODULE_SOURCE[file]!)
        .filter((entry) => COMMAND_SURFACE.has(entry.name))
        .map((entry) => entry.name)
        .sort();
      expect(classified, file).toEqual(declared);
    }
  });

  /**
   * The list `CLAUDE.md` claims is authoritative, made so. Every export whose
   * return carries events is either run twice under one id above, or written
   * down here with the reason it is not.
   */
  it('leaves no event-returning export unaccounted for', () => {
    const swept = new Set(GUARDED.map((entry) => entry.name.replace(/ \(.*\)$/, '')));
    const missing = eventReturning
      .filter((entry) => carriesEvents(entry.returns) === true)
      .map((entry) => entry.name)
      .filter((name) => !swept.has(name) && UNIDENTIFIED_ON_PURPOSE[name] === undefined)
      .sort();
    expect(missing).toEqual([]);
  });

  /** No stale exemptions: a name here must still be an export that returns events. */
  it('keeps no exemption for a command that no longer needs one', () => {
    const carriers = new Set(
      eventReturning.filter((entry) => carriesEvents(entry.returns) === true).map((e) => e.name),
    );
    expect(Object.keys(UNIDENTIFIED_ON_PURPOSE).filter((name) => !carriers.has(name))).toEqual([]);
    expect(Object.values(UNIDENTIFIED_ON_PURPOSE).every((reason) => reason.length > 20)).toBe(true);

    // **And an exemption is not a note.** A command that is in the sweep does
    // not need excusing from it, and a reason written beside one reads as a
    // decision when it is a remark — which is how `castSpell` came to sit in
    // both lists, exempted from a sweep that was already running it.
    const swept = new Set(GUARDED.map((entry) => entry.name.replace(/ \(.*\)$/, '')));
    expect(Object.keys(UNIDENTIFIED_ON_PURPOSE).filter((name) => swept.has(name))).toEqual([]);
  });

  /** The same rule on the other side: a spender is guarded or exempt, never both. */
  it('leaves no command both swept and exempted in the action-economy list', () => {
    const run = new Set(SPENDERS.map((entry) => entry.name));
    expect(Object.keys(UNGUARDED_ON_PURPOSE).filter((name) => run.has(name))).toEqual([]);
    expect(Object.values(UNGUARDED_ON_PURPOSE).every((reason) => reason.length > 20)).toBe(true);
  });

  /**
   * And the idempotency machinery sits **below** the command layer.
   *
   * `rest.ts` used to import `identify` from `commands.ts` — one upward edge
   * in an otherwise acyclic value graph, and the kind that turns into a real
   * cycle the first time the command layer wants something a rest knows. The
   * helper is not a rule about any particular command, so it has a module of
   * its own and everybody imports downwards.
   */
  it('keeps the idempotency helper below the commands that use it', () => {
    expect(/from '\.\/commands\.js'/.test(MODULE_SOURCE['rest.ts']!)).toBe(false);
    expect(/from '\.\/idempotency\.js'/.test(MODULE_SOURCE['rest.ts']!)).toBe(true);
    const helper = readFileSync(
      `${fileURLToPath(new URL('.', import.meta.url))}idempotency.ts`,
      'utf8',
    );
    // And it imports nothing from either of them, so the edge cannot come back.
    expect(/from '\.\/(commands|rest)\.js'/.test(helper)).toBe(false);
  });

  /** And the classifier is not vacuous: it finds one it is shown. */
  it('would find an unguarded event-returning export if one were added', () => {
    const smuggled = [
      'export function doSomethingUntracked(',
      '  state: GameState,',
      '): Result<GameEvent[]> {',
      '  return ok([]);',
      '}',
      'export function lookSomethingUp(state: GameState): number {',
      '  return 1;',
      '}',
      // And a union, which no export declares today: one arm may carry events
      // and another may not, so the honest answer is that a person has to
      // look. Answering `false` was the last place this classifier still said
      // "no" to a shape it had simply never heard of.
      'export function answerOneWayOrAnother(state: GameState): Result<SettledDamage | number> {',
      '  return ok(1);',
      '}',
    ].join('\n');
    const classified = returnTypesIn(smuggled).map((e) => [e.name, carriesEvents(e.returns)]);
    expect(classified).toEqual([
      ['doSomethingUntracked', true],
      ['lookSomethingUp', false],
      ['answerOneWayOrAnother', 'unresolved'],
    ]);
  });

  /**
   * And it reads the same source when the file on disk ends its lines CRLF.
   *
   * `.gitattributes` normalises to LF on the way into the index, so a working
   * tree that has picked up CRLF — an editor on Windows saving one file — is
   * clean in `git status`, invisible in a diff and invisible in review. On
   * disk it is not invisible at all: every signature pattern here ends in
   * `\{$` or `=>`, a trailing `\r` makes the line unmatchable, and the sweep
   * answers that a command declares *no return type*. It reports no problems
   * and checks nothing, which is the failure these sweeps exist to catch,
   * arriving inside one of them because of a byte nobody can see.
   *
   * So the parser splits on `/\r?\n/` through the shared `linesOf`, and this
   * is the same sample as above with the other ending. `mastery.ts` carried
   * six CRLF lines the day this was written.
   */
  it('reads a signature whose lines end CRLF', () => {
    const smuggled = [
      'export function doSomethingUntracked(',
      '  state: GameState,',
      '): Result<GameEvent[]> {',
      '  return ok([]);',
      '}',
      'export function lookSomethingUp(state: GameState): number {',
      '  return 1;',
      '}',
    ].join('\r\n');
    expect(returnTypesIn(smuggled).map((e) => [e.name, e.returns])).toEqual([
      ['doSomethingUntracked', 'Result<GameEvent[]>'],
      ['lookSomethingUp', 'number'],
    ]);
  });
});

// — and the same claim again, from the other side ——————————————————————————

/**
 * Every source file the engine is made of, keyed by its path under `src/`.
 *
 * `MODULE_SOURCE` above is the command layer and stops there, which is the
 * right population for a sweep about commands. The one below is about a path
 * that *leaves* the command layer — `forcePrintedSave` reaches a die through
 * `rollSavingThrow` in `checks.ts` and `rollD20` in `dice.ts` — so it needs
 * the whole tree, and a directory walk rather than a list for the reason the
 * one above is a directory listing.
 */
const sourcesUnder = (dir: string, prefix = ''): Record<string, string> => {
  const found: Record<string, string> = {};
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      Object.assign(found, sourcesUnder(`${dir}${entry.name}/`, `${prefix}${entry.name}/`));
    } else if (entry.name.endsWith('.ts') && !entry.name.includes('.test.')) {
      found[`${prefix}${entry.name}`] = readFileSync(`${dir}${entry.name}`, 'utf8');
    }
  }
  return found;
};

const ENGINE_SOURCE: Readonly<Record<string, string>> = sourcesUnder(SRC);

/** `commands/actions.ts` + `../checks.js` → `checks.ts`. */
const importedFile = (from: string, specifier: string): string => {
  const parts = from.split('/').slice(0, -1);
  for (const segment of specifier.replace(/\.js$/, '.ts').split('/')) {
    if (segment === '.') continue;
    else if (segment === '..') parts.pop();
    else parts.push(segment);
  }
  return parts.join('/');
};

interface Reached {
  /** Every top-level declaration in the tree, keyed `file#name`. */
  readonly declarations: ReadonlyMap<string, { readonly name: string; readonly exported: boolean }>;
  /** Those that can reach a die, through any number of modules. */
  readonly rolls: ReadonlySet<string>;
  /** Those that can reach a `rolls-issued`, the same way. */
  readonly records: ReadonlySet<string>;
}

/**
 * The engine's call graph, and the two questions asked over it.
 *
 * `reachedFrom` above answers the same shape of question **inside one module**,
 * which is all the two sweeps beside it need: a command spends through a helper
 * in its own file. This one cannot borrow it, because the only thing in the
 * engine that physically turns a generator is `rng.int` in `dice.ts` and every
 * command is three or four modules away from it. So imports are resolved and
 * the closure crosses files.
 *
 * Both seeds are physical facts rather than names anybody has to keep up to
 * date: a declaration draws if its own text calls `rng.int`, and it records if
 * its own text writes `'rolls-issued'`. Everything else is reached.
 */
const reachedInEngine = (sources: Readonly<Record<string, string>>): Reached => {
  const declarations = new Map<string, { name: string; exported: boolean; body: string; file: string }>();
  const declaredIn = new Map<string, ReadonlySet<string>>();
  const importedInto = new Map<string, ReadonlyMap<string, string>>();

  for (const [file, source] of Object.entries(sources)) {
    const functions = functionsIn(source);
    declaredIn.set(file, new Set(functions.map((fn) => fn.name)));
    for (const fn of functions) declarations.set(`${file}#${fn.name}`, { ...fn, file });

    const named = new Map<string, string>();
    // **Stopped at the statement's own closing brace**, and the specifier is
    // filtered below rather than in the pattern. A lazy `[\s\S]*?` looking for
    // the next *relative* specifier reads one `import … from '@ie/srd'`
    // followed by a relative import as a **single** clause and loses every
    // name in the second one — which is how `rollAbilityCheck` stopped
    // reaching a die the day a package import landed above it, with this sweep
    // reporting the loss as `takeHide` rolling nothing.
    for (const line of source.matchAll(/import(?: type)?\s*\{([^}]*)\}\s*from\s*'([^']*)'/g)) {
      const target = importedFile(file, line[2]!);
      if (sources[target] === undefined) continue;
      for (const raw of line[1]!.split(',')) {
        // `type Foo`, `Foo as Bar` — the local name is what a body calls.
        const name = raw.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0]!.trim();
        if (name.length > 0) named.set(name, target);
      }
    }
    importedInto.set(file, named);
  }

  const edges = new Map<string, ReadonlySet<string>>();
  for (const [key, declaration] of declarations) {
    const callees = new Set<string>();
    for (const call of declaration.body.matchAll(/\b([A-Za-z_]\w*)\s*\(/g)) {
      const name = call[1]!;
      if (name === declaration.name) continue;
      const home = declaredIn.get(declaration.file)!.has(name)
        ? declaration.file
        : importedInto.get(declaration.file)!.get(name);
      if (home !== undefined && declarations.has(`${home}#${name}`)) callees.add(`${home}#${name}`);
    }
    edges.set(key, callees);
  }

  const closure = (seeded: (body: string) => boolean): ReadonlySet<string> => {
    const reached = new Set(
      [...declarations].filter(([, entry]) => seeded(entry.body)).map(([key]) => key),
    );
    for (let grew = true; grew; ) {
      grew = false;
      for (const [key, callees] of edges) {
        if (reached.has(key)) continue;
        if ([...callees].some((callee) => reached.has(callee))) {
          reached.add(key);
          grew = true;
        }
      }
    }
    return reached;
  };

  return {
    declarations,
    rolls: closure((body) => /\brng\.int\(/.test(body)),
    records: closure((body) => body.includes("'rolls-issued'")),
  };
};

/**
 * Commands that can reach a die and can reach no `rolls-issued`, on **any**
 * branch, with the reason each is allowed to.
 *
 * The sweep above measures what a command did on the one path the corpus
 * drives it down; this one asks what it *could* do down any path, and the two
 * together are the guard. Neither subsumes the other: this one cannot see a
 * command that records on one branch and forgets on another, and that one
 * cannot see a branch the corpus never reaches.
 */
const ROLLS_WITHOUT_RECORDING: Readonly<Record<string, string>> = {
  'commands/initiative.ts#rollInitiativeFor':
    'the roll and not the record: it hands back a number and emits nothing at all, so there is no batch for a `rolls-issued` to be in. `recordInitiativeRolls` and `rollInitiativeAndBeginCombat` are the two that roll *and* record, and `beginning-a-fight.test.ts` is the guard that a caller keeping a log uses one of them',
};

describe('every command that can reach a die can reach the event that records it', () => {
  const { declarations, rolls, records } = reachedInEngine(ENGINE_SOURCE);

  const commands = [...declarations]
    .filter(([, entry]) => entry.exported && COMMAND_SURFACE.has(entry.name))
    .map(([key]) => key);

  const unrecording = commands.filter((key) => rolls.has(key) && !records.has(key)).sort();

  /**
   * The whole point: a command that can reach a die and, down every path it
   * has, reaches nothing that writes the event recording one. That is the
   * shape a rolling command arrives in when nobody has thought about the
   * generator at all, and nothing in the repository asked the question until
   * now.
   */
  it('leaves no rolling command that records nowhere, but the ones named', () => {
    expect(unrecording).toEqual(Object.keys(ROLLS_WITHOUT_RECORDING).sort());
    expect(Object.values(ROLLS_WITHOUT_RECORDING).every((why) => why.length > 20)).toBe(true);
  });

  /**
   * And the exemption's reason is checked rather than taken on its word: it is
   * excused because it hands the caller no events, so the day it starts
   * handing back a batch it needs a `rolls-issued` in it like everything else.
   */
  it('and each exemption really does hand back no events at all', () => {
    for (const key of Object.keys(ROLLS_WITHOUT_RECORDING)) {
      const [file, name] = key.split('#') as [string, string];
      const signature = returnTypesIn(ENGINE_SOURCE[file]!).find((entry) => entry.name === name);
      expect(signature, key).toBeDefined();
      expect(carriesEvents(signature!.returns), key).toBe(false);
    }
  });

  /**
   * And the graph really did cross a module boundary, which is the whole
   * reason it exists: nothing under `commands/` calls `rng.int` itself.
   */
  it('found the commands that reach a die, three modules away', () => {
    const rolling = commands.filter((key) => rolls.has(key));
    expect(rolling.length).toBeGreaterThan(25);
    for (const name of ['resolveAttack', 'forcePrintedSave', 'takeHide', 'endRest']) {
      expect(rolling.some((key) => key.endsWith(`#${name}`)), name).toBe(true);
    }
    // And a command that reads content and rolls nothing is not on it.
    for (const name of ['equipItem', 'declareLight', 'takeDodge']) {
      expect(rolling.some((key) => key.endsWith(`#${name}`)), name).toBe(false);
    }
    // No module under `commands/` names the generator's own method, so every
    // one of those was reached across files.
    expect(
      Object.keys(ENGINE_SOURCE).filter(
        (file) => file.startsWith('commands/') && /\brng\.int\(/.test(ENGINE_SOURCE[file]!),
      ),
    ).toEqual([]);
  });

  /**
   * **And this one would not have caught `forcePrintedSave`**, measured
   * against the live source rather than assumed either way.
   *
   * `commands/actions.ts` is handed to the analysis with its `'rolls-issued'`
   * taken back out, which is the file as it shipped. The command still counts
   * as recording, because it calls `forcePrintedSaveOn` in
   * `commands/printed-save-clauses.ts` — the body it shares with the save a
   * moment forces — which calls `dealSpellDamage` in `commands/damage.ts`,
   * which calls `resolveDamage` in `commands/casting.ts`, which emits one —
   * for its own dice, on a branch this command does not take. Reachability is
   * an over-approximation on the recording side and there is no honest way to
   * narrow it: restricting the closure to the command's own module puts eight
   * more commands on the list, every one of them correct and every one of them
   * needing a written excuse, which is the hand-maintained allow-list this
   * guard was built to avoid.
   *
   * So the net above is the coarse one — a rolling command that can reach no
   * `rolls-issued` **at all** — and the measured sweep is the one that catches
   * a command that rolls and forgets. Each says what the other cannot: this
   * one reads every branch of every command and is blunt; that one is exact
   * and reads one branch. Believing either is the whole guard is how a third
   * `forcePrintedSave` ships.
   */
  it('cannot see a command that records on one branch and forgets on another', () => {
    const asItShipped = {
      ...ENGINE_SOURCE,
      'commands/actions.ts': ENGINE_SOURCE['commands/actions.ts']!.replaceAll(
        "type: 'rolls-issued'",
        "type: 'nothing-at-all'",
      ),
    };
    const shipped = reachedInEngine(asItShipped);
    expect(shipped.rolls.has('commands/actions.ts#forcePrintedSave')).toBe(true);
    // The bound, stated as an assertion so that a change which *does* narrow
    // it fails here and gets this comment rewritten rather than left lying.
    expect(shipped.records.has('commands/actions.ts#forcePrintedSave')).toBe(true);

    // And the path is the one named above, rather than some other one.
    expect(ENGINE_SOURCE['commands/actions.ts']!).toMatch(/\bforcePrintedSaveOn\(/);
    expect(ENGINE_SOURCE['commands/printed-save-clauses.ts']!).toMatch(/\bdealSpellDamage\(/);
    expect(ENGINE_SOURCE['commands/damage.ts']!).toMatch(/\bresolveDamage\(/);
    expect(ENGINE_SOURCE['commands/casting.ts']!).toContain("type: 'rolls-issued'");

    // The measured sweep, which does catch it, is the one above; this is the
    // claim that the corpus really runs this command down a rolling branch.
    expect(GUARDED.some((entry) => entry.name === 'forcePrintedSave')).toBe(true);
  });

  /**
   * What the coarse net does catch: a rolling command in a module with no
   * `rolls-issued` in it and no call into one — the shape a new command in a
   * new module arrives in, and the one `takeHide` would have had if
   * `commands/actions.ts` had never emitted one.
   */
  it('would catch a rolling command that reaches no rolls-issued at all', () => {
    const stripped = Object.fromEntries(
      Object.entries(ENGINE_SOURCE).map(([file, source]) => [
        file,
        source.replaceAll("type: 'rolls-issued'", "type: 'nothing-at-all'"),
      ]),
    );
    const blind = reachedInEngine(stripped);
    const missed = [...blind.declarations]
      .filter(
        ([key, entry]) =>
          entry.exported && COMMAND_SURFACE.has(entry.name) && blind.rolls.has(key) && !blind.records.has(key),
      )
      .map(([key]) => key);
    expect(missed).toContain('commands/actions.ts#forcePrintedSave');
    expect(missed).toContain('commands/actions.ts#takeHide');
    expect(missed.length).toBeGreaterThan(25);
  });

  /**
   * And the analysis is not vacuous on a tree it has never seen: shown two
   * commands that reach a die through an imported helper, one of which records
   * and one of which does not, it tells them apart — and leaves alone the one
   * that never rolls.
   */
  it('tells a roller from a recorder from neither, across modules', () => {
    const synthetic = {
      'dice.ts': ['export function rollD20(rng: Rng): number {', '  return rng.int(20);', '}'].join(
        '\n',
      ),
      'commands/chance.ts': [
        "import { rollD20 } from '../dice.js';",
        'export function takeAChance(state: GameState, supply: Supply) {',
        '  const face = rollD20(supply.rng);',
        "  return ok([{ type: 'roll-recorded', total: face }]);",
        '}',
        'export function takeAChanceAndSaySo(state: GameState, supply: Supply) {',
        '  const face = rollD20(supply.rng);',
        "  return ok([{ type: 'rolls-issued', count: 1, rng: supply.rng.snapshot() }]);",
        '}',
        'export function lookSomethingUp(state: GameState) {',
        '  return 1;',
        '}',
      ].join('\n'),
    };
    const { rolls: rolled, records: recorded } = reachedInEngine(synthetic);
    expect([...rolled].sort()).toEqual([
      'commands/chance.ts#takeAChance',
      'commands/chance.ts#takeAChanceAndSaySo',
      'dice.ts#rollD20',
    ]);
    expect([...recorded]).toEqual(['commands/chance.ts#takeAChanceAndSaySo']);
  });
});

describe('unknown is not no', () => {
  /**
   * SRD play is full of things the engine has never been told about. The
   * chandelier rope exists because the DM said so, not because anybody added a
   * row for it — and **absence from structured state is not evidence that a
   * thing does not exist**. So a command aimed at a creature with no record
   * must come back as homework, not as a verdict.
   */
  const thin: readonly { readonly name: string; readonly run: () => Result<unknown> }[] = [
    {
      name: 'attacking something nobody has declared',
      run: () => resolveAttack(fold('s', SETUP), A, { target: id('chandelier-rope'), weapon: 'longsword' }, supply()),
    },
    {
      name: 'damaging something nobody has declared',
      run: () => damageCreature(fold('s', SETUP), id('the-door'), { amount: 9, source: 'an axe' }),
    },
    {
      name: 'healing something nobody has declared',
      run: () => healCreature(fold('s', SETUP), id('the-squire'), 5),
    },
    {
      // A Reaction that answers "a creature within 5 feet" needs both
      // creatures to be standing somewhere. Nobody has placed either, and
      // where a creature is standing has no right answer until somebody says.
      name: 'answering damage from somebody nobody has placed',
      run: () => {
        const unplaced: readonly GameEvent[] = stung().filter(
          (e) => !(e.type === 'creature-placed'),
        );
        return takeDamageResponse(
          fold('s', unplaced),
          A,
          { feature: 'test:riposte', weapon: 'mace' },
          supply(),
        );
      },
    },
    {
      // Attuning names a creature, an item and a rest. Two of the three are
      // established here and the creature is not, which is a thin record
      // rather than a broken rule — `addCreature` is what would settle it.
      name: 'attuning for somebody nobody has added',
      run: () => attuneItem(fold('s', SETUP), SRD_CONTENT, id('the-porter'), 'cloak-of-elvenkind'),
    },
    {
      // And the other end of the pair, which is the same claim about a
      // creature rather than about an attunement: `not_attuned` would be a
      // verdict on a record that does not exist.
      name: 'ending an attunement for somebody nobody has added',
      run: () =>
        endAttunement(fold('s', SETUP), SRD_CONTENT, id('the-porter'), 'cloak-of-elvenkind'),
    },
    {
      // Spending a wand's charge names a creature and an item. The item is in
      // the catalogue and the creature is not in the record, which is a thin
      // record rather than a broken rule.
      name: 'spending a charge for somebody nobody has added',
      run: () =>
        expendCharges(fold('s', SETUP), SRD_CONTENT, id('the-porter'), 'wand-of-secrets'),
    },
    {
      // And lifting one from them. Saying a creature is no longer Frightened
      // is a claim that it exists; the record being thin is not a rule.
      name: 'lifting a condition from somebody nobody has declared',
      run: () => liftConditionFrom(fold('s', SETUP), id('the-ostler'), 'frightened'),
    },
    {
      name: 'rolling a test for somebody nobody has declared',
      run: () =>
        resolveTest(
          fold('s', SETUP),
          id('the-porter'),
          { kind: 'saving-throw', ability: 'dex', dc: 12 },
          supply(),
        ),
    },
    {
      // A fight the DM says is starting, with somebody in it the engine has
      // never been told about. The bandits exist because the DM said so, and
      // `addCreature` is what settles it — refusing the whole fight would be a
      // verdict on a thin record.
      name: 'starting a fight with somebody nobody has added in it',
      run: () =>
        rollInitiativeAndBeginCombat(
          fold('s', SETUP),
          [
            { id: A, speed: 30 },
            { id: id('the-second-bandit'), speed: 30 },
          ],
          supply(),
        ),
    },
    {
      name: 'rolling Initiative for somebody nobody has added',
      run: () =>
        recordInitiativeRolls(fold('s', SETUP), [{ id: id('the-porter'), speed: 30 }], supply()),
    },
    {
      name: 'moving a creature nobody has placed',
      run: () => {
        // B never got a position. Nothing about that says B is not standing
        // somewhere — only that nobody has said where.
        const unplaced: readonly GameEvent[] = SETUP.filter(
          (e) => !(e.type === 'creature-placed' && e.id === B),
        );
        return resolveMove(
          fold('s', unplaced),
          B,
          { placement: { from: { landmark: 'here' }, feet: 10 } },
          supply(),
        );
      },
    },
    {
      /**
       * **A move measured from a door nobody has described.**
       *
       * The case the landmark half of `anchorNeeded` exists for, and the one
       * that made the doctrine defect visible: `resolveAnchor` answered `err`
       * — "there is no X in this scene" — which reads to everything above as
       * *that does not exist*, so the narrator describes a door, somebody
       * reaches for it, and the engine denies the door. It is homework now,
       * and this entry is what stops it quietly becoming a bare one: the
       * second assertion below reads the request rather than the code, and
       * `resolveMove` forwarded `moveCreature`'s refusal unadorned until this
       * was written.
       */
      name: 'moving to a landmark nobody has named',
      run: () =>
        resolveMove(
          fold('s', SETUP),
          A,
          { placement: { from: { landmark: 'the door' }, feet: 10 } },
          supply(),
        ),
    },
    {
      // A fight the DM says is over, with somebody standing in it that nobody
      // has put on a side. `side` is declared, exactly as sight and cover are:
      // `null` is "nobody has said", not "neutral", so a fight holding one
      // cannot be *known* to be over and either answer would be the engine
      // settling the fact rather than asking for it. `declareCreatureSide`
      // settles it — and this entry is why that request has a shape rather
      // than a sentence, because the assertion below reads the shape.
      name: 'ending a fight with somebody on nobody’s side',
      run: () => {
        const unsided: readonly GameEvent[] = [
          ...SETUP.filter((event) => event.type !== 'combat-started'),
          {
            type: 'creature-added',
            id: C,
            name: C,
            sheet: sheet(),
            maxHp: 60,
            diesAtZero: false,
            creatureType: 'Humanoid',
          },
          {
            type: 'combat-started',
            combatants: [
              { id: A, initiative: 20, speed: 30 },
              { id: C, initiative: 10, speed: 30 },
            ],
          },
        ];
        return endCombat(fold('s', unsided), { kind: 'defeated' });
      },
    },
  ];

  for (const entry of thin) {
    it(`${entry.name} asks rather than refuses`, () => {
      const out = entry.run();
      expect(isErr(out)).toBe(true);
      // Through the predicate a tool surface will actually branch on, rather
      // than by reading the field — the point is that this is answerable
      // without matching a growing vocabulary of error codes.
      expect(isNeedsContext(out)).toBe(true);
    });

    /**
     * And it says *what* is missing. A `needs-context` with no request is
     * "go and find out" with the "what" left in a prose string, and the layer
     * above is back to matching error codes — the thing the predicate above
     * exists to make unnecessary. The four-step contract in docs/IMPOSSIBILITY_ENGINE_DOCTRINE.md is
     * identify the fact, say why, say how; a bare code is none of them.
     */
    it(`${entry.name} names the fact it is missing`, () => {
      const out = entry.run();
      const requests = contextRequestsOf(out);
      expect(requests.length).toBeGreaterThan(0);
      for (const request of requests) {
        expect(request.subject.length).toBeGreaterThan(0);
        expect(request.satisfyWith.length).toBeGreaterThan(0);
      }
    });
  }

  /**
   * And the other half, or the distinction buys nothing: a rule that has
   * actually been broken under established facts stays a refusal. Nobody
   * should be able to fix these by declaring another fact.
   */
  const refusals: readonly { readonly name: string; readonly run: () => Result<unknown> }[] = [
    {
      name: 'swinging a weapon you do not own',
      run: () => resolveAttack(fold('s', SETUP), B, { target: A, weapon: 'longsword' }, supply()),
    },
    {
      name: 'casting from a slot level you have none of',
      run: () => resolveCast(fold('s', SETUP), A, { spell: 'Inflict Wounds', level: 1, slotLevel: 9 }),
    },
    {
      name: 'acting on somebody else’s turn',
      run: () => takeDash(fold('s', SETUP), B, {}),
    },
  ];

  for (const entry of refusals) {
    it(`${entry.name} is a refusal`, () => {
      const out = entry.run();
      expect(isErr(out)).toBe(true);
      expect(isNeedsContext(out)).toBe(false);
      if (isErr(out)) expect(out.kind).toBe('refusal');
    });
  }
});

/**
 * Every `satisfyWith` in the command layer, as the source writes it.
 *
 * `CLAUDE.md` states the rule — "a request names the command that satisfies
 * it, and every command-level request has one" — and until IE-012 built the
 * eight scene commands and IE-016 the nine declarations, several requests had
 * no command to name and said "a scene-set event" instead. That is the one
 * instruction the layer above the engine must never be given: a tool surface
 * calls commands and never appends events, because appending one is the model
 * asserting a mechanical fact directly.
 *
 * So the check is not that the prose is tidy. It is that the only thing a
 * request can tell a caller to do is something the caller can actually do, and
 * the vocabulary of what a caller can do is `commands.ts`'s barrel — the list
 * every other sweep here reads, for the same reason: a helper `export`ed so a
 * sibling may call it is not a command.
 */
const satisfyWithIn = (source: string): readonly string[] =>
  [...source.matchAll(/satisfyWith: (?:'((?:[^'\\]|\\.)*)'|`((?:[^`\\]|\\.)*)`)/g)].map(
    (match) => match[1] ?? match[2]!,
  );

/**
 * Which of those name nothing a caller could send.
 *
 * Two different things catch the two kinds of wrong answer, and conflating
 * them is how a guard comes to be credited with work it is not doing.
 *
 * **A name the barrel does not publish is caught by the lookup**, whatever the
 * match. The question asked is directional: does this request's **text**
 * contain a published command name? `'placeCreature'` — the pure function in
 * `positioning.ts`, which one request named before IE-026 — fails because that
 * text contains no published name, `placeCreatureInScene` being the only one
 * in its family. The containment running the other way is real and irrelevant:
 * `placeCreatureInScene` *does* contain `placeCreature`, and nothing here ever
 * asks that, because `placeCreature` is not a command to be looked for.
 *
 * **The word boundary catches the other kind**: a longer identifier that
 * merely *contains* a command's name is not that command. That collision is
 * live — `equipItem` sits inside `unequipItem`, `resolveAttack` inside
 * `resolveAttackDamage`, `endFeature` inside `extendFeature` — so containment
 * would accept `'an unequipItem command'` on the strength of `equipItem`. The
 * two cases below pin one each, and the second measures the nesting off the
 * barrel rather than asserting it.
 */
const namesNoCommand = (
  sources: Readonly<Record<string, string>>,
  commands: Iterable<string>,
): readonly string[] => {
  const named = [...commands];
  return Object.values(sources)
    .flatMap((source) => satisfyWithIn(source))
    .filter((text) => !named.some((name) => new RegExp(`\\b${name}\\b`).test(text)))
    .sort();
};

describe('every context request names the command that satisfies it', () => {
  const REQUESTING_MODULES: Readonly<Record<string, string>> = Object.fromEntries(
    COMMAND_MODULES.map((file) => [file, MODULE_SOURCE[file]!]),
  );

  /**
   * **There is no longer any exception**, and the empty list is the point.
   *
   * One request named an event rather than a command — `unknownCreature`'s "a
   * creature-added event for …" — under a written exemption saying that "a
   * barrel command that adds a creature is what would end this exemption".
   * `addCreature` is that command, so the entry was deleted rather than
   * reworded: a guard whose exemption list empties is the one that was worth
   * writing, which is the second time that has happened here (`dash`'s
   * single-reader exemption was the first).
   */
  const NAMES_AN_EVENT_ON_PURPOSE: Readonly<Record<string, string>> = {};

  /**
   * Not vacuous. An extractor that matched nothing would report no problems
   * and check nothing — what `animals.md` taught every parser here, and what
   * every sweep in this file asserts about its own population first.
   */
  it('read every satisfyWith in the command layer', () => {
    const all = Object.values(REQUESTING_MODULES).flatMap((source) => satisfyWithIn(source));
    // Held against the number of `satisfyWith:` sites in the same sources
    // rather than a threshold. The extractor only sees a quoted or backticked
    // literal, so a request assembled from a helper or a variable would be
    // invisible to it — and a `> 20` guard against twenty-eight sites would
    // not notice one going that way. This fails on the day one does, which is
    // the difference between a guard and a number somebody has to maintain.
    const sites = Object.values(REQUESTING_MODULES).reduce(
      (n, source) => n + [...source.matchAll(/satisfyWith:/g)].length,
      0,
    );
    expect(all.length).toBe(sites);
    expect(all.length).toBeGreaterThan(20);
    expect(all).toContain('a setScene command');
    // The template-literal form, which the single-quoted one would not reach.
    // Read as the *source* writes it, escapes and all — a `via` in backticks
    // is `\`via\`` on disk, and pretending otherwise would be this assertion
    // quietly testing a string the extractor never produces.
    expect(all.some((text) => text.startsWith('activateSpell again with'))).toBe(true);
    expect(all.some((text) => text.includes('\\`via\\`'))).toBe(true);
  });

  /**
   * The whole point. Every request tells a caller to send something the caller
   * can send, and the one that cannot is named with its reason.
   *
   * `toEqual` reads both directions: an exemption that stops being needed
   * fails here rather than sitting on as a licence nobody re-reads.
   */
  it('leaves no request naming an event for a fact that has a command', () => {
    expect(namesNoCommand(REQUESTING_MODULES, PUBLIC_COMMANDS)).toEqual(
      Object.keys(NAMES_AN_EVENT_ON_PURPOSE).sort(),
    );
    expect(Object.values(NAMES_AN_EVENT_ON_PURPOSE).every((why) => why.length > 20)).toBe(true);
  });

  /**
   * And the analysis is not vacuous the other way either: shown the exact
   * string this task removed, it says so.
   *
   * Synthetic on both sides, like the action-economy sweep's smuggled spender
   * and the event sweep's fictional type, because a sweep proved only against
   * the repository it runs on is one that can quietly stop seeing anything.
   */
  it('would catch a request that names an event', () => {
    const sources = { 'a-module.ts': "satisfyWith: 'a scene-set event'," };
    expect(namesNoCommand(sources, ['setScene'])).toEqual(['a scene-set event']);
  });

  it('and accepts the command that replaced it', () => {
    const sources = { 'a-module.ts': "satisfyWith: 'a setScene command'," };
    expect(namesNoCommand(sources, ['setScene'])).toEqual([]);
  });

  /**
   * The trap the brief named: `placeCreature` is the pure function in
   * `positioning.ts` and `placeCreatureInScene` is the command, and one
   * request named the first. It is caught because the barrel publishes no
   * `placeCreature` **at all** — not because of the word boundary, which does
   * nothing here: `placeCreature` is never looked for, so no needle is nested
   * in either fixture. Saying otherwise would be this test claiming a guard it
   * is not applying.
   */
  it('does not accept the pure function in place of the command', () => {
    const commands = ['placeCreatureInScene'];
    expect(namesNoCommand({ 'm.ts': "satisfyWith: 'placeCreature'," }, commands)).toEqual([
      'placeCreature',
    ]);
    expect(
      namesNoCommand(
        { 'm.ts': 'satisfyWith: `a placeCreatureInScene command for ${id}`,' },
        commands,
      ),
    ).toEqual([]);
  });

  /**
   * **What the word boundary is actually for**, with a fixture only it
   * rejects: a longer identifier that merely *contains* a command's name is
   * not that command, and containment would accept it.
   *
   * The collision is live rather than hypothetical — three barrel names are
   * strict substrings of other barrel names, which the first assertion
   * measures rather than assumes, so the fixture cannot quietly stop being a
   * real case. `equipItem` inside `unequipItem` is the pair used here, and
   * under containment a request naming the one would pass on the other.
   */
  it('does not accept a longer name that merely contains a command', () => {
    const nested = PUBLIC_COMMANDS.filter((a) =>
      PUBLIC_COMMANDS.some((b) => b !== a && b.includes(a)),
    );
    expect(nested).toContain('equipItem');
    expect(PUBLIC_COMMANDS).toContain('unequipItem');

    // Only the boundary rejects this: `'an unequipItem command'.includes('equipItem')`.
    expect(namesNoCommand({ 'm.ts': "satisfyWith: 'an unequipItem command'," }, ['equipItem']))
      .toEqual(['an unequipItem command']);
    expect('an unequipItem command'.includes('equipItem')).toBe(true);
    // And the command it really names is accepted.
    expect(
      namesNoCommand({ 'm.ts': "satisfyWith: 'an unequipItem command'," }, ['unequipItem']),
    ).toEqual([]);
  });

  /**
   * **`route` passes on the rule, not on an exception.** It is the odd kind —
   * satisfied by re-sending the same command with a field filled in rather
   * than by declaring a fact through a command of its own — and it still names
   * that command, so the ordinary check accepts it. A special case for it
   * would be a hole shaped like an exemption: anything at all could then be
   * written in a `route` request and nothing would notice, which is what the
   * second half here pins.
   */
  it('accepts a route request because it names a command, not because it is a route', () => {
    const commands = ['resolveMove', 'activateSpell'];
    expect(PUBLIC_COMMANDS).toContain('resolveMove');
    expect(PUBLIC_COMMANDS).toContain('activateSpell');
    expect(
      namesNoCommand(
        { 'm.ts': 'satisfyWith: `resolveMove again as ${n} moves of one space each`,' },
        commands,
      ),
    ).toEqual([]);
    expect(
      namesNoCommand({ 'm.ts': "satisfyWith: 'send it again with `via` filled in'," }, commands),
    ).toEqual(['send it again with `via` filled in']);
  });

  /**
   * And the exemption that stood here is gone, which is the other half of the
   * rule an exemption is written under.
   *
   * It said, in its own words, that "a barrel command that adds a creature is
   * what would end this exemption". `addCreature` is that command, so the
   * entry was **deleted rather than reworded** and `unknownCreature` names it.
   * The assertion inverts what the exemption used to check: the command layer
   * emits `creature-added` now, and the barrel publishes the command a request
   * can point a caller at.
   */
  it('and the command that ended the exemption really exists', () => {
    expect(emittedNowhere(['creature-added'], REQUESTING_MODULES)).toEqual([]);
    expect(PUBLIC_COMMANDS).toContain('addCreature');
    // `createCharacter` is still not a command, which is why the request names
    // the one that is.
    expect(PUBLIC_COMMANDS).not.toContain('createCharacter');
  });
});

describe('a move with no scene is homework, not a verdict', () => {
  /**
   * `resolveMove` answered `no_scene` with a **bare** `needsContext` carrying
   * no request, because it predates there being a command that could fix it —
   * `sceneFor`'s own comment said so in those words. `commands/scene.ts`
   * supplies the provider now, so the gap was a leftover rather than a
   * decision: the code stays `no_scene`, and what changes is that the caller
   * is told what to send.
   */
  const NO_SCENE: readonly GameEvent[] = SETUP.filter(
    (e) =>
      e.type !== 'scene-set' &&
      e.type !== 'landmark-added' &&
      e.type !== 'creature-placed' &&
      e.type !== 'sight-declared',
  );

  const move = (dice = supply()) =>
    resolveMove(
      fold('s', NO_SCENE),
      A,
      { placement: { from: { landmark: 'here' }, feet: 10 } },
      dice,
    );

  it('asks rather than refuses, and says which fact', () => {
    const out = move();
    expect(isErr(out) ? out.code : 'ok').toBe('no_scene');
    expect(isNeedsContext(out)).toBe(true);
    const requests = contextRequestsOf(out);
    expect(requests.map((r) => r.kind)).toEqual(['scene']);
    expect(requests[0]?.subject).toBe(A);
  });

  /** And it names the command, which is the whole of what was missing. */
  it('names a setScene command', () => {
    expect(contextRequestsOf(move())[0]?.satisfyWith).toMatch(/setScene command/);
  });

  /**
   * Asking costs nothing — the same guarantee every other thin record has.
   *
   * The **generator** is what this can actually assert, and it is the half
   * that is easy to miss: it is the caller's own object, so a refusal that
   * already rolled has moved it. Re-folding the log and comparing would be
   * decoration — `fold` is a pure function of the same events either side, so
   * it cannot come out differently whatever the command did — and an assertion
   * that cannot fail is worse than none, because it reads as cover.
   */
  it('costs nothing to ask — no dice, and no events to apply', () => {
    const dice = supply();
    const before = { rng: dice.rng.snapshot(), rolls: dice.issuer.count };
    const out = move(dice);
    expect(isNeedsContext(out)).toBe(true);
    expect(dice.rng.snapshot()).toEqual(before.rng);
    expect(dice.issuer.count).toBe(before.rolls);
    // And a refusal is not a batch: there is nothing to apply.
    expect(contextRequestsOf(out).length).toBeGreaterThan(0);
    expect('value' in out).toBe(false);
  });
});

describe('a refused command leaves nothing behind', () => {
  /**
   * "Validate before rolling" as a behavioural guarantee rather than a
   * discipline: whatever a refusal touched, it did not touch the world. The
   * generator is the part that is easy to miss, because it is the caller's
   * object and a refusal that already rolled has moved it.
   */
  const refusals: readonly {
    readonly name: string;
    readonly run: (dice: ReturnType<typeof supply>) => Result<unknown>;
    /** The log the refusal is measured against, when it is not `SETUP`. */
    readonly log?: readonly GameEvent[];
    /** Charges that must still be there afterwards, for the item refusals. */
    readonly charges?: number;
  }[] = [
    {
      name: 'an attack with a weapon that is not owned',
      run: (dice) => resolveAttack(fold('s', SETUP), B, { target: A, weapon: 'longsword' }, dice),
    },
    /**
     * **The charge survives every refusal**, which is the whole reason a
     * casting from an item is one command rather than `expendCharges`
     * followed by a cast: two commands are two ids, and the first would land
     * while the second refused.
     *
     * Two of them, because they are refused in two different places. The
     * range is refused by the resolution, after the route was built and
     * before anything was spent; the attunement is refused by the route
     * itself, before the resolution has looked at a target at all.
     */
    {
      name: 'a wand cast with nobody in range',
      log: FIREBALL_WAND,
      charges: 7,
      run: (dice) =>
        resolveSpell(
          fold('s', FIREBALL_WAND),
          A,
          {
            spellId: 'fireball',
            targets: [],
            at: { x: 10_000, y: 10_000, z: 0 },
            item: 'wand-of-fireballs',
            charges: 2,
          },
          dice,
        ),
    },
    {
      name: 'a wand cast in an unattuned hand',
      log: UNATTUNED_WAND,
      charges: 7,
      run: (dice) =>
        resolveSpell(
          fold('s', UNATTUNED_WAND),
          A,
          {
            spellId: 'fireball',
            targets: [],
            at: { x: 100, y: 105, z: 0 },
            item: 'wand-of-fireballs',
          },
          dice,
        ),
    },
    {
      name: 'a cast with no slot of that level',
      run: () => resolveCast(fold('s', SETUP), A, { spell: 'Inflict Wounds', level: 1, slotLevel: 9 }),
    },
    {
      name: 'a move further than the mover’s Speed',
      run: (dice) =>
        resolveMove(fold('s', SETUP), A, { placement: { from: { creature: B }, feet: 100, bearing: 180 } }, dice),
    },
  ];

  for (const entry of refusals) {
    it(`${entry.name} spends no state and no dice`, () => {
      const log = entry.log ?? SETUP;
      const dice = supply();
      const before = { state: fold('s', log), rng: dice.rng.snapshot(), rolls: dice.issuer.count };

      const out = entry.run(dice);
      expect(isErr(out)).toBe(true);

      expect(fold('s', log)).toEqual(before.state);
      expect(dice.rng.snapshot()).toEqual(before.rng);
      expect(dice.issuer.count).toBe(before.rolls);
      // And, where the refusal was a casting from an item: the charges too.
      // The state comparison above already covers them, and naming the number
      // is what makes the claim legible in the failure rather than buried in a
      // deep-equal of the whole world.
      if (entry.charges !== undefined) expect(wandCharges(log)).toBe(entry.charges);
    });
  }
});

describe('one channel for a missing fact', () => {
  /**
   * `resolveSpell` used to answer the three-state question inside its `ok`
   * value — a *success* carrying homework — while the other forty-seven
   * commands answered it with an error. The idea was right and the route was
   * wrong: a caller had to know which of two shapes this one command used, and
   * no amount of documentation makes a model's tool surface remember that.
   *
   * The property that made the original design right is what these pin: a
   * missing fact is not a verdict, it costs nothing, and the same command
   * repeated once the fact is established is the command the caller meant.
   */
  // B is in the game and nobody has said what kind of creature it is. That is
  // an ordinary state, not a broken one.
  const untyped: readonly GameEvent[] = SETUP.map((e) =>
    e.type === 'creature-added' && e.id === B
      ? ({
          type: 'creature-added',
          id: e.id,
          name: e.name,
          sheet: e.sheet,
          maxHp: e.maxHp,
          diesAtZero: e.diesAtZero ?? false,
          side: e.side,
        } as GameEvent)
      : e,
  );

  const withSlot: readonly GameEvent[] = [
    ...untyped,
    {
      type: 'resource-pool-declared',
      id: A,
      pool: { key: spellSlotKey(2), label: 'level 2 spell slot', max: 2, recovers: 'long-rest' },
    },
    {
      type: 'spellcasting-declared',
      id: A,
      spellcasting: declaredCasting({ ability: 'int', prepared: ['hold-person'] }),
    },
  ];

  const cast = (log: readonly GameEvent[], dice = supply()) =>
    resolveSpell(fold('s', log), A, { spellId: 'hold-person', targets: [B], slotLevel: 2 }, dice);

  it('a spell missing a fact refuses in the same shape every other command uses', () => {
    const out = cast(withSlot);
    expect(isErr(out)).toBe(true);
    expect(isNeedsContext(out)).toBe(true);
  });

  /** And it still says exactly what to establish, which was the point of it. */
  it('names the fact and the event that would settle it', () => {
    const requests = contextRequestsOf(cast(withSlot));
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.map((r) => r.kind)).toContain('creature-type');
    expect(requests[0]?.satisfyWith.length).toBeGreaterThan(0);
  });

  it('costs nothing to ask — no slot, no dice, no state', () => {
    const dice = supply();
    const before = { state: fold('s', withSlot), rng: dice.rng.snapshot(), rolls: dice.issuer.count };

    expect(isNeedsContext(cast(withSlot, dice))).toBe(true);

    expect(fold('s', withSlot)).toEqual(before.state);
    expect(dice.rng.snapshot()).toEqual(before.rng);
    expect(dice.issuer.count).toBe(before.rolls);
    expect(remaining(fold('s', withSlot).creatures.b!.resources, spellSlotKey(2))).toBe(0);
  });

  /**
   * And no charge either, for the casting whose price is an item's.
   *
   * The same claim as the slot above, made about the other thing a casting
   * can spend: a wand aimed at a creature nobody has typed asks for the fact
   * and leaves the wand exactly as full as it found it. This is the property
   * that a two-command implementation — `expendCharges`, then cast — could
   * not have: the first would land and the second would ask.
   */
  it('costs no charge to ask either', () => {
    // The Cape of the Mountebank casts Dimension Door once a day and needs no
    // attunement, and SRD Dimension Door teleports "to a location within
    // range" — so a destination measured from a creature nobody has placed is
    // a thin record rather than an illegal casting, and the engine asks.
    const wearing = held(SETUP, 'cape-of-the-mountebank');

    const dice = supply();
    const before = {
      state: fold('s', wearing),
      rng: dice.rng.snapshot(),
      rolls: dice.issuer.count,
    };
    const full = chargesLeft(before.state, SRD_CONTENT, A, 'cape-of-the-mountebank');
    expect(full).toBe(1);

    const asked = resolveSpell(
      before.state,
      A,
      {
        spellId: 'dimension-door',
        targets: [A],
        item: 'cape-of-the-mountebank',
        teleportTo: { from: { creature: C }, feet: 0 },
      },
      dice,
    );

    expect(isNeedsContext(asked)).toBe(true);
    expect(contextRequestsOf(asked).length).toBeGreaterThan(0);
    expect(fold('s', wearing)).toEqual(before.state);
    expect(dice.rng.snapshot()).toEqual(before.rng);
    expect(dice.issuer.count).toBe(before.rolls);
    expect(chargesLeft(fold('s', wearing), SRD_CONTENT, A, 'cape-of-the-mountebank')).toBe(full);
  });

  /**
   * Establishing the fact adds a fact. It does not restate the world, and the
   * cast that follows is the one the caller asked for the first time.
   */
  it('goes through once the fact is established', () => {
    const answered: readonly GameEvent[] = [
      ...withSlot,
      { type: 'creature-type-declared', id: B, creatureType: 'Humanoid' },
    ];
    const out = cast(answered);
    expect(isErr(out) ? `${out.code}: ${out.reason}` : 'ok').toBe('ok');
  });

  /** A rules refusal still carries no requests: there is nothing to go and get. */
  it('offers nothing to establish when the rules simply say no', () => {
    const typed: readonly GameEvent[] = [
      ...withSlot,
      { type: 'creature-type-declared', id: B, creatureType: 'Humanoid' },
    ];
    const out = resolveSpell(
      fold('s', typed),
      A,
      { spellId: 'hold-person', targets: [B], slotLevel: 9 },
      supply(),
    );
    expect(isErr(out)).toBe(true);
    expect(isNeedsContext(out)).toBe(false);
    expect(contextRequestsOf(out)).toEqual([]);
  });

});

describe('a campaign cannot wedge', () => {
  /**
   * `pendingAttack` and `pendingMove` are debts, and the engine refuses to
   * advance the turn while one stands. That is the right rule and it becomes a
   * **stuck campaign** the moment the creature who owes the debt leaves the
   * game: every command that could settle it is addressed to them.
   *
   * The most ordinary way to reach it is not exotic at all — a mover provokes,
   * the Opportunity Attack kills them, the body is cleared off the board.
   */
  const heldAttack = (): readonly GameEvent[] => {
    // A bonus large enough to settle the roll outright, so the test is about
    // what a held hit does rather than about which way a die fell.
    const held = unwrap(
      resolveAttack(
        fold('s', SETUP),
        A,
        { target: B, weapon: 'longsword', hold: true, attackBonuses: [{ source: 'staged', flat: 40 }] },
        supply('hit'),
      ),
      'attack',
    );
    return [...SETUP, ...held.events];
  };

  const declaredMove = (): readonly GameEvent[] => {
    const moved = unwrap(
      resolveMove(fold('s', SETUP), A, { placement: { from: { creature: B }, feet: 25, bearing: 180 } }, supply()),
      'move',
    );
    return [...SETUP, ...moved.events];
  };

  it('a held attack does not outlive the attacker', () => {
    const log = heldAttack();
    expect(pendingAttackOf(fold('s', log))).not.toBeNull();

    const gone = [...log, ...unwrap(removeCreatureEverywhere(fold('s', log), A), 'remove')];
    expect(pendingAttackOf(fold('s', gone))).toBeNull();
    expect(isErr(resolveTurn(fold('s', gone), supply()))).toBe(false);
  });

  it('a held attack does not outlive its target', () => {
    const log = heldAttack();
    const gone = [...log, ...unwrap(removeCreatureEverywhere(fold('s', log), B), 'remove')];
    expect(pendingAttackOf(fold('s', gone))).toBeNull();
    expect(isErr(resolveTurn(fold('s', gone), supply()))).toBe(false);
  });

  it('a declared move does not outlive the mover', () => {
    const log = declaredMove();
    expect(pendingMoveOf(fold('s', log))).not.toBeNull();

    const gone = [...log, ...unwrap(removeCreatureEverywhere(fold('s', log), A), 'remove')];
    expect(pendingMoveOf(fold('s', gone))).toBeNull();
    expect(isErr(resolveTurn(fold('s', gone), supply()))).toBe(false);
  });

  /**
   * A reactor leaving settles only their own Reaction. Anybody else still
   * owed one keeps it — the move is legitimately still pending, and the
   * difference between "stuck" and "waiting" is that this one can be settled.
   */
  it('a reactor leaving settles their Reaction and nobody else’s', () => {
    // A second enemy in reach, so there is somebody left to be owed one.
    const crowded: readonly GameEvent[] = [
      ...SETUP.filter((e) => e.type !== 'combat-started'),
      added(C, 'foes'),
      { type: 'creature-placed', id: C, placement: { from: { creature: A }, feet: 5, bearing: 90 } },
      { type: 'sight-declared', from: C, to: A, seen: true },
      {
        type: 'combat-started',
        combatants: [
          { id: A, initiative: 20, speed: 30 },
          { id: B, initiative: 10, speed: 30 },
          { id: C, initiative: 5, speed: 30 },
        ],
      },
    ];
    const moved = unwrap(
      resolveMove(fold('s', crowded), A, { placement: { from: { creature: B }, feet: 25, bearing: 180 } }, supply()),
      'move',
    );
    const log = [...crowded, ...moved.events];
    const owed = pendingMoveOf(fold('s', log))!.provoked.map((p) => p.reactor);
    expect(owed).toContain(B);
    expect(owed).toContain(C);

    const gone = [...log, ...unwrap(removeCreatureEverywhere(fold('s', log), B), 'remove')];
    const rest = pendingMoveOf(fold('s', gone))?.provoked.map((p) => p.reactor) ?? [];
    expect(rest).not.toContain(B);

    let settled: readonly GameEvent[] = gone;
    for (const reactor of rest) {
      settled = [...settled, ...unwrap(declineOpportunity(fold('s', settled), reactor, {}), 'decline')];
    }
    expect(pendingMoveOf(fold('s', settled))).toBeNull();
    expect(isErr(resolveTurn(fold('s', settled), supply()))).toBe(false);
  });

  /**
   * The worst of the family, because it is not a refusal but a **crash in the
   * fold**. A declared move keeps its placement so the mover still arrives
   * beside whoever they aimed at — and the Opportunity Attack that move
   * provoked is the single likeliest thing to kill that creature. Re-resolving
   * an anchor that is gone used to throw, and the offending `creature-moved`
   * was already written down: the campaign would never load again.
   */
  it('completes a move whose anchor was killed and removed', () => {
    const log = declaredMove();
    const gone = [...log, ...unwrap(removeCreatureEverywhere(fold('s', log), B), 'remove')];

    // B was the only creature owed a Reaction, so their leaving settles the
    // move on the spot — into a placement whose anchor is the creature that
    // just left.
    let settled: readonly GameEvent[] = gone;
    for (const p of pendingMoveOf(fold('s', gone))?.provoked ?? []) {
      settled = [...settled, ...unwrap(declineOpportunity(fold('s', settled), p.reactor, {}), 'decline')];
    }

    // It folds, it folds again, and the mover actually arrived somewhere.
    const after = fold('s', settled);
    expect(after.scene!.positions[A]).toBeDefined();
    expect(fold('s', settled)).toEqual(after);
  });
});

describe('play that is not a fight', () => {
  /**
   * Combat is one mode of a campaign and the rarer one. A command that needs
   * an Initiative order to work at all quietly makes exploration and social
   * play second-class — so the ones that have no business requiring turns are
   * checked against a scene with no combat in it.
   */
  const PEACE: readonly GameEvent[] = SETUP.filter((e) => e.type !== 'combat-started');

  it('an ambush: an attack lands before anybody rolled Initiative', () => {
    const out = resolveAttack(fold('s', PEACE), A, { target: B, weapon: 'longsword' }, supply());
    expect(isErr(out)).toBe(false);
  });

  it('walking across a room costs nothing when there is no turn to spend', () => {
    const out = resolveMove(
      fold('s', PEACE),
      A,
      { placement: { from: { landmark: 'here' }, feet: 100 } },
      supply(),
    );
    expect(isErr(out)).toBe(false);
  });

  it('Dodging out of combat is allowed and simply has no deadline', () => {
    const out = takeDodge(fold('s', PEACE), A, {});
    expect(isErr(out)).toBe(false);
  });
});

describe('a corrupt log is loud', () => {
  /**
   * The reducer's own claim, and the one case where it was not true. An event
   * type the switch does not recognise used to fall out of it and return
   * `undefined`, which failed several derived passes later with a TypeError
   * naming a function that had nothing to do with it.
   *
   * Today every log is built in this process by these commands, so the only
   * way in is a typo. From M3 logs come back from Postgres as JSON, where a
   * type is a string somebody wrote down last season — and a retired event
   * would silently produce an undefined world rather than saying so.
   */
  it('refuses an event type it has no rule for', () => {
    const bogus = { type: 'chandelier-swung', id: A } as unknown as GameEvent;
    expect(() => fold('s', [...SETUP, bogus])).toThrowError(/chandelier-swung/);
  });

  /** And it names the event rather than failing somewhere unrelated. */
  it('fails at the event rather than in a derived pass', () => {
    const bogus = { type: 'chandelier-swung', id: A } as unknown as GameEvent;
    let caught: unknown = null;
    try {
      fold('s', [...SETUP, bogus]);
    } catch (error) {
      caught = error;
    }
    expect((caught as Error).name).toBe('CorruptLogError');
  });
});

describe('the log is the whole truth', () => {
  /**
   * The determinism guarantee, stated as behaviour: the same log folds to the
   * same state whatever seed the session was started with, because every
   * random outcome is already written down. A module reading a clock or
   * iterating a map in insertion order breaks this and nothing else would say
   * so.
   */
  it('folds identically under a different seed', () => {
    const log = busyLog();
    expect(fold('another-seed-entirely', log)).toEqual({
      ...fold('s', log),
      seed: 'another-seed-entirely',
    });
  });

  it('survives a round trip through JSON at every prefix', () => {
    const log = busyLog();
    for (let n = 0; n <= log.length; n += 1) {
      const state = fold('s', log.slice(0, n));
      expect(JSON.parse(JSON.stringify(state))).toEqual(state);
    }
  });

  /** Replaying a prefix and then the rest is the same as replaying the whole. */
  it('folds in pieces exactly as it folds whole', () => {
    const log = busyLog();
    const whole = fold('s', log);
    for (let n = 0; n <= log.length; n += 1) {
      const piecewise = log.slice(n).reduce(applyEvent, fold('s', log.slice(0, n)));
      expect(piecewise).toEqual(whole);
    }
  });
});

/** A log with a bit of everything in it, so the sweeps above are not vacuous. */
function busyLog(): readonly GameEvent[] {
  let log: readonly GameEvent[] = SETUP;
  log = [...log, ...unwrap(takeDodge(fold('s', log), A, {}), 'dodge')];
  log = [...log, ...unwrap(resolveTurn(fold('s', log), supply('t1')), 't1').events];
  log = [
    ...log,
    ...unwrap(resolveAttack(fold('s', log), B, { target: A, weapon: null }, supply('atk')), 'atk').events,
  ];
  log = [...log, ...unwrap(resolveTurn(fold('s', log), supply('t2')), 't2').events];
  log = [
    ...log,
    ...unwrap(damageCreature(fold('s', log), B, { amount: 12, source: 'a falling rock' }), 'dmg'),
  ];
  log = [...log, ...unwrap(equipItem(fold('s', log), SRD_CONTENT, A, 'chain-shirt'), 'eq')];
  return log;
}

/**
 * Every declared event type, and whether anything can produce one.
 *
 * `GameState` is a fold over `GameEvent`, so a type nothing emits is a piece
 * of the rules the layer above cannot reach: a tool surface calls commands and
 * never appends events itself, which is the whole of why appending one would
 * be the model asserting a mechanical fact. Seventeen of the ninety-one types
 * were in that state when IE-009 measured it, eight of them closed by
 * `commands/scene.ts` and the other nine by this batch.
 *
 * **Derived on both sides, and by the method `CLAUDE.md` already states.** The
 * declared types are the `readonly type: '<x>'` literals in the union; the
 * emitted ones are those literals in a **`type:` position** in any runtime
 * module under `src/` other than the union and the fold. The `type:` position
 * is the load-bearing half rather than pedantry: a `ContextRequest`'s
 * `satisfyWith` *names* an event it does not write, and under the looser
 * reading `creature-placed` came out emitted while nothing emitted it.
 *
 * **Two exclusions, and they are one reason.** `events.ts` declares every
 * type, and `fold/` consumes them — neither writes one. IE-039 split the
 * reducer out of `events.ts`, so the exclusion had to follow the code or the
 * population would have silently gained 98 `case` labels, which is the
 * shrinking-population failure this repository keeps finding.
 *
 * A `case 'x':` does **not** match `type: 'x'`, so the ninety-eight would not
 * in fact have been counted as emissions today — and that is exactly why the
 * exclusion is by *module* rather than left to the regex. The question this
 * sweep asks is "which module emits this type", and the answer for the fold is
 * "none of them, structurally": it is handed events and returns state. A
 * population that includes the consumer is one regex change away from
 * answering yes on the strength of the reducer branching on a type, which
 * would mark a genuinely unreachable event type as reachable — the one
 * direction a guard must never fail in.
 */
const EVENT_TYPE_SOURCE: Readonly<Record<string, string>> = Object.fromEntries(
  readdirSync(SRC, { recursive: true, encoding: 'utf8' })
    .map((entry) => entry.replace(/\\/g, '/'))
    .filter(
      (file) =>
        file.endsWith('.ts') &&
        !file.endsWith('.test.ts') &&
        file !== 'events.ts' &&
        !file.startsWith('fold/'),
    )
    .map((file) => [file, readFileSync(`${SRC}${file}`, 'utf8')]),
);

/** The fold's own modules, which the sweep above excludes and the one below needs. */
const FOLD_SOURCE: Readonly<Record<string, string>> = Object.fromEntries(
  readdirSync(`${SRC}fold/`, { recursive: true, encoding: 'utf8' })
    .map((entry) => `fold/${entry.replace(/\\/g, '/')}`)
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
    .map((file) => [file, readFileSync(`${SRC}${file}`, 'utf8')]),
);

/**
 * The union's members, split at the `|` that begins each one — rather than by
 * matching to the next closing brace, which runs straight past a member
 * written on one line and reads the *next* member's fields.
 *
 * The union is cut out of the file first, at the `};` that closes its last
 * member. Without that the **last** member's chunk runs to end of file and
 * carries three thousand lines of reducer with it, so a stamp declaration
 * anywhere below would answer for a member that had lost its own.
 */
const EVENT_MEMBERS = new Map<string, string>();
{
  const file = readFileSync(`${SRC}events.ts`, 'utf8');
  const opens = file.indexOf('export type GameEvent =');
  const CLOSES = '\n    };';
  const union = file.slice(opens, file.indexOf(CLOSES, opens) + CLOSES.length);
  for (const chunk of union.split(/^  \| /m).slice(1)) {
    const named = /readonly type: '([a-z-]+)'/.exec(chunk);
    if (named !== null) EVENT_MEMBERS.set(named[1]!, chunk);
  }
}

/** Which of a set of declared types no source in the given map writes. */
const emittedNowhere = (
  declared: Iterable<string>,
  sources: Readonly<Record<string, string>>,
): readonly string[] => {
  const text = Object.values(sources).join('\n');
  return [...declared].filter((type) => !new RegExp(`\\btype: '${type}'`).test(text)).sort();
};

describe('every declared event type is reachable from a command', () => {
  /**
   * The population excludes the union and the fold, and nothing else.
   *
   * Asserted rather than described, because an exclusion written as a path
   * prefix is exactly the kind that silently widens: `!file.startsWith('fold')`
   * would take `folding.ts` with it, and a population that quietly shrinks is
   * this repository's most-repeated failure. So the two that are out are named,
   * a module from the command layer and one from the engine's own level are
   * asserted to still be in, and the fold's modules are asserted to be a real
   * set rather than an empty one — a sweep whose exclusion excludes nothing is
   * satisfied by any code at all.
   */
  it('excludes the union and the fold, and keeps everything else', () => {
    const population = Object.keys(EVENT_TYPE_SOURCE);
    expect(population).not.toContain('events.ts');
    expect(population.filter((file) => file.startsWith('fold/'))).toEqual([]);
    expect(population).toContain('commands/scene.ts');
    expect(population).toContain('creation.ts');
    expect(population).toContain('state.ts');

    // The fold really is a set of modules, so excluding it excludes something.
    expect(Object.keys(FOLD_SOURCE)).toEqual(
      expect.arrayContaining(['fold/apply.ts', 'fold/release.ts', 'fold/index.ts']),
    );
    // And it really does hold the reducer's `case` labels, which is what the
    // exclusion is about. They live in the seam that owns the type since
    // IE-050, and reading `fold/apply.ts` for one would now be satisfied by
    // `interruptedRests` — a derived pass that branches on three types and is
    // not the switch this exclusion is about.
    expect(FOLD_SOURCE['fold/casting.ts']).toContain("case 'spell-cast':");
  });

  /**
   * And it read the **whole** union. Cutting the union out of the file bounds
   * the last member's chunk, and a cut that landed early would drop members
   * silently — leaving every assertion below true of a smaller set. So the
   * count is held against every distinct `readonly type:` literal in the file,
   * which is the reading `persistence.test.ts` takes and needs no cut at all.
   */
  it('read every member of the union', () => {
    const everywhere = new Set(
      [...readFileSync(`${SRC}events.ts`, 'utf8').matchAll(/readonly type: '([a-z-]+)'/g)].map(
        (match) => match[1]!,
      ),
    );
    expect(EVENT_MEMBERS.size).toBeGreaterThan(80);
    expect([...EVENT_MEMBERS.keys()].sort()).toEqual([...everywhere].sort());
  });

  /**
   * The whole point, and the assertion the nine DM-declared commands exist to
   * make true. Nothing is exempt: a new event type declared with no producer
   * fails here on the day it is written rather than on the day M2 goes looking
   * for a tool that can reach it.
   */
  it('leaves no declared type that nothing in the engine emits', () => {
    expect(emittedNowhere(EVENT_MEMBERS.keys(), EVENT_TYPE_SOURCE)).toEqual([]);
  });

  /**
   * And the analysis is not vacuous: shown a type nothing writes, it says so.
   *
   * Synthetic on both sides, the way the action-economy sweep drives its own
   * smuggled spender, because a sweep proved only against the repository it
   * runs on is a sweep that can quietly stop seeing anything.
   */
  it('would find a declared type that no source emits', () => {
    const sources = { 'a-module.ts': "ok([{ type: 'a-real-event', id }]);" };
    expect(emittedNowhere(['a-real-event', 'a-fictional-event'], sources)).toEqual([
      'a-fictional-event',
    ]);
  });

  /** And a `satisfyWith` naming an event is not an emission of it. */
  it('does not count a context request that merely names one', () => {
    const sources = { 'a-module.ts': "satisfyWith: 'a-real-event'," };
    expect(emittedNowhere(['a-real-event'], sources)).toEqual(['a-real-event']);
  });

  /**
   * **Where the command layer is drawn changes the answer, so it is named
   * rather than assumed.** Read as the sweeps above read it — every module
   * under `commands/`, plus `rest.ts` — five types come back, and every one of
   * them is emitted by `creation.ts`. That is a question about where a command
   * lives rather than about whether one exists, and it is the only such
   * question left: `createCharacter` and `advanceCharacter` predate the command
   * layer, take no `CommandIdentity`, and are not in `commands.ts`'s barrel, so
   * the sweeps that read that barrel do not see them either.
   *
   * **It was five, and `creature-added` left.** `addCreature` in
   * `commands/creatures.ts` emits it — a barrel command, through `once`,
   * wrapping `adaptMonster` — so the exemption fell rather than being
   * reworded, which is what an exemption naming the fact that would end it is
   * for. `createCharacter` still emits one too, and an event type is *emitted*
   * once something writes it; a second writer neither adds nor removes an
   * exemption.
   */
  const OUTSIDE_THE_COMMAND_LAYER: Readonly<Record<string, string>> = {
    'character-created':
      'emitted by `createCharacter` in `creation.ts`, which predates the command layer, takes no CommandIdentity and is not published through the `commands.ts` barrel',
    'character-advanced': 'emitted by `advanceCharacter` in `creation.ts`, for the same reason',
    'hit-point-maximum-raised':
      'emitted by `advanceCharacter` in `creation.ts`, which pays out the hit points a level granted',
    'resource-pool-resized':
      'emitted by `advanceCharacter` in `creation.ts`, which grows a pool the level made bigger',
    'resource-pool-recovery-changed':
      'emitted by `advanceCharacter` in `creation.ts`, beside the resize, where the level brought a feature that rewrites an earlier pool’s recovery',
  };

  it('names the five that `creation.ts` emits and no command does', () => {
    const commandLayer = Object.fromEntries(
      [...COMMAND_MODULES, 'rest.ts'].map((file) => [file, MODULE_SOURCE[file]!]),
    );
    expect(emittedNowhere(EVENT_MEMBERS.keys(), commandLayer)).toEqual(
      Object.keys(OUTSIDE_THE_COMMAND_LAYER).sort(),
    );
    expect(Object.values(OUTSIDE_THE_COMMAND_LAYER).every((why) => why.length > 20)).toBe(true);
  });

  /** And each exemption's claim is checked rather than taken on its word. */
  it('and `creation.ts` really does emit every one of them', () => {
    const creation = { 'creation.ts': readFileSync(`${SRC}creation.ts`, 'utf8') };
    expect(emittedNowhere(Object.keys(OUTSIDE_THE_COMMAND_LAYER), creation)).toEqual([]);
  });
});

/**
 * Every event a command stamps declares that it may carry one.
 *
 * **The compiler does not check this, and that is the point.**
 * Excess-property checking on a union accepts a field *any* member declares,
 * so `{ type: 'scene-set', extent, command }` compiles whether or not
 * `scene-set` says it may carry a stamp — verified by mutation: deleting the
 * declaration from `events.ts` leaves `npm run typecheck` completely silent.
 * `recordCommand` is generic and remembers it either way, so nothing fails at
 * runtime either.
 *
 * This repository has recorded that trap twice — once for a `command` stamp on
 * an event that did not declare it, once for a casting's `route` — and both
 * times the cost was the same: a field in the log that no reader of the type
 * could see. So the claim is read off both sources and held against itself.
 *
 * **It reads the stamp rather than the module**, which is what let it become a
 * directory listing. Scoping it by module was fine while every event a module
 * wrote carried a stamp, which was true of `commands/scene.ts` alone;
 * `commands/movement.ts` writes `movement-spent` without one. So each
 * `...(stamp === null` spread is attributed to the nearest `type:` literal
 * above it — the object it is a property of — and a module whose stamps that
 * cannot read fails rather than going quiet.
 */
describe('every event a command stamps declares that it carries one', () => {
  const STAMP = '...(stamp === null';

  /** The event each stamp spread is written onto, per module. */
  const attributed = (source: string): readonly (string | null)[] =>
    source
      .split(STAMP)
      .slice(0, -1)
      .map((chunk) => [...chunk.matchAll(/\btype: '([a-z-]+)'/g)].at(-1)?.[1] ?? null);

  /**
   * The one module whose stamp cannot be attributed, with the reason.
   *
   * `resolveTest` spreads its stamp onto `recordD20Test(...)`, whose `type` is
   * written inside that helper rather than at the call site — so there is no
   * literal above it to attribute it to. It is `roll-recorded`, which declares
   * a stamp, and the assertion below says so rather than leaving the gap
   * silent.
   */
  const UNATTRIBUTABLE: Readonly<Record<string, string>> = {
    'commands/reactions.ts':
      'one stamp is spread onto `recordD20Test(...)`, which builds the event and its `type` inside the helper, so no literal at the call site can name it; it is `roll-recorded`',
  };

  it('attributes every stamp in every command module but the one named', () => {
    const blind = Object.keys(MODULE_SOURCE)
      .filter((file) => attributed(MODULE_SOURCE[file]!).includes(null))
      .sort();
    expect(blind).toEqual(Object.keys(UNATTRIBUTABLE).sort());
    expect(Object.values(UNATTRIBUTABLE).every((why) => why.length > 20)).toBe(true);
    // And the one it cannot see would have passed anyway.
    expect(EVENT_MEMBERS.get('roll-recorded')!).toMatch(/readonly command\?: CommandStamp/);
  });

  const stamped = new Set(
    Object.values(MODULE_SOURCE)
      .flatMap((source) => attributed(source))
      .filter((type): type is string => type !== null),
  );

  it('found the events the command layer stamps', () => {
    // A floor rather than a list, so adding a stamped event is not a chore —
    // but high enough that a derivation that quietly stopped reading fails.
    expect(stamped.size).toBeGreaterThan(25);
    expect(stamped.has('scene-set')).toBe(true);
    expect(stamped.has('mounted')).toBe(true);
  });

  it('and every one of them declares a command stamp', () => {
    for (const type of stamped) {
      expect(EVENT_MEMBERS.has(type), type).toBe(true);
      expect(EVENT_MEMBERS.get(type)!, type).toMatch(/readonly command\?: CommandStamp/);
    }
  });

  /**
   * And the reader would notice one that did not. `hit-point-maximum-raised`
   * is the control: no command stamps it and it declares none, so a reader
   * that answered "yes" to everything would say it did.
   *
   * **It was `combat-ended` until `endCombat` landed**, and the swap is the
   * point rather than an inconvenience: the old control held only because
   * nothing in the engine could end a fight, which is the defect that command
   * closed. This one is a command-layer fact of a different kind and cannot
   * go the same way by accident — `advanceCharacter` in `creation.ts` writes
   * it, and `creation.ts` predates the command layer, takes no
   * `CommandIdentity` and is not published through the `commands.ts` barrel.
   * It is one of the four `OUTSIDE_THE_COMMAND_LAYER` names above, so a task
   * that does bring it inside has to say so there first.
   */
  it('would see a type that is missing it', () => {
    expect(EVENT_MEMBERS.has('hit-point-maximum-raised')).toBe(true);
    expect(stamped.has('hit-point-maximum-raised')).toBe(false);
    expect(EVENT_MEMBERS.get('hit-point-maximum-raised')!).not.toMatch(
      /readonly command\?: CommandStamp/,
    );
    // The event the control used to be does declare one now, which is the
    // other half of the same claim: `endCombat` stamps it.
    expect(stamped.has('combat-ended')).toBe(true);
    expect(EVENT_MEMBERS.get('combat-ended')!).toMatch(/readonly command\?: CommandStamp/);
  });
});

/**
 * One reader for Speed.
 *
 * `spendMovement`'s cap, a Dash's increase, a mounting cost and a readied
 * move's allowance were **three different spellings** of one question — one
 * reaching for `sheet.baseSpeed`, one for the pinned `combatant.speed`, all
 * three handing whichever they found to `conditionSpeed` — and none of them
 * could see a class feature. `speedOf` is the one gatherer, the shape
 * `rollModesFor` already applied to modes and `defensesOf` to defences.
 *
 * Two claims, because the question has two halves and only one of them lives
 * in the command layer:
 *
 * | | |
 * |---|---|
 * | `conditionSpeed` has one caller | the condition rules reach a Speed through one door, wherever in the engine that door is |
 * | no module under `commands/` names a printed Speed | the command layer asks `speedOf` and derives nothing itself |
 *
 * Both are derived rather than listed, and both are driven over a synthetic
 * second reader they have to catch — the discipline every sweep in this file
 * follows, because a sweep that can only be run against the source it already
 * agrees with reports no problems and checks nothing.
 */
describe('Speed is read through one reader', () => {
  /** Every call to a name, attributed to the top-level declaration it sits in. */
  const callersOf = (name: string, sources: Readonly<Record<string, string>>): ReadonlySet<string> =>
    new Set(
      Object.values(sources).flatMap((source) =>
        functionsIn(source)
          // The import line is not a call, and a declaration's own name is not
          // a call of itself.
          .filter((fn) => fn.name !== name && new RegExp(`\\b${name}\\(`).test(fn.body))
          .map((fn) => fn.name),
      ),
    );

  /**
   * **The population includes the fold, and that is load-bearing rather than
   * tidy.** `EVENT_TYPE_SOURCE` excludes the reducer, because the sweep it was
   * built for is about which module *emits* an event type — and this sweep,
   * reading that map, could not see the one file the defect was in. The fold
   * calls `speedOf`; a sweep claiming "wherever in the engine that door is"
   * has to be able to look there.
   *
   * **It gained `events.ts` in IE-031 and the fold modules in IE-039**, which
   * is the same correction arriving twice. The reducer moved out of
   * `events.ts` into `fold/`, and a population still naming only the old file
   * would have gone green while looking at a union — the shrinking-population
   * failure, met on the file the first correction was about. So the fold is
   * added as a directory listing rather than as a name: an eighth seam joins
   * on the day it is written, and a hand-kept list of modules is the thing
   * these sweeps exist to replace.
   *
   * There are **no exemptions**. `dash` held the only one, and it named the
   * fact that would end it — the reducer passing `speedOf` — which is exactly
   * what happened, so the exemption fell rather than being rewritten. A guard
   * whose exemption list is empty is the one that was worth writing.
   */
  const SPEED_SOURCE: Readonly<Record<string, string>> = {
    ...EVENT_TYPE_SOURCE,
    'events.ts': readFileSync(`${SRC}events.ts`, 'utf8'),
    ...FOLD_SOURCE,
  };

  it('reads a population that includes the reducer', () => {
    // The sweep is only as wide as its map, and the map it inherited stopped
    // short of the defect — first by one file, and then by a directory.
    expect(Object.keys(EVENT_TYPE_SOURCE)).not.toContain('events.ts');
    expect(Object.keys(EVENT_TYPE_SOURCE).filter((f) => f.startsWith('fold/'))).toEqual([]);
    expect(Object.keys(SPEED_SOURCE)).toContain('events.ts');
    expect(Object.keys(SPEED_SOURCE)).toContain('fold/apply.ts');
    expect(Object.keys(SPEED_SOURCE)).toContain('fold/expiry.ts');
  });

  it('calls conditionSpeed from combineSpeed and from nowhere else', () => {
    expect([...callersOf('conditionSpeed', SPEED_SOURCE)].sort()).toEqual(['combineSpeed']);
  });

  it('would catch a second caller', () => {
    const synthetic = {
      'synthetic.ts': [
        'function sneaksAnotherSpeedIn(state: ConditionState) {',
        '  return conditionSpeed(state, 30);',
        '}',
      ].join('\n'),
    };
    expect(callersOf('conditionSpeed', synthetic).has('sneaksAnotherSpeedIn')).toBe(true);
  });

  /**
   * And the fold asks the one reader, which is the other half of the same
   * claim: a reducer backstop measuring against a different number is a fork
   * rather than a guard, and that fork is what folded a corrupt log.
   */
  it('asks speedOf from the two reducer cases that need it', () => {
    const reducer = SPEED_SOURCE['fold/combat.ts']!;
    expect(reducer).toMatch(/dash\(combatOf\(state, event\), event\.id, speedOf\(state, event\.id\)\)/);
    // **The movement spend asks the same reader once per mode.** A
    // `movement-spent` does not say which Speed the mover used, and a
    // creature with more than one legitimately spends against whichever it is
    // using — so the reducer's backstop is the fastest of them, and the exact
    // check stays in the command that knows. Still one reader: `spendableSpeed`
    // is `speedOf` asked five times and nothing else, which is asserted here
    // rather than left to the name.
    expect(reducer).toMatch(/spendMovement\([\s\S]{0,160}spendableSpeed\(state, event\.id\)/);
    expect(reducer).toMatch(/MOVEMENT_MODES\.map\(\(mode\) => speedOf\(state, who, mode\)\)/);
  });

  /**
   * The command layer derives no Speed of its own.
   *
   * `baseSpeed` is the sheet's printed number and `.speed` is the one the
   * Initiative order pinned; a command that reads either is asking the
   * question `speedOf` exists to answer. Neither appears in `commands/`, and
   * the one command that needs a number — `spendMounting`, for SRD's "half
   * your Speed (round down)" — holds `speedOf`'s answer in a local, which has
   * no dot in front of it and is the point.
   */
  const PRINTED_SPEED = /\bbaseSpeed\b|\.speed\b/;

  it('names no printed Speed anywhere under commands/', () => {
    const named = Object.entries(MODULE_SOURCE)
      .filter(([file]) => file.startsWith('commands/'))
      .filter(([, source]) => PRINTED_SPEED.test(source))
      .map(([file]) => file);
    expect(named).toEqual([]);
  });

  it('would catch a command that read one', () => {
    expect(PRINTED_SPEED.test('const feet = creature.sheet.baseSpeed;')).toBe(true);
    expect(PRINTED_SPEED.test('const feet = combat.order.find((c) => c.id === id)?.speed;')).toBe(
      true,
    );
    // And does not fire on the local a command legitimately holds.
    expect(PRINTED_SPEED.test('const speed = speedOf(state, rider);')).toBe(false);
  });

  /**
   * A `speed` grant may not require `has-speed`, which is what keeps the
   * reading from being circular: `speedOf` asks the requirements of the grants
   * it is adding up, and `has-speed` asks `speedOf`. A violation would recurse
   * without bound rather than produce a wrong number, so this is a stack
   * overflow in a fight and not a rules bug.
   *
   * **Every `FeatureSource`, not just the twelve classes.** `SRD_CONTENT.classes` was
   * narrower than the hazard: a subclass carries its own `features`, and so do
   * a species and a background, and `speedOf` reads whatever reached
   * `sheet.standing` without caring which of the four put it there. The
   * population is derived from the registries rather than listed, so a fifth
   * source joins it by being registered.
   *
   * **A feat is not in it, and that is a fact rather than an omission.**
   * `FeatDefinition` carries an id, a category, a requirement, a repeatable
   * flag and a note — and no `features` at all — so a feat cannot declare a
   * standing grant of any kind, circular or otherwise. The type is what says
   * so, which is why the sweep does not reach for one.
   */
  const FEATURE_SOURCES: readonly FeatureSource[] = [
    ...SRD_CONTENT.classes,
    ...SRD_CONTENT.subclasses,
    ...SPECIES,
    ...BACKGROUNDS,
  ];

  it('sweeps every feature source rather than the classes alone', () => {
    // A floor, not an inventory: it fails if the population empties or the
    // registries stop being read, and says nothing about a source being added.
    expect(FEATURE_SOURCES.length).toBeGreaterThan(SRD_CONTENT.classes.length);
    expect(SRD_CONTENT.subclasses.length).toBeGreaterThan(0);
    // And a feat really has no features to sweep, which is what excuses it.
    const feats: readonly FeatDefinition[] = [...ORIGIN_FEATS, ...FIGHTING_STYLE_FEATS];
    expect(feats.length).toBeGreaterThan(0);
    for (const feat of feats) expect('features' in feat, feat.id).toBe(false);
  });

  /**
   * The predicate is extracted so the synthetic below can be driven **through
   * it** rather than beside it. A test that re-implements the check over a
   * hand-built literal asserts that `Array.some` works and cannot fail for the
   * reason it claims — which is the shape `callersOf` and `PRINTED_SPEED`
   * already avoid by applying the extracted thing to both populations.
   */
  const circularSpeedGrants = (sources: readonly FeatureSource[]): readonly string[] =>
    sources.flatMap((source) =>
      source.features
        .filter((feature) =>
          featureGrants(feature).some(
            (grant) =>
              grant.kind === 'standing' &&
              (grant.effects ?? []).some((effect) => effect.kind === 'speed') &&
              (grant.requires ?? []).some((requirement) => requirement.kind === 'has-speed'),
          ),
        )
        .map((feature) => feature.id),
    );

  it('has no Speed grant conditioned on a Speed', () => {
    expect(circularSpeedGrants(FEATURE_SOURCES)).toEqual([]);
  });

  /**
   * And the guard would see one, which an all-green population cannot say by
   * itself: the **same function** is handed a feature source it must catch.
   */
  it('would catch a Speed grant that required one', () => {
    const synthetic: FeatureSource = {
      id: 'synthetic',
      name: 'Synthetic',
      features: [
        {
          id: 'synthetic:swift-while-swift',
          name: 'Swift While Swift',
          level: 1,
          automation: 'engine',
          note: 'A grant conditioned on the very number it contributes to.',
          grants: {
            kind: 'standing',
            reach: 'self',
            effects: [{ kind: 'speed', feet: 10 }],
            requires: [{ kind: 'has-speed' }],
          },
        },
      ],
    };
    expect(circularSpeedGrants([synthetic])).toEqual(['synthetic:swift-while-swift']);
    // And it does not fire on the shape the three real features have.
    const armoured: FeatureSource = {
      ...synthetic,
      features: [
        {
          ...synthetic.features[0]!,
          grants: {
            kind: 'standing',
            reach: 'self',
            effects: [{ kind: 'speed', feet: 10 }],
            requires: [{ kind: 'not-wearing-heavy-armor' }],
          },
        },
      ],
    };
    expect(circularSpeedGrants([armoured])).toEqual([]);
  });
});
