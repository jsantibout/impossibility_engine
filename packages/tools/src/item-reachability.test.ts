/**
 * Every magic item the engine can use, reachable from the door above it.
 *
 * `reachability.test.ts`'s claim, made of the other catalogue. That file walks
 * every class path and never meets an item, which is how the casting route
 * stood complete for a whole wave with no door onto it: `CastSpellRequest.item`
 * existed, `itemCastOf` read it, and `cast_spell` declared no such field — Zod
 * strips a key it has never heard of, so every wand, cube and crystal ball in
 * the catalogue was transcribed, attunable and unusable, and nothing failed.
 *
 * ## What is claimed
 *
 * Three populations, each **derived from `SRD_MAGIC_ITEMS`** rather than
 * listed, for `doors.test.ts`'s reason: a list stops guarding the day somebody
 * adds to it.
 *
 * | Grant | Reached when |
 * |---|---|
 * | `casts` | handed over with `award_items`, put on with `equip_item` (unless it is used up by the casting — a potion is drunk out of the pack), attuned where the bracket asks, and cast with `cast_spell.item` — the casting the log records is the **item's route** |
 * | `confers` | handed over (and, where it is spent rather than used up, put on and attuned), then used with `use_item` — the use comes back `ok` and lands on the creature it was aimed at |
 * | `standing` | handed over, put on and attuned where the bracket asks, and `sheet` shows it worn and attuned — which is what the benefit is derived from on every read |
 *
 * Every call goes through `surface.call` and nothing else, so an item
 * reachable only by reaching past the door counts as unreachable, which is
 * what it is.
 *
 * **The one hand-written table is the list of what is still shut**, checked
 * in both directions as `reachability.test.ts` checks its own: an item that
 * stops being reachable fails here, and one on the list that becomes
 * reachable fails here too, so the line goes in the same commit as the door
 * that opened it. Each entry says why.
 *
 * It imports no engine: `@ie/content` for the book and `@ie/tools` for the
 * door. What a spell needs aimed at it is read off the definition's own data.
 */

import { describe, expect, it } from 'vitest';
import { SRD_CONTENT, SRD_MAGIC_ITEMS } from '@ie/content';
import { createCampaign, createDmSurface, createSurface, type ToolOutcome } from '@ie/tools';

// — the population ——————————————————————————————————————————————————————————

interface Grant {
  readonly kind: string;
  readonly spell?: string;
  readonly reach?: number;
  readonly charges?: number;
  readonly usedUp?: object;
}

const grantsOf = (item: { readonly grants?: readonly unknown[] }): readonly Grant[] =>
  (item.grants ?? []) as readonly Grant[];

/** Every spell every item casts, one row per item and spell. */
const CASTINGS: readonly { readonly item: string; readonly spell: string }[] =
  SRD_MAGIC_ITEMS.flatMap((item) =>
    grantsOf(item)
      .filter((grant) => grant.kind === 'casts')
      .map((grant) => ({ item: item.id, spell: grant.spell! })),
  );

/** The items that cast anything, which is the number a report counts. */
const CASTING_ITEMS: readonly string[] = [...new Set(CASTINGS.map((one) => one.item))];

const CONFERRING: readonly string[] = SRD_MAGIC_ITEMS.filter((item) =>
  grantsOf(item).some((grant) => grant.kind === 'confers'),
).map((item) => item.id);

const STANDING: readonly string[] = SRD_MAGIC_ITEMS.filter((item) =>
  grantsOf(item).some((grant) => grant.kind === 'standing'),
).map((item) => item.id);

// — who picks it up ————————————————————————————————————————————————————————

const wizard = (name: string): Record<string, unknown> => ({
  name,
  classId: 'wizard',
  level: 3,
  speciesId: 'human',
  backgroundId: 'sage',
  abilities: {
    method: 'standard-array',
    assignment: { str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 10 },
  },
  abilityIncreases: { int: 2, con: 1 },
  classSkills: ['investigation', 'insight'],
  languages: ['Draconic', 'Elvish'],
  alignment: 'Chaotic Good',
  subclassId: 'evoker',
  cantrips: ['fire-bolt', 'light', 'prestidigitation'],
  spellbook: [
    'magic-missile',
    'shield',
    'detect-magic',
    'feather-fall',
    'mage-armor',
    'sleep',
    'thunderwave',
    'hold-person',
    'misty-step',
    'web',
  ].map((spellId, index) => ({
    spellId,
    acquiredAt: index < 6 ? 1 : Math.ceil((index - 5) / 2) + 1,
    origin: 'level' as const,
  })),
  preparedSpells: ['magic-missile', 'shield', 'mage-armor', 'hold-person', 'burning-hands', 'scorching-ray'],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: [],
  hitPoints: { method: 'fixed' },
  featureChoices: {
    'wizard:scholar': ['arcana'],
    'human:skillful': ['perception'],
    'evoker:evocation-savant': ['burning-hands', 'scorching-ray'],
  },
  feats: {
    'sage:magic-initiate-wizard': {
      featId: 'magic-initiate',
      spellList: 'wizard',
      spellcastingAbility: 'int',
      cantrips: ['mage-hand', 'ray-of-frost'],
      levelOneSpell: 'find-familiar',
    },
    'human:versatile': { featId: 'alert' },
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard package only' },
});

/** Trained in every armour, for the items that are armour. */
const fighter = (name: string): Record<string, unknown> => ({
  name,
  classId: 'fighter',
  level: 1,
  speciesId: 'dwarf',
  backgroundId: 'criminal',
  abilities: {
    method: 'standard-array',
    assignment: { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 },
  },
  abilityIncreases: { con: 2, dex: 1 },
  classSkills: ['athletics', 'perception'],
  languages: ['Dwarvish', 'Goblin'],
  alignment: 'Neutral',
  cantrips: [],
  spellbook: [],
  preparedSpells: [],
  classEquipment: 'B',
  backgroundEquipment: 'B',
  equipped: [],
  hitPoints: { method: 'fixed' },
  featureChoices: { 'fighter:weapon-mastery': ['longsword', 'handaxe', 'javelin'] },
  feats: { 'criminal:alert': { featId: 'alert' }, 'fighter:fighting-style': { featId: 'defense' } },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard package only' },
});

/** For an item whose bracket names a Paladin — SRD Holy Avenger. */
const paladin = (name: string): Record<string, unknown> => ({
  name,
  classId: 'paladin',
  level: 3,
  subclassId: 'oath-of-devotion',
  speciesId: 'human',
  backgroundId: 'acolyte',
  abilities: {
    method: 'standard-array',
    assignment: { str: 14, dex: 12, con: 13, int: 8, wis: 10, cha: 15 },
  },
  abilityIncreases: { cha: 2, wis: 1 },
  classSkills: ['athletics', 'persuasion'],
  languages: ['Draconic', 'Elvish'],
  alignment: 'Lawful Good',
  cantrips: [],
  spellbook: [],
  preparedSpells: ['cure-wounds', 'heroism', 'divine-favor', 'bless'],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: [],
  hitPoints: { method: 'fixed' },
  featureChoices: { 'human:skillful': ['perception'] },
  feats: {
    'human:versatile': { featId: 'alert' },
    'paladin:fighting-style': { featId: 'defense' },
    'acolyte:magic-initiate-cleric': {
      featId: 'magic-initiate',
      spellList: 'cleric',
      spellcastingAbility: 'wis',
      cantrips: ['guidance', 'sacred-flame'],
      levelOneSpell: 'bless',
    },
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard package only' },
});

/**
 * For an item whose bracket names neither a Wizard nor a Paladin — SRD Staff of
 * the Woodlands ("by a Druid") and Staff of Healing ("by a Bard, Cleric, or
 * Druid").
 */
const druid = (name: string): Record<string, unknown> => ({
  name,
  classId: 'druid',
  level: 5,
  speciesId: 'human',
  // Not the Sage: its Magic Initiate would hand the druid a second
  // spellcasting ability, and a staff "using your spell save DC" would then ask
  // which — a question for a caller, not for a sweep of the door.
  backgroundId: 'criminal',
  abilities: {
    method: 'standard-array',
    assignment: { str: 10, dex: 13, con: 14, int: 8, wis: 15, cha: 12 },
  },
  abilityIncreases: { con: 2, dex: 1 },
  classSkills: ['nature', 'survival'],
  languages: ['Elvish', 'Dwarvish'],
  alignment: 'Neutral Good',
  subclassId: 'circle-of-the-land',
  cantrips: ['poison-spray', 'guidance', 'produce-flame'],
  spellbook: [],
  preparedSpells: ['cure-wounds', 'healing-word', 'thunderwave', 'hold-person', 'faerie-fire', 'entangle', 'moonbeam', 'goodberry', 'flame-blade'],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: [],
  hitPoints: { method: 'fixed' },
  featureChoices: {
    'human:skillful': ['perception'],
    'druid:primal-order': ['Magician'],
    'druid:primal-order:cantrip': ['mending'],
  },
  feats: {
    'criminal:alert': { featId: 'alert' },
    'human:versatile': { featId: 'savage-attacker' },
    'druid:ability-score-improvement': {
      featId: 'ability-score-improvement',
      abilities: ['wis', 'wis'],
    },
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard package only' },
});

const BUILDERS: Readonly<Record<string, (name: string) => Record<string, unknown>>> = {
  wizard,
  fighter,
  paladin,
  druid,
};

/**
 * Who picks the item up: somebody the item's own line lets use it.
 *
 * A Wizard by default, because most of these want a spellcaster; a Fighter for
 * anything that is armour, because a Wizard in armour it is untrained in casts
 * nothing at all; and the class the bracket names where it names neither —
 * read off the record, never listed here.
 */
function wielderFor(itemId: string): Record<string, unknown> {
  const item = SRD_CONTENT.item(itemId)!;
  const named = item.attunement?.byClass ?? [];
  const preferred = item.armor !== null ? 'fighter' : 'wizard';
  // The first class the bracket names that this file builds: "by a Bard,
  // Cleric, or Druid" is answered by any one of them.
  const classId =
    named.length === 0 || named.includes(preferred)
      ? preferred
      : (named.find((one) => BUILDERS[one] !== undefined) ?? named[0]!);
  const build = BUILDERS[classId];
  if (build === undefined) throw new Error(`${itemId} wants a ${classId}, and this file builds none`);
  return build('Mira');
}

// — a table, a bandit and a wolf ———————————————————————————————————————————

const WIELDER = 'mira';
/** A Humanoid, for the spells that want one. */
const BANDIT = 'grik';
/** A Beast, for the spells that want one. */
const WOLF = 'fang';

/** Where the wielder stands, and the bandit thirty feet east. */
const HALL = { x: 40, y: 100 };
const BANDIT_AT = { x: 70, y: 100 };

function table(seed: string) {
  const campaign = createCampaign({ content: SRD_CONTENT, seed });
  const surface = createSurface(campaign);
  const dm = createDmSurface(campaign);
  let calls = 0;
  const call = (tool: string, input: unknown = {}): ToolOutcome =>
    surface.call({ tool, input, commandId: `toolu_${(calls += 1)}` });
  const rule = (tool: string, input: unknown = {}): ToolOutcome =>
    dm.call({ tool, input, commandId: `dm_${(calls += 1)}` });
  return { surface, call, rule };
}

type Table = ReturnType<typeof table>;

const must = (outcome: ToolOutcome, what: string): Extract<ToolOutcome, { status: 'ok' }> => {
  if (outcome.status !== 'ok') {
    throw new Error(`${what}: ${outcome.status} ${JSON.stringify(outcome).slice(0, 600)}`);
  }
  return outcome;
};

/** A minimal scene: the wielder, a bandit and a wolf, each in sight of the others. */
function scene(seed: string, itemId: string, banditFeet = 30): Table {
  const t = table(seed);
  must(t.call('create_character', { id: WIELDER, choices: wielderFor(itemId) }), 'the wielder');
  must(t.call('add_creature', { id: BANDIT, monsterId: 'bandit' }), 'the bandit');
  must(t.call('add_creature', { id: WOLF, monsterId: 'wolf' }), 'the wolf');
  must(t.call('set_scene', { width: 300, depth: 200, height: 40 }), 'the room');
  must(t.call('add_landmark', { name: 'the hall', at: HALL }), 'the hall');
  must(t.call('place_creature', { who: WIELDER, fromLandmark: 'the hall', feet: 0 }), 'mira');
  must(
    t.call('place_creature', { who: BANDIT, fromCreature: WIELDER, feet: banditFeet, bearing: 90 }),
    'grik',
  );
  must(t.call('place_creature', { who: WOLF, fromCreature: WIELDER, feet: 30, bearing: 0 }), 'fang');
  for (const [from, to] of [
    [WIELDER, BANDIT],
    [BANDIT, WIELDER],
    [WIELDER, WOLF],
    [WOLF, WIELDER],
  ] as const) {
    must(t.call('declare_sight', { from, to, seen: true }), `${from} sees ${to}`);
  }
  return t;
}

const award = (t: Table, itemId: string): void => {
  must(
    t.rule('award_items', { who: WIELDER, items: [{ id: itemId }], because: 'the hoard' }),
    `award ${itemId}`,
  );
};

/**
 * The item handed over, put on and attuned to, exactly as a table would.
 *
 * Every step is the surface's; the bracket is read off the record, because
 * whether an item asks for attunement is the book's and not this file's.
 */
function holding(t: Table, itemId: string): void {
  award(t, itemId);
  must(t.call('equip_item', { who: WIELDER, item: itemId }), `equip ${itemId}`);
  if (SRD_CONTENT.item(itemId)?.attunement !== undefined) {
    must(t.call('begin_rest', { who: WIELDER, kind: 'short' }), 'a short rest');
    must(t.call('attune_item', { who: WIELDER, item: itemId }), `attune ${itemId}`);
  }
}

// — what a spell needs aimed at it ————————————————————————————————————————

interface Definition {
  readonly castingTime: string;
  readonly targets: { readonly count?: number; readonly self?: boolean; readonly mustBeType?: string };
  readonly area?: { readonly kind?: string; readonly origin?: string };
}

const definitionOf = (spellId: string): Definition => {
  const definition = SRD_CONTENT.spell(spellId) as unknown as Definition | null;
  if (definition === null) throw new Error(`${spellId} has no definition`);
  return definition;
};

/** The templates that point somewhere, and so need a direction. */
const DIRECTIONAL = new Set(['cone', 'cube', 'line']);

/**
 * The smallest legal aim at a spell, read off its definition: the caster for
 * a spell that may be cast on them, the wolf for one that wants a Beast, the
 * bandit otherwise; the bandit's square for an area that sits at a point, and
 * a direction for a template that points.
 */
function aimFor(spellId: string): Record<string, unknown> {
  const { targets, area } = definitionOf(spellId);
  const aimed: Record<string, unknown> = {
    targets:
      (targets.count ?? 0) === 0
        ? []
        : [targets.self === true ? WIELDER : targets.mustBeType === 'Beast' ? WOLF : BANDIT],
  };
  const pointing = area?.kind !== undefined && DIRECTIONAL.has(area.kind);
  if (area?.origin === 'point') {
    aimed['at'] = BANDIT_AT;
    if (pointing) aimed['towards'] = { x: BANDIT_AT.x + 20, y: BANDIT_AT.y };
  }
  if (area?.origin === 'self' && pointing) aimed['towardsCreature'] = BANDIT;
  return aimed;
}

/**
 * A fight between the wielder and the bandit, at the turn of whoever is named.
 * The order is the engine's die, so this waits for the turn rather than
 * arranging it.
 */
function fight(t: Table, turnOf: string): void {
  must(t.call('declare_side', { who: WIELDER, side: 'party' }), 'side');
  must(t.call('declare_side', { who: BANDIT, side: 'rivals' }), 'side');
  must(t.call('roll_initiative', { combatants: [{ who: BANDIT }, { who: WIELDER }] }), 'initiative');
  const now = t.surface.observe().turnOf;
  if (now !== turnOf) must(t.call('end_turn', { who: now }), 'the other waits');
}

/** A willing companion at the wielder's elbow, for a spell that carries others. */
function companion(t: Table): void {
  must(t.call('add_creature', { id: 'pip', monsterId: 'bandit' }), 'the companion');
  must(t.call('place_creature', { who: 'pip', fromCreature: WIELDER, feet: 5, bearing: 270 }), 'pip');
  must(t.call('declare_sight', { from: WIELDER, to: 'pip', seen: true }), 'pip seen');
}

/**
 * What a spell asks its caster to state beyond whom it is aimed at, answered
 * the way a caller answering the refusal would — and, for a spell that wants
 * the room arranged first, the arranging. Keyed by spell, because the
 * question is the spell's and not the item's; each is a choice or a fact the
 * engine refuses to make up, never a number.
 */
const STATED: Readonly<
  Record<string, { readonly args?: Record<string, unknown>; readonly setup?: (t: Table) => void }>
> = {
  // SRD Charm Person: Advantage "if you or your allies are fighting it".
  'charm-person': { args: { fought: [] } },
  // SRD Command's five words; the engine will not pick one. Its word lands on
  // "the target's next turn", so there have to be turns.
  command: { setup: (t) => fight(t, WIELDER), args: { option: 'halt' } },
  // SRD Awaken is a touch, so its target stands at the caster's elbow.
  awaken: { setup: companion, args: { targets: ['pip'] } },
  // SRD Lesser Restoration ends one of four conditions, and which is the
  // caster's to name.
  'lesser-restoration': { args: { choice: 'poisoned' } },
  // SRD Mass Cure Wounds: "a 30-foot-radius Sphere centered on a point within
  // range", and the point is the caster's to name.
  'mass-cure-wounds': { args: { at: BANDIT_AT } },
  // SRD Enlarge/Reduce prints both and the engine will not choose.
  'enlarge-reduce': { args: { option: 'enlarge' } },
  // SRD Ray of Enfeeblement lasts "until the start of your next turn", so there
  // have to be turns for it to last until.
  'ray-of-enfeeblement': { setup: (t) => fight(t, WIELDER) },
  // A teleport's destination is the caster's to name.
  'dimension-door': {
    args: { teleportTo: { fromLandmark: 'the hall', feet: 60, bearing: 180 } },
  },
  // "You and up to eight willing creatures": the caster goes anyway, and the
  // companion within reach is the one named.
  'plane-shift': { setup: companion, args: { targets: ['pip'] } },
  teleport: { setup: companion, args: { targets: ['pip'] } },
  // SRD Speak with Plants' two terrain options; the engine will not choose.
  'speak-with-plants': { args: { option: 'clear' } },
  // A corpse within reach, which the DM's door can make.
  resurrection: {
    setup: (t) => {
      must(t.call('add_creature', { id: 'bones', monsterId: 'bandit' }), 'the dead');
      must(
        t.call('place_creature', { who: 'bones', fromCreature: WIELDER, feet: 5, bearing: 180 }),
        'the body',
      );
      must(
        t.rule('improvised_damage', { target: 'bones', amount: 500, ruling: 'long dead' }),
        'the death',
      );
    },
    args: { targets: ['bones'] },
  },
};

// — the still-shut list, checked in both directions ———————————————————————

/**
 * What an item grants that the surface cannot yet reach, and why.
 *
 * Keyed `item:spell` for a casting and `item` for a conferral or a standing
 * benefit.
 */
const STILL_SHUT: Readonly<Record<string, string>> = {};

// — the verdicts ——————————————————————————————————————————————————————————

interface Verdict {
  readonly key: string;
  readonly reached: boolean;
  readonly why: string;
}

/**
 * The routes the casting this call wrote was made by — on `spell-cast` for a
 * spell cast on the spot, and on the declaration for one that takes a minute
 * or more, which is recorded as declared and settled later.
 */
const routesOf = (outcome: ToolOutcome): readonly string[] =>
  outcome.status === 'ok'
    ? outcome.events
        .map((event) => {
          const record = event as {
            readonly route?: unknown;
            readonly casting?: { readonly route?: unknown };
          };
          return record.route ?? record.casting?.route;
        })
        .filter((route): route is string => typeof route === 'string')
    : [];

/**
 * SRD Shield is "a Reaction you take when you are hit by an attack roll", so
 * the moment has to exist before the cube can cast it: a fight, the bandit's
 * swing held on the hit, and then the cast. Whether the swing hits is the
 * engine's die, so this looks for a seed where it does rather than arranging
 * a number.
 */
function reactionCasting(itemId: string, spellId: string): ToolOutcome {
  let last: ToolOutcome | null = null;
  for (let seed = 0; seed < 24; seed += 1) {
    const t = scene(`reach:${itemId}:${spellId}:${seed}`, itemId, 5);
    holding(t, itemId);
    fight(t, BANDIT);
    const swing = t.call('attack', {
      attacker: BANDIT,
      target: WIELDER,
      action: 'Scimitar',
      hold: true,
    });
    last = swing;
    if (swing.status !== 'ok' || swing.resolution['hit'] !== true) continue;
    return t.call('cast_spell', { caster: WIELDER, spellId, targets: [WIELDER], item: itemId });
  }
  return last!;
}

function castingVerdict(itemId: string, spellId: string): Verdict {
  const key = `${itemId}:${spellId}`;
  try {
    let outcome: ToolOutcome;
    if (definitionOf(spellId).castingTime === 'reaction') {
      outcome = reactionCasting(itemId, spellId);
    } else {
      const t = scene(`reach:${key}`, itemId);
      // A casting that uses the item up is drunk out of the pack, which is the
      // fork `conferralVerdict` takes for a bottle; everything else is held.
      const casts = grantsOf(SRD_CONTENT.item(itemId)!).find(
        (grant) => grant.kind === 'casts' && grant.spell === spellId,
      );
      if (casts?.usedUp !== undefined) award(t, itemId);
      else holding(t, itemId);
      STATED[spellId]?.setup?.(t);
      outcome = t.call('cast_spell', {
        caster: WIELDER,
        spellId,
        ...aimFor(spellId),
        ...(STATED[spellId]?.args ?? {}),
        item: itemId,
      });
    }
    const reached = routesOf(outcome).includes(`item:${itemId}`);
    return {
      key,
      reached,
      why: reached ? 'cast from the item' : JSON.stringify(outcome).slice(0, 300),
    };
  } catch (error) {
    return { key, reached: false, why: String(error).slice(0, 300) };
  }
}

function conferralVerdict(itemId: string): Verdict {
  try {
    const t = scene(`reach:${itemId}`, itemId);
    const conferral = grantsOf(SRD_CONTENT.item(itemId)!).find((grant) => grant.kind === 'confers')!;
    // A bottle is drunk out of a pack and a charged thing is spent in hand,
    // which is the fork `useItem` takes; so a bottle is only handed over.
    if (conferral.charges !== undefined) holding(t, itemId);
    else award(t, itemId);
    // Aimed across the reach the item prints, where it prints one, so the
    // distance is what is exercised; at its user otherwise.
    const aimed = conferral.reach === undefined ? WIELDER : BANDIT;
    const outcome = t.call('use_item', {
      who: WIELDER,
      item: itemId,
      ...(aimed === WIELDER ? {} : { target: aimed }),
    });
    const landed =
      outcome.status === 'ok' &&
      (outcome.resolution['outcomes'] as readonly { readonly target: string }[]).some(
        (one) => one.target === aimed,
      );
    return { key: itemId, reached: landed, why: landed ? 'used' : JSON.stringify(outcome).slice(0, 300) };
  } catch (error) {
    return { key: itemId, reached: false, why: String(error).slice(0, 300) };
  }
}

function standingVerdict(itemId: string): Verdict {
  try {
    const t = scene(`reach:${itemId}`, itemId);
    holding(t, itemId);
    const sheet = must(t.call('sheet', { who: WIELDER }), 'sheet').resolution;
    const worn = (sheet['equipped'] as readonly { readonly id: string }[]).some(
      (one) => one.id === itemId,
    );
    const bracketed = SRD_CONTENT.item(itemId)?.attunement !== undefined;
    const attuned = !bracketed || (sheet['attuned'] as readonly string[]).includes(itemId);
    return {
      key: itemId,
      reached: worn && attuned,
      why: worn && attuned ? 'worn' : `worn ${worn}, attuned ${attuned}`,
    };
  } catch (error) {
    return { key: itemId, reached: false, why: String(error).slice(0, 300) };
  }
}

const shutOf = (verdicts: readonly Verdict[]): Record<string, string> =>
  Object.fromEntries(verdicts.filter((one) => !one.reached).map((one) => [one.key, one.why]));

const listedAmong = (keys: readonly string[]): readonly string[] =>
  Object.keys(STILL_SHUT)
    .filter((key) => keys.includes(key))
    .sort();

// — the sweep —————————————————————————————————————————————————————————————

describe('every item that casts a spell casts it through cast_spell.item', () => {
  it('sweeps something', () => {
    expect(CASTING_ITEMS.length).toBeGreaterThan(20);
    expect(CASTINGS).toContainEqual({ item: 'wand-of-fireballs', spell: 'fireball' });
  });

  it('reaches every casting but the ones the still-shut list names, and not those', () => {
    const verdicts = CASTINGS.map((one) => castingVerdict(one.item, one.spell));
    const shut = shutOf(verdicts);
    expect(Object.keys(shut).sort(), JSON.stringify(shut, null, 1)).toEqual(
      listedAmong(verdicts.map((one) => one.key)),
    );
  }, 300_000);
});

describe('every item that confers without casting is used through use_item', () => {
  it('sweeps something', () => {
    expect(CONFERRING).toContain('potion-of-healing');
    expect(CONFERRING).toContain('wand-of-paralysis');
  });

  it('reaches every conferral but the ones the still-shut list names, and not those', () => {
    const shut = shutOf(CONFERRING.map(conferralVerdict));
    expect(Object.keys(shut).sort(), JSON.stringify(shut, null, 1)).toEqual(
      listedAmong(CONFERRING),
    );
  }, 300_000);
});

describe('every item that grants a standing benefit shows on the sheet once worn', () => {
  it('sweeps something', () => {
    expect(STANDING.length).toBeGreaterThan(20);
  });

  it('reaches every standing benefit but the ones the still-shut list names, and not those', () => {
    const shut = shutOf(STANDING.map(standingVerdict));
    expect(Object.keys(shut).sort(), JSON.stringify(shut, null, 1)).toEqual(
      listedAmong(STANDING),
    );
  }, 300_000);
});

describe('the still-shut list', () => {
  it('names only what the catalogue grants, each with a reason', () => {
    const known = new Set([
      ...CASTINGS.map((one) => `${one.item}:${one.spell}`),
      ...CONFERRING,
      ...STANDING,
    ]);
    for (const [key, why] of Object.entries(STILL_SHUT)) {
      expect(known.has(key), key).toBe(true);
      expect(why.length, key).toBeGreaterThan(40);
    }
  });
});
