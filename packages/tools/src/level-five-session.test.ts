/**
 * A level 5 party plays a session, and the session counts what it could not do.
 *
 * Ship criterion 3 of `docs/ROADMAP.md` §0 is *"a level 5 party plays a
 * session with zero handovers"*, and the number in that sentence did not
 * exist. This file makes it exist. It is **not** an attempt to make it zero —
 * a later phase does that — so nothing here asserts a count. What it asserts
 * is that the session runs end to end, from the same seed, through the two
 * surfaces and nothing else.
 *
 * Four characters, suggested by the roadmap because between them they touch
 * weapons, slots, Sneak Attack, Channel Divinity and concentration: a Fighter,
 * a Cleric, a Rogue and a Wizard, each built at level 5 through
 * `create_character`. Against them, four Undead — a Wight, a Ghast and two
 * Skeletons, 1,250 XP against a four-character level 5 party — chosen Undead
 * so that Turn Undead has something to turn and Preserve Life has the
 * exclusion it prints something to refuse on.
 *
 * **The three counts this file delivers**, printed at the end of the run:
 *
 * 1. every `unverified` clause the session produced, by the tool that produced
 *    it;
 * 2. every line of those that is a *handover* — the engine saying the question
 *    is the table's rather than that it owes an answer. Two marks, because the
 *    engine writes two: {@link DM_DECIDES} on a casting, and the sentence a
 *    stat block's lines end with, which has no exported constant and is the
 *    one string this file copies;
 * 3. every `manual` feature the party held and could not use, with the
 *    catalogue's own reason, and beside it every engine pool the party held
 *    that reaches no door at all.
 *
 * **What this file imports from the engine, and why it is not a reach-around.**
 * `fight.test.ts` imports no engine at all and says so; this one imports two
 * values — the mark a handover carries and the reader that strips it. Neither
 * is a command and neither touches the campaign: the count has to agree with
 * the engine's own mark rather than with a string this file typed, or the day
 * the mark changes the criterion goes quietly to zero. Every *act* of the
 * session is still a `surface.call`.
 *
 * `@ie/content` is read for the third count for the same reason. A manual
 * feature is by construction a feature the sheet does not carry — that is what
 * `automation: 'manual'` means — so `sheet` cannot report one, and a census
 * taken off the surfaces alone would report zero for ever. That is itself a
 * finding and is in the digest.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { DM_DECIDES, dmDecisionsIn, type FeatureDefinition } from '@ie/engine';
import {
  createCampaign,
  createDmSurface,
  createSurface,
  type Campaign,
  type Holdings,
  type Observation,
  type Surface,
  type ToolOutcome,
} from '@ie/tools';

// — the party ————————————————————————————————————————————————————————————————

/**
 * The four sheets, each built at level 5 in one call.
 *
 * Species and background are deliberately four different ones rather than four
 * humans: the third count is a census of what the party *holds*, and a party of
 * four identical origins would report one origin's manual features four times
 * and nothing about the other three.
 */
const BREN: Record<string, unknown> = {
  name: 'Bren',
  classId: 'fighter',
  level: 5,
  speciesId: 'dwarf',
  backgroundId: 'soldier',
  abilities: {
    method: 'standard-array',
    assignment: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 },
  },
  abilityIncreases: { str: 2, con: 1 },
  classSkills: ['perception', 'survival'],
  languages: ['Dwarvish', 'Goblin'],
  alignment: 'Lawful Good',
  subclassId: 'champion',
  cantrips: [],
  spellbook: [],
  preparedSpells: [],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: [],
  hitPoints: { method: 'fixed' },
  featureChoices: {
    'fighter:weapon-mastery': ['greatsword', 'flail', 'javelin', 'spear'],
  },
  feats: {
    'soldier:savage-attacker': { featId: 'savage-attacker' },
    'fighter:fighting-style': { featId: 'defense' },
    'fighter:ability-score-improvement': {
      featId: 'ability-score-improvement',
      abilities: ['str', 'con'],
    },
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard package only' },
};

const BRANNOR: Record<string, unknown> = {
  name: 'Brannor',
  classId: 'cleric',
  level: 5,
  speciesId: 'human',
  backgroundId: 'acolyte',
  abilities: {
    method: 'standard-array',
    assignment: { str: 14, dex: 12, con: 13, int: 10, wis: 15, cha: 8 },
  },
  abilityIncreases: { wis: 2, cha: 1 },
  classSkills: ['medicine', 'persuasion'],
  languages: ['Dwarvish', 'Elvish'],
  alignment: 'Neutral Good',
  subclassId: 'life-domain',
  cantrips: ['sacred-flame', 'guidance', 'light', 'thaumaturgy'],
  spellbook: [],
  preparedSpells: [
    'spirit-guardians',
    'inflict-wounds',
    'healing-word',
    'bane',
    'blindness-deafness',
    'hold-person',
    'guiding-bolt',
    'aid',
    'silence',
  ],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: [],
  hitPoints: { method: 'fixed' },
  featureChoices: {
    'human:skillful': ['perception'],
    'cleric:divine-order': ['Protector'],
  },
  feats: {
    'acolyte:magic-initiate-cleric': {
      featId: 'magic-initiate',
      spellList: 'cleric',
      spellcastingAbility: 'wis',
      cantrips: ['spare-the-dying', 'resistance'],
      levelOneSpell: 'cure-wounds',
    },
    'human:versatile': { featId: 'alert' },
    'cleric:ability-score-improvement': {
      featId: 'ability-score-improvement',
      abilities: ['wis', 'wis'],
    },
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard package only' },
};

const PIP: Record<string, unknown> = {
  name: 'Pip',
  classId: 'rogue',
  level: 5,
  speciesId: 'halfling',
  backgroundId: 'criminal',
  abilities: {
    method: 'standard-array',
    assignment: { str: 8, dex: 15, con: 13, int: 14, wis: 12, cha: 10 },
  },
  abilityIncreases: { dex: 2, con: 1 },
  classSkills: ['acrobatics', 'investigation', 'perception', 'deception'],
  languages: ['Halfling', 'Orc'],
  alignment: 'Chaotic Neutral',
  subclassId: 'thief',
  cantrips: [],
  spellbook: [],
  preparedSpells: [],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: [],
  hitPoints: { method: 'fixed' },
  featureChoices: {
    'rogue:expertise': ['acrobatics', 'investigation'],
    'rogue:weapon-mastery': ['shortsword', 'shortbow'],
  },
  feats: {
    'criminal:alert': { featId: 'alert' },
    'rogue:ability-score-improvement': {
      featId: 'ability-score-improvement',
      abilities: ['dex', 'dex'],
    },
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard package only' },
};

/** The fourteen spells levelling writes into a level 5 Wizard's book. */
const KESSA_BOOK: readonly (readonly [string, number])[] = [
  ['magic-missile', 1],
  ['shield', 1],
  ['mage-armor', 1],
  ['detect-magic', 1],
  ['feather-fall', 1],
  ['sleep', 1],
  ['misty-step', 2],
  ['web', 2],
  ['hold-person', 3],
  ['invisibility', 3],
  ['mirror-image', 4],
  ['blur', 4],
  ['fly', 5],
  ['counterspell', 5],
];

const KESSA: Record<string, unknown> = {
  name: 'Kessa',
  classId: 'wizard',
  level: 5,
  speciesId: 'elf',
  backgroundId: 'sage',
  abilities: {
    method: 'standard-array',
    assignment: { str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 10 },
  },
  abilityIncreases: { int: 2, con: 1 },
  classSkills: ['investigation', 'insight'],
  languages: ['Draconic', 'Goblin'],
  alignment: 'Chaotic Good',
  subclassId: 'evoker',
  cantrips: ['fire-bolt', 'light', 'prestidigitation', 'ray-of-frost'],
  spellbook: KESSA_BOOK.map(([spellId, acquiredAt]) => ({
    spellId,
    acquiredAt,
    origin: 'level' as const,
  })),
  preparedSpells: [
    'scorching-ray',
    'shield',
    'mage-armor',
    'misty-step',
    'web',
    'hold-person',
    'fly',
    'counterspell',
    'burning-hands',
  ],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: [],
  hitPoints: { method: 'fixed' },
  featureChoices: {
    'elf:elven-lineage': ['High Elf'],
    'elf:keen-senses': ['perception'],
    'wizard:scholar': ['arcana'],
    'evoker:evocation-savant': ['burning-hands', 'scorching-ray'],
  },
  feats: {
    'sage:magic-initiate-wizard': {
      featId: 'magic-initiate',
      spellList: 'wizard',
      spellcastingAbility: 'int',
      cantrips: ['mage-hand', 'minor-illusion'],
      levelOneSpell: 'find-familiar',
    },
    'wizard:ability-score-improvement': {
      featId: 'ability-score-improvement',
      abilities: ['int', 'con'],
    },
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard package only' },
};

/** Who is who, in the order they are built. */
const PARTY = [
  { id: 'bren', choices: BREN, classId: 'fighter', subclassId: 'champion' },
  { id: 'brannor', choices: BRANNOR, classId: 'cleric', subclassId: 'life-domain' },
  { id: 'pip', choices: PIP, classId: 'rogue', subclassId: 'thief' },
  { id: 'kessa', choices: KESSA, classId: 'wizard', subclassId: 'evoker' },
] as const;

/** The encounter: four Undead, so Turn Undead has a population. */
const HOSTILES = [
  { id: 'gravemark', monsterId: 'wight' },
  { id: 'carrion', monsterId: 'ghast' },
  { id: 'rattle', monsterId: 'skeleton' },
  { id: 'clatter', monsterId: 'skeleton' },
] as const;

// — the table ————————————————————————————————————————————————————————————————

interface Sent {
  readonly door: 'player' | 'dm';
  readonly tool: string;
  readonly input: unknown;
  readonly outcome: ToolOutcome;
}

interface Table {
  readonly campaign: Campaign;
  readonly player: Surface;
  readonly dm: Surface;
  readonly sent: readonly Sent[];
  /** What one call has to hand a later one: a casting id, a hold outstanding. */
  readonly memo: Record<string, string>;
  /** The model's door. Records the outcome whatever it was; never throws. */
  call(tool: string, input?: unknown): ToolOutcome;
  /** The DM's door, same terms. */
  dmCall(tool: string, input?: unknown): ToolOutcome;
  /** For setup, where a failure is a broken test rather than a finding. */
  must(tool: string, input?: unknown): ToolOutcome;
  look(): Observation;
}

/**
 * One campaign, two surfaces over it, and a transcript of every call.
 *
 * Two surfaces over one campaign is one campaign — `dispatch.ts` says so — and
 * that is exactly the table this criterion describes: a DM adjudicating beside
 * a party acting.
 */
function table(seed = 'a-level-five-session'): Table {
  const campaign = createCampaign({ content: SRD_CONTENT, seed });
  const player = createSurface(campaign);
  const dm = createDmSurface(campaign);
  const sent: Sent[] = [];
  let calls = 0;

  const through = (door: 'player' | 'dm', tool: string, input: unknown): ToolOutcome => {
    calls += 1;
    const surface = door === 'player' ? player : dm;
    const outcome = surface.call({ tool, input, commandId: `toolu_${calls}` });
    sent.push({ door, tool, input, outcome });
    return outcome;
  };

  return {
    campaign,
    player,
    dm,
    sent,
    memo: {},
    call: (tool, input = {}) => through('player', tool, input),
    dmCall: (tool, input = {}) => through('dm', tool, input),
    must(tool, input = {}) {
      const outcome = through('player', tool, input);
      if (outcome.status !== 'ok') {
        throw new Error(
          `setup call ${tool} answered ${outcome.status}: ${JSON.stringify(outcome, null, 2).slice(0, 900)}`,
        );
      }
      return outcome;
    },
    look: () => player.observe(),
  };
}

const seen = (t: Table, id: string) => t.look().creatures.find((one) => one.id === id);

// — the census ————————————————————————————————————————————————————————————————

/** Where an `unverified` line came from and what kind of line it is. */
interface Clause {
  readonly tool: string;
  readonly line: string;
  readonly kind: 'handover-spell' | 'handover-block' | 'unmodelled';
}

/**
 * The **second** mark a handover carries, and the reason it is a literal here.
 *
 * A spell's handover goes out under {@link DM_DECIDES}, which the engine
 * exports and `dmDecisionsIn` reads back. A stat block's does not: the four
 * sites that write one — a printed Actions line, a printed Bonus Actions line,
 * a Multiattack's spare sentence and an attack's rider — each end the line
 * with this clause and there is no constant for it. So the count either copies
 * the sentence or misses four fifths of what a monster hands over, and copying
 * it with the reason written down is the honest of the two. Exporting it
 * beside `DM_DECIDES` is a one-line engine change this track does not own.
 */
const BLOCK_HANDOVER = 'the engine does not apply that; a DM does';

/**
 * The two engine files the sentence is written in, and how often, so the copy
 * is pinned.
 *
 * A copied literal is the one unguarded input to count 2: reword the sentence
 * in `attacks.ts` and "handed over to the DM" falls to zero with nothing
 * failing, which is exactly the silence the header invokes `DM_DECIDES` to
 * avoid. So the copy is held to the original the way `doors.test.ts` and
 * `boundary.test.ts` hold theirs — by reading the source — and the day the
 * wording moves, this file says so rather than the count saying nothing.
 */
const WRITES_THE_HANDOVER: readonly (readonly [string, number])[] = [
  // A printed Actions line and a printed Bonus Actions line.
  ['../../engine/src/commands/actions.ts', 2],
  // A Multiattack's spare sentence and an attack's rider.
  ['../../engine/src/commands/attacks.ts', 2],
];

const clausesIn = (sent: readonly Sent[]): readonly Clause[] =>
  sent.flatMap(({ tool, outcome }) =>
    outcome.status === 'ok'
      ? outcome.unverified.map((line) => ({
          tool,
          line,
          kind: line.includes(DM_DECIDES)
            ? ('handover-spell' as const)
            : line.includes(BLOCK_HANDOVER)
              ? ('handover-block' as const)
              : ('unmodelled' as const),
        }))
      : [],
  );

/** Every feature the catalogue grants one of the party, by source. */
const featuresHeldBy = (member: (typeof PARTY)[number]): readonly FeatureDefinition[] => {
  const choices = member.choices as { speciesId: string; backgroundId: string; level: number };
  const classOf = SRD_CONTENT.classes.find((one) => one.id === member.classId);
  const subclassOf = SRD_CONTENT.subclasses.find((one) => one.id === member.subclassId);
  const speciesOf = SRD_CONTENT.species.find((one) => one.id === choices.speciesId);
  const backgroundOf = SRD_CONTENT.backgrounds.find((one) => one.id === choices.backgroundId);
  return [
    ...(classOf?.features ?? []).filter((one) => one.level <= choices.level),
    ...(subclassOf?.features ?? []).filter((one) => one.level <= choices.level),
    ...(speciesOf?.features ?? []),
    ...(backgroundOf?.features ?? []),
  ];
};

interface ManualHolding {
  readonly who: string;
  readonly feature: string;
  readonly name: string;
  readonly note: string;
}

const manualHoldings = (): readonly ManualHolding[] =>
  PARTY.flatMap((member) =>
    featuresHeldBy(member)
      .filter((one) => one.automation === 'manual')
      .map((one) => ({
        who: member.id,
        feature: one.id,
        name: one.name,
        note: one.note.split('. ')[0] ?? one.note,
      })),
  );

/**
 * A pool on the sheet that no feature line claims — an engine resource with no
 * door.
 *
 * Not the same failure as a manual feature and counted beside it rather than
 * with it: the engine executes what a use buys (or does not), and what is
 * missing is the tool. Action Surge is the roadmap's example and this is the
 * measurement of it.
 */
interface PoolWithNoDoor {
  readonly who: string;
  readonly pool: string;
  readonly label: string;
}

/**
 * A Hit Die pool is spent through `end_rest.hitDice` and says so nowhere.
 *
 * The one prefix match in this file, and it is a prefix match because the
 * sheet gives no other handle: a Hit Die pool carries no feature line and no
 * `spentBy`, and the session really does spend one through the door named
 * here, so counting it as shut would be the census contradicting the
 * transcript three screens above it.
 */
const HIT_DIE = 'hit-die:';

const poolsWithNoDoor = (t: Table): readonly PoolWithNoDoor[] => {
  const found: PoolWithNoDoor[] = [];
  for (const member of PARTY) {
    const outcome = t.call('sheet', { who: member.id });
    if (outcome.status !== 'ok') continue;
    // `Holdings` rather than a structural stand-in with optional fields: an
    // ad-hoc shape turns a rename in `holdings.ts` into a census that quietly
    // reports nothing, and this cast turns it into a typecheck error.
    const held = outcome.resolution as unknown as Holdings;
    // Three doors a pool can have, and all three are read off the sheet
    // rather than assumed: a feature line naming the tool that spends it, a
    // granted spell naming it as what `cast_spell.payment` draws on, and the
    // Hit Die pool `end_rest` takes by name.
    const doored = new Set<string>([
      ...held.features
        .filter((one) => one.spentBy !== null && one.pool !== null)
        .map((one) => one.pool as string),
      ...held.spellcasting.granted
        .map((one) => one.freeCastPool)
        .filter((one): one is string => one !== null),
    ]);
    for (const pool of held.pools) {
      if (!doored.has(pool.key) && !pool.key.startsWith(HIT_DIE)) {
        found.push({ who: member.id, pool: pool.key, label: pool.label });
      }
    }
  }
  return found;
};

// — the session ———————————————————————————————————————————————————————————————

/** Step 1: four characters built and placed, and four Undead put opposite. */
function openTheCrypt(t: Table): void {
  for (const member of PARTY) {
    t.must('create_character', { id: member.id, choices: member.choices });
    t.must('declare_side', { who: member.id, side: 'party' });
  }
  for (const hostile of HOSTILES) {
    t.must('add_creature', { id: hostile.id, monsterId: hostile.monsterId });
    t.must('declare_side', { who: hostile.id, side: 'the-barrow' });
  }

  t.must('set_scene', { width: 80, depth: 60, height: 20 });
  t.must('add_landmark', { name: 'the stair', at: { x: 10, y: 30 } });
  t.must('add_landmark', { name: 'the bier', at: { x: 30, y: 30 } });

  t.must('place_creature', { who: 'bren', fromLandmark: 'the stair', feet: 0 });
  t.must('place_creature', { who: 'brannor', fromCreature: 'bren', feet: 5, bearing: 90 });
  t.must('place_creature', { who: 'pip', fromCreature: 'bren', feet: 5, bearing: 270 });
  t.must('place_creature', { who: 'kessa', fromCreature: 'bren', feet: 10, bearing: 180 });

  t.must('place_creature', { who: 'gravemark', fromLandmark: 'the bier', feet: 0 });
  t.must('place_creature', { who: 'carrion', fromCreature: 'gravemark', feet: 5, bearing: 90 });
  t.must('place_creature', { who: 'rattle', fromCreature: 'gravemark', feet: 10, bearing: 270 });
  t.must('place_creature', { who: 'clatter', fromCreature: 'gravemark', feet: 15, bearing: 180 });

  // Three facts the rules leave to whoever is describing the room.
  // Off to one side rather than between the two lines: a patch in the middle
  // of the only path makes every move `needs-context` for a route, which is
  // `routes.test.ts`'s claim and would be the whole of this session's traffic.
  t.call('declare_difficult_terrain', {
    patch: 'the rubble',
    at: { x: 70, y: 55 },
    radius: 5,
  });
  t.call('declare_cover', { from: 'kessa', to: 'gravemark', degree: 'half' });
  t.call('declare_creature_type', { who: 'gravemark', creatureType: 'Undead' });
  t.dmCall('declare_heads', { who: 'carrion', heads: 1 });
  t.dmCall('award_items', {
    who: 'pip',
    items: [{ id: 'potion-of-healing', quantity: 2 }],
    because: 'the temple sent them out with two',
  });

  // Everybody can see everybody: a crypt with one lit stair, settled once so
  // that Hide and every sight-gated spell has an answer rather than homework.
  const everyone = [...PARTY.map((one) => one.id), ...HOSTILES.map((one) => one.id)];
  for (const from of everyone) {
    for (const to of everyone) {
      if (from !== to) t.must('declare_sight', { from, to, seen: true });
    }
  }
}

/** Step 1b: everybody puts their armour on and draws something. */
function armUp(t: Table): void {
  t.must('equip_item', { who: 'bren', item: 'chain-mail' });
  t.must('equip_item', { who: 'bren', item: 'greatsword' });
  t.must('equip_item', { who: 'brannor', item: 'chain-shirt' });
  t.must('equip_item', { who: 'brannor', item: 'mace' });
  t.must('equip_item', { who: 'brannor', item: 'shield' });
  t.must('equip_item', { who: 'pip', item: 'leather-armor' });
  t.must('equip_item', { who: 'pip', item: 'shortbow' });
  t.must('equip_item', { who: 'kessa', item: 'quarterstaff' });

  // The three free reads, before a die is thrown: the table, each character,
  // and what one of them could legally aim a spell at.
  t.call('look');
  for (const member of PARTY) t.call('sheet', { who: member.id });
  t.call('eligible_targets', { caster: 'brannor', spellId: 'guiding-bolt', slotLevel: 1 });
  t.call('options', { who: 'bren' });
}

// — the debts a turn leaves behind ————————————————————————————————————————————

/**
 * Settle whatever the engine is owed, answering each window through the door
 * that closes it.
 *
 * Bounded rather than a `while (true)`: a window nothing closes is exactly the
 * wedge `claude-integration.md` says a door exists to prevent, and a test that
 * spun for ever on one would report a hang instead of a finding.
 */
function settleDebts(t: Table): void {
  for (let guard = 0; guard < 24; guard += 1) {
    const owed = t.look().owed;
    if (owed.pendingAttack !== null) {
      t.call('settle_attack', { attacker: owed.pendingAttack });
      continue;
    }
    if (owed.pendingDamage !== null) {
      // The window is read rather than guessed: `options` says which Reaction
      // is offered to the creature the blow is aimed at, and Uncanny Dodge is
      // the one this party holds.
      const offers = t.call('options', { who: owed.pendingDamage });
      const answer =
        offers.status === 'ok'
          ? (offers.resolution['reactions'] as readonly { id: string; window: string }[]).find(
              (one) => one.window === 'damage-rolled',
            )
          : undefined;
      // Taken the first time and waved off after that. **The decline branch
      // is written and this session never reaches it**, and the report says
      // so — `decline_damage_reaction` is on its never-used list — because a
      // reaction already spent is offered nothing, so no second window opens
      // to decline. The branch stays because the next party to play this
      // script may hold two.
      if (answer === undefined || t.memo['dodged'] === 'yes') {
        t.call('decline_damage_reaction', {
          who: owed.pendingDamage,
          ...(answer === undefined ? {} : { feature: answer.id }),
        });
      } else {
        t.call('take_damage_reaction', { who: owed.pendingDamage, feature: answer.id });
        t.memo['dodged'] = 'yes';
      }
      t.call('settle_damage');
      continue;
    }
    if (owed.pendingTest !== null) {
      t.dmCall('settle_test');
      continue;
    }
    if (owed.owedAreaEffects > 0 || owed.turnStartUnsettled !== null) {
      t.call('settle_area_effects');
      continue;
    }
    if (owed.strandedSummons.length > 0) {
      t.call('dismiss_stranded_summons');
      continue;
    }
    if (owed.pendingMove !== null) {
      // The first is taken and the rest waved off. Nothing in this barrow
      // ever provoked two at once, so `decline_opportunity` is on the
      // never-used list too; the branch is here for the debt, not the count.
      const owedBy = owed.pendingMove.mustAnswerOpportunityAttack;
      for (const [at, attacker] of owedBy.entries()) {
        if (at === 0) t.call('take_opportunity_attack', { attacker });
        else t.call('decline_opportunity', { attacker });
      }
      continue;
    }
    return;
  }
}

// — whose turn it is, and what they do with it ————————————————————————————————

const standing = (t: Table, side: string): readonly string[] =>
  t
    .look()
    .creatures.filter((one) => one.side === side && !one.dead && one.hp > 0)
    .map((one) => one.id);

/** The nearest creature on the other side, by the feet the engine measured. */
function nearestFoe(t: Table, who: string, side: string): string | null {
  const me = seen(t, who);
  if (me === undefined) return null;
  const foes = standing(t, side)
    .map((id) => ({ id, feet: me.feetTo[id] }))
    .filter((one): one is { id: string; feet: number } => typeof one.feet === 'number')
    .sort((a, b) => a.feet - b.feet);
  return foes[0]?.id ?? null;
}

/**
 * Walk towards somebody, as far as the turn's own budget allows.
 *
 * `move` states where to end up, never how far to travel, so a caller asking
 * to finish five feet from a creature fifty feet away is asking for
 * forty-five feet of movement and is told it has thirty. The arithmetic is
 * the caller's and the engine's answer is the engine's: the gap and the feet
 * left are both read back off `look`.
 */
function closeIn(t: Table, who: string, foe: string): void {
  const me = seen(t, who);
  const gap = me?.feetTo[foe];
  if (typeof gap !== 'number' || gap <= 5) return;
  const budget = me?.budget?.movementFeet ?? 0;
  if (budget <= 0) return;
  // The lattice rounds a walk up and the budget is exact, so the first ask can
  // be five feet too greedy. Two asks, then the creature stays where it is.
  for (const slack of [5, 20]) {
    const want = Math.max(5, gap - budget + slack);
    if (want >= gap) break;
    if (t.call('move', { who, fromCreature: foe, feet: want }).status === 'ok') break;
  }
  settleDebts(t);
}

/** The Fighter: a mastery on every swing, Second Wind, and Extra Attack. */
function brenTurn(t: Table, round: number): void {
  const foe = nearestFoe(t, 'bren', 'the-barrow');
  if (foe === null) return;
  closeIn(t, 'bren', foe);

  if (round === 2) t.call('heal_with_feature', { who: 'bren', feature: 'fighter:second-wind' });
  if (round === 3) {
    t.call('use_free_interaction', { who: 'bren' });
    // A Ready is the Action, so this turn holds no swing. It is released at
    // the top of the next creature's turn, before it lapses at his own.
    const ready = t.call('take_ready', {
      who: 'bren',
      trigger: 'the next thing that steps off the bier',
      response: { kind: 'action', note: 'brace the shield wall and hold the stair' },
    });
    if (ready.status === 'ok') {
      t.memo['ready'] = 'bren';
      return;
    }
  }
  // Action Surge is a pool this surface publishes no door for, which is the
  // measurement rather than an oversight — see the third count.

  // Extra Attack: two swings on the Attack action, each electing the mastery
  // its weapon prints.
  t.call('attack', {
    attacker: 'bren',
    target: foe,
    weapon: 'greatsword',
    twoHanded: true,
    mastery: { property: 'graze' },
  });
  settleDebts(t);
  const second = nearestFoe(t, 'bren', 'the-barrow');
  if (second !== null) {
    t.call('attack', {
      attacker: 'bren',
      target: second,
      weapon: round === 4 ? 'flail' : 'greatsword',
      ...(round === 4 ? { mastery: { property: 'sap' } } : { twoHanded: true, mastery: { property: 'graze' } }),
    });
    settleDebts(t);
  }
}

/** The Cleric: a concentration spell, both halves of Channel Divinity, a cantrip. */
function brannorTurn(t: Table, round: number): void {
  const foe = nearestFoe(t, 'brannor', 'the-barrow');
  if (foe === null) return;
  if (round === 1) {
    const guardians = t.call('cast_spell', {
      caster: 'brannor',
      spellId: 'spirit-guardians',
      targets: [],
      slotLevel: 3,
      damageType: 'radiant',
    });
    if (guardians.status === 'ok' && typeof guardians.resolution['castingId'] === 'string') {
      t.memo['guardians'] = guardians.resolution['castingId'];
    }
  } else if (round === 2) {
    t.call('use_pool_option', {
      who: 'brannor',
      feature: 'cleric:channel-divinity',
      option: 'divine-spark-harm',
      target: foe,
      damageType: 'radiant',
    });
  } else if (round === 3) {
    t.call('cast_spell', {
      caster: 'brannor',
      spellId: 'guiding-bolt',
      targets: [foe],
      slotLevel: 1,
    });
  } else {
    // Turn Undead last, and last on purpose: a barrow full of Frightened and
    // Incapacitated Undead is a fight nothing else in this session can happen
    // in, and every other door needs the fight.
    t.call('use_pool_option', {
      who: 'brannor',
      feature: 'cleric:channel-divinity',
      option: 'turn-undead',
    });
  }
  settleDebts(t);
}

/** The Rogue: all three verbs of Cunning Action, Steady Aim, and Sneak Attack. */
function pipTurn(t: Table, round: number): void {
  const foe = nearestFoe(t, 'pip', 'the-barrow');
  if (foe === null) return;
  if (round === 1) t.call('take_action', { who: 'pip', kind: 'dash', from: 'bonus-action' });
  if (round === 2) t.call('activate_feature', { who: 'pip', feature: 'rogue:steady-aim' });
  if (round === 3) t.call('take_action', { who: 'pip', kind: 'disengage', from: 'bonus-action' });
  if (round === 4) {
    // Hide turns on facts the table holds, so the table states them first:
    // the Rogue drops behind the bier and nothing in the barrow is looking.
    for (const hostile of HOSTILES) {
      t.call('declare_sight', { from: hostile.id, to: 'pip', seen: false });
    }
    t.call('take_action', { who: 'pip', kind: 'hide', from: 'bonus-action', obscured: true });
  }
  settleDebts(t);
  t.call('attack', { attacker: 'pip', target: foe, weapon: 'shortbow' });
  settleDebts(t);
  if (round === 2) t.call('end_feature', { who: 'pip', feature: 'rogue:steady-aim' });
}

/** The Wizard: a held casting, a settled one, a cantrip and Concentration. */
function kessaTurn(t: Table, round: number): void {
  const foe = nearestFoe(t, 'kessa', 'the-barrow');
  if (foe === null) return;
  if (round === 1) {
    t.call('cast_spell', { caster: 'kessa', spellId: 'burning-hands', targets: [], towardsCreature: foe, slotLevel: 1 });
  } else if (round === 2) {
    // A casting made a process, so Counterspell has something to interrupt —
    // and then finished by the caller nobody stopped.
    const held = t.call('cast_spell', {
      caster: 'kessa',
      spellId: 'scorching-ray',
      targets: [foe],
      slotLevel: 2,
      hold: true,
    });
    if (held.status === 'ok' && typeof held.resolution['castingId'] === 'string') {
      t.call('resolve_declared_cast', { castingId: held.resolution['castingId'] });
    }
  } else if (round === 3) {
    t.call('cast_spell', {
      caster: 'kessa',
      spellId: 'web',
      targets: [],
      at: { x: 40, y: 30 },
      towardsCreature: foe,
      slotLevel: 2,
    });
  } else {
    t.call('cast_spell', { caster: 'kessa', spellId: 'fire-bolt', targets: [foe] });
    t.call('end_concentration', { who: 'kessa' });
  }
  settleDebts(t);
}

/**
 * A monster's turn: its own printed lines, elected by name.
 *
 * `attack.action` takes the heading the block prints, never a line the caller
 * wrote, and round 2 reaches for the Actions section through the DM's door —
 * which is where a line the engine applies no part of belongs.
 */
function hostileTurn(t: Table, who: string, round: number): void {
  // Who a monster swings at is the table's, and this table picks the target
  // that opens a window somebody holds a door for: the Wizard in round 2,
  // because a held hit is what Shield answers, and the Rogue in round 3,
  // because a held damage roll is what Uncanny Dodge answers.
  const preferred = round === 2 ? 'kessa' : round === 3 ? 'pip' : null;
  const reachable =
    preferred !== null && standing(t, 'party').includes(preferred) ? preferred : null;
  const foe = reachable ?? nearestFoe(t, who, 'party');
  if (foe === null) return;
  closeIn(t, who, foe);

  const block = seen(t, who)?.printed;
  const lines = block?.actions.filter((one) => !one.expended) ?? [];
  if (lines.length > 0 && t.memo[`line:${who}`] === undefined && round > 1) {
    const took = t.dmCall('take_printed_action', { who, line: lines[0]!.name });
    if (took.status === 'ok') {
      t.memo[`line:${who}`] = lines[0]!.name;
      settleDebts(t);
      return;
    }
  }
  const bonus = block?.bonusActions.filter((one) => !one.expended) ?? [];
  if (bonus.length > 0 && t.memo[`bonus:${who}`] === undefined) {
    const took = t.dmCall('take_printed_bonus_action', { who, line: bonus[0]!.name });
    if (took.status === 'ok') t.memo[`bonus:${who}`] = bonus[0]!.name;
    settleDebts(t);
  }
  const printed = block?.attacks.filter((one) => !one.expended) ?? [];
  if (printed.length === 0) return;

  // **No hold here, and the reason is a finding rather than a choice.** A
  // stat block's attack refuses `hold` outright — `attack-landed` pins a
  // weapon's catalogue id and a printed line has nowhere to go in it — so a
  // party fighting monsters is never offered the window SRD Shield answers.
  // The Wizard's Shield is reachable in this session only off a character's
  // swing, and there is no character swinging at her.
  t.call('attack', { attacker: who, target: foe, action: printed[0]!.name });
  settleDebts(t);
}

const TURNS: Readonly<Record<string, (t: Table, round: number) => void>> = {
  bren: brenTurn,
  brannor: brannorTurn,
  pip: pipTurn,
  kessa: kessaTurn,
};

/** Steps 3–5: Initiative, four rounds, and the fight closed. */
function theFight(t: Table): void {
  t.must('roll_initiative', {
    combatants: [...PARTY.map((one) => ({ who: one.id })), ...HOSTILES.map((one) => ({ who: one.id }))],
  });

  // SRD Alert: swap your Initiative with a willing ally's. Pip has the feat.
  t.call('swap_initiative', { combatant: 'pip', ally: 'kessa', willing: true });

  for (let guard = 0; guard < 80; guard += 1) {
    const observed = t.look();
    const round = observed.round;
    const who = observed.turnOf;
    if (round === null || who === null || round > 4) break;
    if (standing(t, 'the-barrow').length === 0) break;

    const holding = t.memo['ready'];
    if (holding !== undefined && holding !== who) {
      t.call('release_ready', { who: holding });
      delete t.memo['ready'];
      settleDebts(t);
    }

    const alive = seen(t, who);
    if (alive === undefined || alive.dead || alive.hp <= 0) {
      settleDebts(t);
      t.call('end_turn');
      continue;
    }

    // Every turn opens with the two free reads a caller has, and pays off any
    // check an ongoing effect is offering the creature whose turn it is.
    const opening = t.call('options', { who });
    if (opening.status === 'ok') {
      for (const check of opening.resolution['checksAvailable'] as readonly {
        effectKey: string;
      }[]) {
        t.call('attempt_effect_check', { who, effectKey: check.effectKey });
        settleDebts(t);
      }
    }
    const turn = TURNS[who];
    if (turn === undefined) hostileTurn(t, who, round);
    else turn(t, round);
    settleDebts(t);
    t.call('end_turn');
  }

  settleDebts(t);
  const defeated = t.call('end_combat', { ending: { kind: 'defeated' } });
  if (defeated.status !== 'ok') {
    const fled = t.call('end_combat', {
      ending: { kind: 'flight', side: 'the-barrow', letThemGo: true },
    });
    if (fled.status !== 'ok') {
      t.call('end_combat', { ending: { kind: 'surrender', side: 'the-barrow' } });
    }
  }
}

/** The die a class's table prints, which is the only thing a rest asks for. */
const hitDieOf = (classId: string): string =>
  classId === 'fighter' ? 'hit-die:d10' : classId === 'wizard' ? 'hit-die:d6' : 'hit-die:d8';

/**
 * Between the fight and the rest: whoever went down is picked up.
 *
 * Not decoration. `begin_rest` refuses a creature on 0 hit points, because a
 * creature making death saves is not resting — so a party that ends a fight
 * with two of its four on the floor cannot reach step 6 at all until somebody
 * stabilises them and somebody else heals them. Both are doors.
 */
function theAftermath(t: Table): void {
  const guardians = t.memo['guardians'];
  if (guardians !== undefined && seen(t, 'brannor')?.concentratingOn !== null) {
    t.call('end_ongoing_spell', { caster: 'brannor', castingId: guardians });
  }

  // The Cleric first, and not by the Cleric: a healer on the floor is the one
  // creature their own spell list cannot reach, which is what the potions the
  // temple sent them out with are for.
  for (const member of PARTY) {
    const one = seen(t, member.id);
    if (one === undefined || one.dead || one.hp > 0) continue;
    if (!one.stable) t.call('stabilise_creature', { who: member.id });
    if (member.id === 'brannor') {
      t.call('use_item', { who: 'pip', item: 'potion-of-healing', target: 'brannor' });
    } else {
      t.call('cast_spell', {
        caster: 'brannor',
        spellId: 'healing-word',
        targets: [member.id],
        slotLevel: 1,
      });
    }
    settleDebts(t);
  }
  // And the Cleric's free casting, which is a pool spent through `cast_spell`
  // rather than through a door of its own.
  t.call('cast_spell', {
    caster: 'brannor',
    spellId: 'cure-wounds',
    targets: ['brannor'],
    slotLevel: 1,
    source: 'acolyte:magic-initiate-cleric',
    payment: 'free-casting',
  });
  settleDebts(t);
}

/** Steps 6–7: what a Short Rest buys, and then what a Long Rest buys. */
function theRests(t: Table): void {
  for (const member of PARTY) t.call('begin_rest', { who: member.id, kind: 'short' });
  // SRD asks for a Short Rest before a magic item is attuned, so this is the
  // only window in the session where the door opens at all.
  t.call('attune_item', { who: 'kessa', item: 'bracers-of-defense' });
  t.call('advance_time', { hours: 1, because: 'the party binds its wounds in the barrow' });
  for (const member of PARTY) {
    const hp = seen(t, member.id);
    const spend = hp !== undefined && hp.hp < hp.hpMax ? [hitDieOf(member.classId)] : [];
    t.call('end_rest', { who: member.id, hitDice: spend });
  }
  t.call('end_attunement', { who: 'kessa', item: 'bracers-of-defense' });

  // SRD: "You regain one expended use when you finish a Short Rest." That use
  // is what Preserve Life is spent on — the third of Channel Divinity's three
  // options, and the one whose whole effect is a division the caller states
  // and the engine validates without trusting.
  const hurt = t
    .look()
    .creatures.filter((one) => one.side === 'party' && !one.dead && one.hp < one.hpMax / 2);
  if (hurt.length > 0) {
    t.call('use_pool_option', {
      who: 'brannor',
      feature: 'cleric:channel-divinity',
      option: 'preserve-life',
      among: hurt.map((one) => ({ target: one.id, hitPoints: Math.min(5, one.hpMax - one.hp) })),
    });
  }

  for (const member of PARTY) t.call('begin_rest', { who: member.id, kind: 'long' });
  t.call('advance_time', { hours: 8, because: 'a night camped at the stair' });
  t.call('unequip_item', { who: 'bren', item: 'greatsword' });
  for (const member of PARTY) t.call('end_rest', { who: member.id });
  t.call('declare_dawn');
}

/** What the barrow was worth, and what the table ruled on the way out. */
function theSpoils(t: Table): void {
  t.dmCall('award_coin', { who: 'bren', amount: 40, coin: 'gp', because: 'the Wight’s hoard' });
  t.dmCall('award_items', {
    who: 'kessa',
    items: [{ id: 'bracers-of-defense' }],
    because: 'bracers on the bier, under the Wight',
  });
  t.call('purchase_item', { who: 'bren', item: 'torch', quantity: 5 });
  t.call('transfer_item', {
    from: 'pip',
    to: 'kessa',
    item: 'potion-of-healing',
    quantity: 1,
    because: 'the Wizard is the one who keeps falling over',
  });
  t.call('use_item', { who: 'kessa', item: 'potion-of-healing' });
  t.dmCall('take_coin', { who: 'bren', amount: 5, coin: 'gp', because: 'the toll at the gate' });
  t.dmCall('lose_items', {
    who: 'bren',
    items: [{ id: 'torch', quantity: 1 }],
    because: 'one burned down on the stair',
  });

  // A ruling the rules leave open, and its end — the DM's half of the table.
  t.dmCall('rule_condition', {
    who: 'kessa',
    condition: 'poisoned',
    ruling: 'the barrow air is foul and she breathed it',
    until: { kind: 'seconds', seconds: 60 },
  });
  t.dmCall('end_condition', {
    who: 'kessa',
    condition: 'poisoned',
    ruling: 'she reaches the open air',
  });
  t.dmCall('roll_improvised_damage', {
    target: 'bren',
    dice: '2d6',
    damageType: 'bludgeoning',
    ruling: 'the lintel comes down as they leave',
  });
  t.dmCall('improvised_damage', {
    target: 'pip',
    amount: 2,
    ruling: 'a splinter of the same lintel',
  });

  // Tactical Mind: a failed check is the window, and the DM's door both opens
  // and closes it, because only a DC opens one.
  t.dmCall('ability_check', {
    who: 'bren',
    ability: 'str',
    skill: 'athletics',
    dc: 30,
    because: 'heaving the barrow door shut behind them',
  });
  if (t.look().owed.pendingTest !== null) {
    t.call('take_test_reaction', { who: 'bren', feature: 'fighter:tactical-mind' });
    t.dmCall('settle_test');
  }
  t.dmCall('saving_throw', {
    who: 'brannor',
    ability: 'con',
    dc: 12,
    because: 'the dust of the place',
  });
  settleDebts(t);
}

/** Step 8: every one of them to level 6, through the door that takes no number. */
function levelUp(t: Table): readonly ToolOutcome[] {
  const grants = { note: 'nothing beyond the barrow’s own spoils' };
  return [
    t.call('advance_character', {
      who: 'bren',
      toLevel: 6,
      feats: {
        'fighter:ability-score-improvement-2': {
          featId: 'ability-score-improvement',
          abilities: ['dex', 'wis'],
        },
      },
      dmGrants: grants,
    }),
    t.call('advance_character', {
      who: 'brannor',
      toLevel: 6,
      cantrips: ['sacred-flame', 'guidance', 'light', 'thaumaturgy'],
      preparedSpells: [
        'spirit-guardians',
        'inflict-wounds',
        'healing-word',
        'bane',
        'blindness-deafness',
        'hold-person',
        'guiding-bolt',
        'aid',
        'silence',
        'bless',
      ],
      dmGrants: grants,
    }),
    t.call('advance_character', {
      who: 'pip',
      toLevel: 6,
      featureChoices: { 'rogue:second-expertise': ['perception', 'deception'] },
      dmGrants: grants,
    }),
    t.call('advance_character', {
      who: 'kessa',
      toLevel: 6,
      cantrips: ['fire-bolt', 'light', 'prestidigitation', 'ray-of-frost'],
      newSpells: ['fireball', 'dispel-magic'],
      preparedSpells: [
        'magic-missile',
        'shield',
        'mage-armor',
        'misty-step',
        'web',
        'hold-person',
        'fly',
        'counterspell',
        'burning-hands',
        'fireball',
      ],
      dmGrants: grants,
    }),
  ];
}

/** The whole session, in the eight steps the roadmap asks for. */
function playTheSession(seed?: string): Table {
  const t = table(seed);
  openTheCrypt(t);
  armUp(t);
  theFight(t);
  theAftermath(t);
  theSpoils(t);
  theRests(t);
  levelUp(t);
  return t;
}

// — the report ————————————————————————————————————————————————————————————————

/**
 * The three counts, as the run's own transcript reports them.
 *
 * **The pool census goes first, and that ordering is load-bearing.** It reads
 * four sheets, and a read is a call: taken after the clauses were counted, the
 * report would print a call total from one transcript and an `unverified`
 * total from a shorter one. Nothing below this line adds to `sent`.
 */
function report(t: Table): string {
  const shut = poolsWithNoDoor(t);
  const clauses = clausesIn(t.sent);
  const handovers = clauses.filter((one) => one.kind !== 'unmodelled');
  const manual = manualHoldings();

  const lines: string[] = [];
  lines.push('');
  lines.push('— a level 5 session, ship criterion 3 ————————————————————————');
  lines.push(`seed: ${t.campaign.seed}`);
  lines.push(`calls: ${t.sent.length}   events: ${t.campaign.log().length}`);
  const statuses = new Map<string, number>();
  for (const one of t.sent) statuses.set(one.outcome.status, (statuses.get(one.outcome.status) ?? 0) + 1);
  lines.push(`outcomes: ${[...statuses].map(([k, n]) => `${k}=${n}`).join(' ')}`);

  lines.push('');
  lines.push(`1. unverified clauses: ${clauses.length}`);
  for (const one of clauses) lines.push(`   [${one.kind}] ${one.tool}: ${one.line}`);

  lines.push('');
  lines.push(`2. handed over to the DM: ${handovers.length}`);
  for (const one of handovers) {
    const printed = dmDecisionsIn([one.line]);
    lines.push(`   ${one.tool}: ${printed[0] ?? one.line}`);
  }

  lines.push('');
  lines.push(`3. manual features the party held: ${manual.length}`);
  for (const one of manual) {
    lines.push(`   ${one.who} — ${one.name} (${one.feature}): ${one.note}`);
  }
  lines.push(`   engine pools with no door: ${shut.length}`);
  for (const one of shut) lines.push(`   ${one.who} — ${one.pool} (${one.label})`);

  const called = new Set(t.sent.filter((one) => one.outcome.status === 'ok').map((one) => one.tool));
  // Both lists, because `DM_TOOLS` is not a superset: it is `TOOLS` minus
  // `apply_condition`, which `rule_condition` widens. One surface's names
  // would leave that tool out of a list headed "on the two surfaces".
  const published = new Set([
    ...t.player.tools.map((one) => one.name),
    ...t.dm.tools.map((one) => one.name),
  ]);
  const never = [...published].filter((name) => !called.has(name)).sort();
  lines.push('');
  lines.push(`for the record — tools on the two surfaces this session never used: ${never.length}`);
  lines.push(`   ${never.join(', ')}`);

  const refused = t.sent.filter((one) => one.outcome.status !== 'ok');
  lines.push('');
  lines.push(`for the record — calls the session could not complete: ${refused.length}`);
  for (const one of refused) {
    const why =
      one.outcome.status === 'ok'
        ? ''
        : `${one.outcome.status}/${'code' in one.outcome ? one.outcome.code : ''}: ${'reason' in one.outcome ? one.outcome.reason : ''}`;
    lines.push(`   ${one.door}:${one.tool} — ${why.slice(0, 220)}`);
  }
  lines.push('');
  return lines.join('\n');
}

describe('a level 5 party plays a session', () => {
  it('builds the party and the encounter through the surfaces', () => {
    const t = table();
    openTheCrypt(t);

    expect(t.look().creatures).toHaveLength(8);
    expect(t.look().creatures.every((one) => one.placed === true)).toBe(true);
  });

  /**
   * The criterion itself: the session runs, and the three counts are printed.
   *
   * Nothing here asserts a count. The roadmap's own words — "Print the count;
   * assert nothing yet" — because a number asserted the day it is first
   * measured is a number somebody has to edit every time the engine grows,
   * and the phase that drives it to zero is the one that gets to freeze it.
   */
  it('plays the session end to end and prints what it handed over', () => {
    const t = playTheSession();

    // **`process.stdout`, and not `console.log`.** Vitest 4 defaults to
    // `silent: 'passed-only'`: it intercepts the console and drops whatever a
    // *passing* test logged, and it does the same to a task annotation. Both
    // were tried. A count the gauntlet cannot show anybody is a count that
    // does not exist, and a write straight to the stream is the one channel
    // the reporter passes through.
    process.stdout.write(report(t));

    // The session got to the end of itself, and the assertions say so rather
    // than a comment saying so: the fight began and was closed, every one of
    // the four is a level higher than it started, and the log is the log of a
    // session rather than of four characters standing in a room.
    expect(t.look().round).toBeNull();
    expect(t.sent.some((one) => one.tool === 'roll_initiative' && one.outcome.status === 'ok')).toBe(
      true,
    );
    expect(t.sent.some((one) => one.tool === 'end_combat' && one.outcome.status === 'ok')).toBe(true);
    for (const member of PARTY) {
      const sheet = t.call('sheet', { who: member.id });
      expect(sheet.status).toBe('ok');
      if (sheet.status !== 'ok') continue;
      expect(sheet.resolution['level']).toBe(6);
    }
    expect(t.campaign.log().length).toBeGreaterThan(50);
  });

  /**
   * The copy is still the original — see {@link WRITES_THE_HANDOVER}.
   *
   * Not a count and not an assertion about the session: an assertion about
   * the one string this file typed out instead of importing.
   */
  it('reads the same handover mark the engine writes', () => {
    // Counted, not merely found. One site of four reworded is one fifth of
    // count 2 gone in silence, and a `toContain` over a file holding three
    // more would not notice — which is the silence this guard exists for.
    for (const [where, sites] of WRITES_THE_HANDOVER) {
      const text = readFileSync(fileURLToPath(new URL(where, import.meta.url)), 'utf8');
      expect(text.split(BLOCK_HANDOVER)).toHaveLength(sites + 1);
    }
    // And the other mark is imported rather than copied, so it needs no guard
    // — this only says the two are different marks and neither is the other.
    expect(DM_DECIDES).not.toContain(BLOCK_HANDOVER);
  });

  it('replays byte-identically from the same seed', () => {
    const a = playTheSession('a-level-five-session');
    const b = playTheSession('a-level-five-session');
    expect(JSON.stringify(b.campaign.log())).toBe(JSON.stringify(a.campaign.log()));
  });
});
