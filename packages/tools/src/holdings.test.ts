/**
 * What a character holds, and what it can spend — both halves through
 * `surface.call` and nothing else.
 *
 * **This file imports no engine**, which is the same claim `fight.test.ts`
 * makes and for the same reason: a read a caller can only get by reaching
 * past the door is not a door, and a feature a session can only spend from
 * inside the engine is not spendable by a session. `@ie/tools` and
 * `@ie/content` are the whole of the imports.
 *
 * The characters are built from the catalogue rather than written out,
 * because the features under test arrive at Barbarian 1 and 15, Fighter 1,
 * Paladin 1, Warlock 3 and Wizard 10, and a hand-written fixture for each
 * would be four hundred lines about spellbooks and Ability Score
 * Improvements that no assertion here is about. What each test writes by
 * hand is the one choice it is about.
 *
 * Where a character has to be hurt before a healing feature can be seen to
 * heal, the wound is a **DM's** chandelier: two surfaces over one campaign
 * are one campaign, and `improvised_damage` takes an amount somebody
 * adjudicated, so the hit points that come back are measured against a
 * number nothing rolled. Every assertion about a feature's own arithmetic is
 * then against the engine's own roll event — `total - natural` is the
 * Fighter level the rule adds, whatever the die showed.
 */

import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import {
  createCampaign,
  createDmSurface,
  createSurface,
  SPENT_BY,
  TOOL_NAMES,
  type ToolOutcome,
} from '@ie/tools';

// — a character of any class at any level ——————————————————————————————————

const SKILLS = [
  'acrobatics', 'animal-handling', 'arcana', 'athletics', 'deception', 'history', 'insight',
  'intimidation', 'investigation', 'medicine', 'nature', 'perception', 'performance', 'persuasion',
  'religion', 'sleight-of-hand', 'stealth', 'survival',
];

const subclassFor = (classId: string): string =>
  SRD_CONTENT.subclasses.find((one) => one.classId === classId)!.id;

const onList = (classId: string, level: number): readonly string[] =>
  SRD_CONTENT.spells
    .filter(
      (spell) =>
        spell.level === level &&
        (SRD_CONTENT.spellEntry(spell.id)?.classes ?? []).includes(classId),
    )
    .map((spell) => spell.id);

const row = (classId: string, level: number) => SRD_CONTENT.classById(classId)!.table[level - 1]!;

/** A list of exactly `want` spells, the ones this test needs first. */
const filled = (
  want: number,
  needs: readonly string[],
  pool: readonly string[],
): readonly string[] => {
  const out = [...needs.filter((spellId) => pool.includes(spellId))];
  for (const spellId of pool) {
    if (out.length >= want) break;
    if (!out.includes(spellId)) out.push(spellId);
  }
  return out.slice(0, want);
};

const levelled = (classId: string): readonly string[] => {
  const out: string[] = [];
  for (let spellLevel = 1; spellLevel <= 9; spellLevel += 1) out.push(...onList(classId, spellLevel));
  return out;
};

/** The Wizard's book: six at level 1 and two a level after that. */
const bookFor = (classId: string, level: number, needs: readonly string[]) => {
  if (classId !== 'wizard') return [];
  return filled(6 + Math.max(0, level - 1) * 2, needs, levelled('wizard')).map((spellId, index) => ({
    spellId,
    acquiredAt: index < 6 ? 1 : Math.ceil((index - 5) / 2) + 1,
    origin: 'level' as const,
  }));
};

const featuresUpTo = (classId: string, level: number) =>
  [
    ...(SRD_CONTENT.classById(classId)?.features ?? []),
    ...(SRD_CONTENT.subclassById(subclassFor(classId))?.features ?? []),
    ...(SRD_CONTENT.speciesById('human')?.features ?? []),
    ...(SRD_CONTENT.backgroundById('sage')?.features ?? []),
  ].filter((feature) => (feature.level ?? 1) <= level);

/** The first legal answer to every choice the plan asks, whatever they are. */
const autoChoices = (
  classId: string,
  level: number,
  taken: readonly string[],
  needs: readonly string[],
): Record<string, readonly string[]> => {
  const out: Record<string, readonly string[]> = {};
  const used = new Set<string>(taken);
  const known = new Set(bookFor(classId, level, needs).map((entry) => entry.spellId));
  for (const feature of featuresUpTo(classId, level)) {
    const choice = feature.choice;
    if (choice === undefined) continue;
    if (choice.kind === 'skill') {
      const expertise = feature.grants?.kind === 'expertise';
      const from = expertise ? [...used] : (choice.from ?? SKILLS).filter((one) => !used.has(one));
      const picked = from.slice(0, choice.choose);
      if (!expertise) for (const one of picked) used.add(one);
      out[feature.id] = picked;
    } else if (choice.kind === 'option') {
      out[feature.id] = choice.from.slice(0, choice.choose);
    } else if (choice.kind === 'spell') {
      out[feature.id] = SRD_CONTENT.spells
        .filter((spell) => !known.has(spell.id))
        .filter((spell) => (SRD_CONTENT.spellEntry(spell.id)?.classes ?? []).includes(classId))
        .filter(
          (spell) =>
            (choice.school === undefined || spell.school === choice.school) &&
            (choice.maxLevel === undefined || spell.level <= choice.maxLevel) &&
            spell.level > 0,
        )
        .map((spell) => spell.id)
        .slice(0, choice.choose);
    }
  }
  return out;
};

/**
 * A legal feat for every slot the plan asks about, whatever asks.
 *
 * It read the class's Ability Score Improvements and two hand-named Fighting
 * Style slots, which is a rule about the classes somebody happened to build —
 * and `champion:additional-fighting-style` is a slot on a *subclass* that
 * neither half saw. So the slots are taken from the same feature list every
 * other choice is taken from, and answered by the one thing the category says:
 * a Fighting Style where the slot asks for one, and the Ability Score
 * Improvement everywhere else. Each Fighting Style slot gets a different style,
 * because the same feat twice is refused.
 */
const FIGHTING_STYLES: readonly string[] = SRD_CONTENT.feats
  .filter((feat) => feat.category === 'fighting-style')
  .map((feat) => feat.id);

const featSlots = (
  classId: string,
  level: number,
): Record<string, Record<string, unknown>> => {
  const out: Record<string, Record<string, unknown>> = {};
  let styles = 0;
  for (const feature of featuresUpTo(classId, level)) {
    if (feature.choice?.kind !== 'feat') continue;
    // The two the origin asks for, which every character here answers the same
    // way: a Sage's Magic Initiate and a Human's free feat.
    if (feature.id === 'sage:magic-initiate-wizard' || feature.id === 'human:versatile') continue;
    out[feature.id] =
      feature.choice.category === 'fighting-style'
        ? { featId: FIGHTING_STYLES[styles++ % FIGHTING_STYLES.length]! }
        : { featId: 'ability-score-improvement', abilities: ['cha', 'cha'] };
  }
  return out;
};

const skillsFor = (classId: string): readonly string[] => {
  const choices = SRD_CONTENT.classById(classId)!.skillChoices;
  return (choices.from ?? SKILLS).slice(0, choices.choose);
};

const character = (
  classId: string,
  level: number,
  needs: readonly string[] = [],
  over: Record<string, unknown> = {},
): Record<string, unknown> => {
  const classSkills = skillsFor(classId);
  return {
    name: 'Vashti',
    classId,
    level,
    ...(level >= 3 ? { subclassId: subclassFor(classId) } : {}),
    speciesId: 'human',
    backgroundId: 'sage',
    abilities: {
      method: 'standard-array',
      assignment: { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 },
    },
    // Sage offers Constitution, Intelligence and Wisdom, and refuses anything else.
    abilityIncreases: { con: 2, int: 1 },
    classSkills,
    languages: ['Draconic', 'Elvish'],
    alignment: 'Neutral',
    cantrips: filled(row(classId, level).cantripsKnown ?? 0, needs, onList(classId, 0)),
    spellbook: bookFor(classId, level, needs),
    preparedSpells: filled(row(classId, level).preparedSpells ?? 0, needs, levelled(classId)),
    classEquipment: 'A',
    backgroundEquipment: 'A',
    equipped: [],
    hitPoints: { method: 'fixed' },
    featureChoices: autoChoices(classId, level, classSkills, needs),
    feats: {
      'sage:magic-initiate-wizard': {
        featId: 'magic-initiate',
        spellList: 'wizard',
        spellcastingAbility: 'int',
        cantrips: ['mage-hand', 'ray-of-frost'],
        levelOneSpell: 'find-familiar',
      },
      'human:versatile': { featId: 'alert' },
      ...featSlots(classId, level),
    },
    dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
    ...over,
  };
};

/** An Evoker whose Intelligence modifier is a number worth seeing: 17, so +3. */
const EVOKER_INT_MODIFIER = 3;
const evoker = () =>
  character('wizard', 10, ['fire-bolt', 'mage-armor'], {
    abilities: {
      method: 'standard-array',
      assignment: { str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 10 },
    },
    abilityIncreases: { int: 2, con: 1 },
  });

/**
 * Every class the catalogue publishes, and the level the sweep builds them at.
 *
 * Ten, because that is where the last of the spendable kinds arrives: SRD
 * Empowered Evocation is a Wizard 10 feature and the only elective one a
 * catalogue party reaches below fourteen. Everything else the sweep cares
 * about — Channel Divinity at 2, Second Wind at 1, Lay On Hands at 1, Magical
 * Cunning at 2 — is long since granted by then.
 */
const EVERY_CLASS: readonly string[] = SRD_CONTENT.classes.map((one) => one.id);
const SWEPT_LEVEL = 10;

// — a table, and a caller that numbers its own ids as a transport would ————

function table(seed = 'holdings') {
  const campaign = createCampaign({ content: SRD_CONTENT, seed });
  const surface = createSurface(campaign);
  const dm = createDmSurface(campaign);
  let calls = 0;

  const call = (tool: string, input: unknown = {}): ToolOutcome =>
    surface.call({ tool, input, commandId: `toolu_${(calls += 1)}` });

  /** The DM's door, over the same campaign, for the one thing a model may not do. */
  const rule = (tool: string, input: unknown = {}): ToolOutcome =>
    dm.call({ tool, input, commandId: `dm_${(calls += 1)}` });

  return { campaign, surface, call, rule };
}

/** One character of every class in the book, each named for its class. */
function wholeCatalogue(seed = 'catalogue') {
  const t = table(seed);
  for (const classId of EVERY_CLASS) {
    expectOk(t.call('create_character', { id: classId, choices: character(classId, SWEPT_LEVEL) }));
  }
  return t;
}

const expectOk = (outcome: ToolOutcome) => {
  if (outcome.status !== 'ok') {
    throw new Error(
      `expected ok, got ${outcome.status}: ${JSON.stringify(outcome, null, 2).slice(0, 900)}`,
    );
  }
  return outcome;
};

const expectRefused = (outcome: ToolOutcome) => {
  if (outcome.status !== 'refused') {
    throw new Error(
      `expected refused, got ${outcome.status}: ${JSON.stringify(outcome, null, 2).slice(0, 900)}`,
    );
  }
  return outcome;
};

// — reading the report ——————————————————————————————————————————————————————

interface Slot {
  readonly level: number;
  readonly max: number;
  readonly spent: number;
  readonly left: number;
}
interface Pool {
  readonly key: string;
  readonly label: string;
  readonly max: number;
  readonly spent: number;
  readonly left: number;
  readonly recovers: string;
}
interface Feature {
  readonly feature: string;
  readonly name: string;
  readonly kind: string;
  readonly spentBy: string | null;
  readonly pool: string | null;
  readonly left: number | null;
  readonly active: boolean;
}

const sheetOf = (t: ReturnType<typeof table>, who: string) => {
  const outcome = expectOk(t.call('sheet', { who }));
  const held = outcome.resolution;
  return {
    all: held,
    slots: held['spellSlots'] as readonly Slot[],
    pactSlots: held['pactSlots'] as readonly Slot[],
    pools: held['pools'] as readonly Pool[],
    features: held['features'] as readonly Feature[],
    pool: (key: string) => (held['pools'] as readonly Pool[]).find((one) => one.key === key),
    feature: (id: string) => (held['features'] as readonly Feature[]).find((one) => one.feature === id),
    slot: (level: number) => (held['spellSlots'] as readonly Slot[]).find((one) => one.level === level),
  };
};

/** The engine's own roll event for a feature, out of what the call returned. */
const rollIn = (outcome: ToolOutcome, label: string) => {
  if (outcome.status !== 'ok') throw new Error('not an ok outcome');
  const found = outcome.events.find(
    (event) => event.type === 'roll-recorded' && event.label.includes(label),
  );
  if (found === undefined || found.type !== 'roll-recorded') {
    throw new Error(`no roll labelled ${label} in ${JSON.stringify(outcome.events).slice(0, 600)}`);
  }
  return found;
};

const hpOf = (t: ReturnType<typeof table>, who: string): number =>
  t.surface.observe().creatures.find((one) => one.id === who)!.hp;

// — part one: what a character holds ————————————————————————————————————————

describe('a character can be asked what it holds', () => {
  it('reports spell slots by level, before and after a casting spends one', () => {
    const t = table();
    expectOk(t.call('create_character', { id: 'vashti', choices: evoker() }));
    expectOk(t.call('set_scene', { width: 60, depth: 40, height: 20 }));
    expectOk(t.call('add_landmark', { name: 'the bar', at: { x: 10, y: 10 } }));
    expectOk(t.call('place_creature', { who: 'vashti', fromLandmark: 'the bar', feet: 0 }));

    const before = sheetOf(t, 'vashti');
    expect(before.slot(1)).toEqual({ level: 1, max: 4, spent: 0, left: 4 });
    expect(before.slot(5)).toEqual({ level: 5, max: 2, spent: 0, left: 2 });

    expectOk(
      t.call('cast_spell', {
        caster: 'vashti',
        spellId: 'mage-armor',
        targets: ['vashti'],
        slotLevel: 1,
      }),
    );

    const after = sheetOf(t, 'vashti');
    expect(after.slot(1)).toEqual({ level: 1, max: 4, spent: 1, left: 3 });
    expect(after.slot(5)).toEqual({ level: 5, max: 2, spent: 0, left: 2 });
  });

  /**
   * Pact Magic is a different resource at the same level, which is why
   * `cast_spell.slotKind` exists — and a Warlock reading a report that folded
   * the two together would be told it had slots it does not have.
   */
  it('reports Pact slots as a pool of their own', () => {
    const t = table();
    expectOk(t.call('create_character', { id: 'nim', choices: character('warlock', 3, ['hex']) }));

    const held = sheetOf(t, 'nim');
    expect(held.slots).toEqual([]);
    expect(held.pactSlots).toEqual([{ level: 2, max: 2, spent: 0, left: 2 }]);
  });

  it('reports a feature pool, and what is left of it after a use is spent', () => {
    const t = table();
    expectOk(t.call('create_character', { id: 'grum', choices: character('barbarian', 3) }));

    const before = sheetOf(t, 'grum');
    expect(before.pool('rage')).toMatchObject({ label: 'Rage', max: 3, spent: 0, left: 3 });
    expect(before.feature('barbarian:rage')).toMatchObject({ left: 3, active: false });

    expectOk(t.call('activate_feature', { who: 'grum', feature: 'barbarian:rage' }));

    const after = sheetOf(t, 'grum');
    expect(after.pool('rage')).toMatchObject({ max: 3, spent: 1, left: 2 });
    expect(after.feature('barbarian:rage')).toMatchObject({ left: 2, active: true });
  });

  it('says which features can be switched on and which are only ever passive', () => {
    const t = table();
    expectOk(t.call('create_character', { id: 'grum', choices: character('barbarian', 3) }));
    const held = sheetOf(t, 'grum');

    expect(held.feature('barbarian:rage')).toMatchObject({
      name: 'Rage',
      kind: 'activated',
      spentBy: 'activate_feature',
      pool: 'rage',
      // Every bound the activation prints, including the one nothing enforces:
      // SRD "You can maintain a Rage for up to 10 minutes" is a number on the
      // sheet that no engine command reads, so a caller that wants it kept has
      // to be told it, and `extend_feature` says as much.
      lasts: 'end-of-next-turn',
      endsOn: ['incapacitated', 'heavy-armor'],
      capSeconds: 600,
    });
    expect(held.feature('barbarian:danger-sense')).toMatchObject({
      name: 'Danger Sense',
      kind: 'passive',
      spentBy: null,
      pool: null,
    });
  });

  /**
   * The same closing of a loop `Establish.tools` makes: a feature a caller is
   * told it holds and can find no door for is half a door.
   *
   * **The party is the catalogue and not a cast.** It was five hand-picked
   * characters — a Barbarian, a Paladin, a Fighter, a Warlock and an Evoker —
   * and a Cleric's Channel Divinity was therefore invisible to it for the whole
   * of the week the engine could execute Turn Undead and nothing could ask it
   * to. A guard over a hand-chosen party guards that party; a guard over the
   * book guards whatever the book grows. So every class the content publishes
   * is created, at the level {@link SWEPT_LEVEL} says, and both sides of the
   * claim are derived: the kinds observed come off the sheets, and the kinds
   * expected come off `SPENT_BY`, which is the surface's own record of what
   * spends what. A sixth kind with no tool fails here; so does a kind that
   * exists in the record and nothing in the catalogue grants.
   */
  it('names, for every feature it can spend, a tool this surface really has', () => {
    const t = wholeCatalogue();

    const spendable = EVERY_CLASS.flatMap((classId) =>
      sheetOf(t, classId).features.filter((one) => one.spentBy !== null),
    );
    // Non-vacuous, and exhaustive over the kinds the surface claims to spend:
    // a party holding none of one of them would make the sweep silent about it.
    expect([...new Set(spendable.map((one) => one.kind))].sort()).toEqual(
      Object.keys(SPENT_BY).sort(),
    );
    for (const one of spendable) expect(TOOL_NAMES).toContain(one.spentBy);
  });

  /**
   * And the sweep is aimed at something: the class that was invisible to the
   * old one holds a feature, of the kind that was missing, with a door.
   */
  it('and the Cleric the old party had no room for is in it', () => {
    const t = wholeCatalogue();
    expect(sheetOf(t, 'cleric').feature('cleric:channel-divinity')).toMatchObject({
      name: 'Channel Divinity',
      kind: 'pool-option',
      spentBy: 'use_pool_option',
      pool: 'channel-divinity',
    });
  });

  it('reports the features a casting may elect, which is the field that elects them', () => {
    const t = table();
    expectOk(t.call('create_character', { id: 'vashti', choices: evoker() }));
    const held = sheetOf(t, 'vashti');

    // SRD Empowered Evocation is "you can", so the casting names it or it adds
    // nothing; Potent Cantrip is not a choice and is nobody's to elect.
    expect(held.feature('evoker:empowered-evocation')).toMatchObject({
      kind: 'casting-election',
      spentBy: 'cast_spell',
    });
    expect(held.feature('evoker:potent-cantrip')).toMatchObject({
      kind: 'passive',
      spentBy: null,
    });
  });

  /**
   * A caster that cannot see its own list types spell ids from memory, and the
   * two refusals that ask *which route* casts a spell — `class_required` and
   * `payment_required` — name fields whose answers are only visible here.
   */
  it('reports what the character can cast, and by which route', () => {
    const t = table();
    expectOk(t.call('create_character', { id: 'vashti', choices: evoker() }));
    const casting = sheetOf(t, 'vashti').all['spellcasting'] as {
      readonly classes: readonly {
        readonly classId: string;
        readonly ability: string;
        readonly slotKind: string;
        readonly cantrips: readonly string[];
        readonly prepared: readonly string[];
      }[];
      readonly granted: readonly {
        readonly spellId: string;
        readonly source: string;
        readonly freeCastPool: string | null;
        readonly left: number | null;
      }[];
    };

    expect(casting.classes).toHaveLength(1);
    expect(casting.classes[0]).toMatchObject({ classId: 'wizard', ability: 'int', slotKind: 'spell' });
    expect(casting.classes[0]!.cantrips).toContain('fire-bolt');
    expect(casting.classes[0]!.prepared).toContain('mage-armor');

    // Magic Initiate's level 1 spell: a route of its own, with a pool that pays
    // for it once a day — which is what `cast_spell.payment` chooses between.
    const granted = casting.granted.find((one) => one.spellId === 'find-familiar')!;
    expect(granted.source).toBe('sage:magic-initiate-wizard');
    expect(granted.freeCastPool).not.toBeNull();
    expect(granted.left).toBe(1);
  });

  it('reports hit points, conditions and the turn budget beside them', () => {
    const t = table();
    expectOk(t.call('create_character', { id: 'grum', choices: character('barbarian', 3) }));
    const held = sheetOf(t, 'grum').all;

    expect(held['who']).toBe('grum');
    expect(held['level']).toBe(3);
    expect(typeof held['hp']).toBe('number');
    expect(held['hp']).toBe(held['hpMax']);
    expect(held['temporaryHp']).toBe(0);
    expect(held['conditions']).toEqual([]);
    expect(typeof held['armorClass']).toBe('number');
    // No fight, so there is no action economy and the report says so rather
    // than inventing an empty one.
    expect(held['budget']).toBeNull();
  });

  it('is free: it writes nothing, throws nothing and spends no die', () => {
    const t = table();
    expectOk(t.call('create_character', { id: 'grum', choices: character('barbarian', 3) }));
    const before = { log: t.campaign.log().length, rolls: t.campaign.state().rollsIssued };

    const outcome = expectOk(t.call('sheet', { who: 'grum' }));
    expect(outcome.events).toEqual([]);
    expect(t.campaign.log()).toHaveLength(before.log);
    expect(t.campaign.state().rollsIssued).toBe(before.rolls);
  });

  it('asks rather than refuses when nobody has created the character', () => {
    const t = table();
    const outcome = t.call('sheet', { who: 'nobody' });
    expect(outcome.status).toBe('needs-context');
    if (outcome.status !== 'needs-context') return;
    expect(outcome.establish[0]!.kind).toBe('creature');
    expect(outcome.establish[0]!.tools).toContain('create_character');
  });
});

// — part two: what a character can spend ————————————————————————————————————

describe('a Barbarian can rage', () => {
  const raging = () => {
    const t = table('rage');
    expectOk(t.call('create_character', { id: 'grum', choices: character('barbarian', 3) }));
    return t;
  };

  it('enters it, spends a use, and the feature reads as running', () => {
    const t = raging();
    const outcome = expectOk(t.call('activate_feature', { who: 'grum', feature: 'barbarian:rage' }));

    expect(outcome.resolution['activated']).toBe('barbarian:rage');
    expect(outcome.events.some((event) => event.type === 'feature-activated')).toBe(true);
    expect(sheetOf(t, 'grum').pool('rage')!.left).toBe(2);
    expect(sheetOf(t, 'grum').feature('barbarian:rage')!.active).toBe(true);
  });

  /** SRD: "as a Bonus Action" — and the action economy exists only in a fight. */
  it('spends the Bonus Action when there is one to spend', () => {
    const t = raging();
    expectOk(t.call('create_character', { id: 'foe', choices: character('fighter', 3) }));
    expectOk(t.call('roll_initiative', { combatants: [{ who: 'grum' }, { who: 'foe' }] }));

    expectOk(t.call('activate_feature', { who: 'grum', feature: 'barbarian:rage' }));
    const budget = t.surface.observe().creatures.find((one) => one.id === 'grum')!.budget!;
    expect(budget.bonusAction).toBe(false);
    expect(budget.action).toBe(true);
  });

  it('can be extended, and dismissed, and the report follows both', () => {
    const t = raging();
    expectOk(t.call('activate_feature', { who: 'grum', feature: 'barbarian:rage' }));

    // Out of combat the extension costs nothing and there is no deadline to
    // push, so it writes nothing — which is still an answer rather than a throw.
    expectOk(t.call('extend_feature', { who: 'grum', feature: 'barbarian:rage', by: 'attack' }));
    expect(sheetOf(t, 'grum').feature('barbarian:rage')!.active).toBe(true);

    expectOk(t.call('end_feature', { who: 'grum', feature: 'barbarian:rage' }));
    expect(sheetOf(t, 'grum').feature('barbarian:rage')!.active).toBe(false);
    // Ending refunds nothing: the use is spent.
    expect(sheetOf(t, 'grum').pool('rage')!.left).toBe(2);
  });

  it('runs out of Rages, and says so in a way a caller can act on', () => {
    const t = raging();
    for (const time of [1, 2, 3]) {
      expectOk(t.call('activate_feature', { who: 'grum', feature: 'barbarian:rage' }));
      expectOk(t.call('end_feature', { who: 'grum', feature: 'barbarian:rage' }));
      expect(sheetOf(t, 'grum').pool('rage')!.left).toBe(3 - time);
    }

    const outcome = expectRefused(t.call('activate_feature', { who: 'grum', feature: 'barbarian:rage' }));
    expect(outcome.code).toBe('exhausted');
    expect(outcome.reason).toContain('Rage');
    // A refusal spends nothing.
    expect(sheetOf(t, 'grum').pool('rage')!.left).toBe(0);
  });

  it('refuses a feature the character has not got, naming it', () => {
    const t = raging();
    expectOk(t.call('create_character', { id: 'bram', choices: character('fighter', 3) }));

    const outcome = expectRefused(t.call('activate_feature', { who: 'bram', feature: 'barbarian:rage' }));
    expect(outcome.code).toBe('no_such_feature');
    expect(outcome.reason).toContain('barbarian:rage');
  });
});

describe('a Fighter can take a Second Wind', () => {
  it('rolls its die, adds the Fighter level and gives the hit points back', () => {
    const t = table('second-wind');
    expectOk(t.call('create_character', { id: 'bram', choices: character('fighter', 3) }));
    // A chandelier, adjudicated by a DM: the model's door deals no damage.
    expectOk(t.rule('improvised_damage', { target: 'bram', amount: 20, ruling: 'the chandelier' }));

    const hurt = hpOf(t, 'bram');
    const outcome = expectOk(t.call('heal_with_feature', { who: 'bram', feature: 'fighter:second-wind' }));

    // The arithmetic, not the die: whatever 1d10 showed, the total is the roll
    // plus the Fighter level, and the hit points restored are that total.
    const roll = rollIn(outcome, 'Second Wind');
    expect(roll.total - roll.natural).toBe(3);
    expect(hpOf(t, 'bram')).toBe(hurt + roll.total);
    expect(sheetOf(t, 'bram').pool('second-wind')!.left).toBe(1);
  });

  it('runs out of uses, and the refusal spends neither a use nor a die', () => {
    const t = table('second-wind-empty');
    expectOk(t.call('create_character', { id: 'bram', choices: character('fighter', 3) }));
    expectOk(t.rule('improvised_damage', { target: 'bram', amount: 30, ruling: 'the chandelier' }));
    expectOk(t.call('heal_with_feature', { who: 'bram', feature: 'fighter:second-wind' }));
    expectOk(t.call('heal_with_feature', { who: 'bram', feature: 'fighter:second-wind' }));
    expect(sheetOf(t, 'bram').pool('second-wind')!.left).toBe(0);

    const before = { hp: hpOf(t, 'bram'), rolls: t.campaign.state().rollsIssued };
    const outcome = expectRefused(t.call('heal_with_feature', { who: 'bram', feature: 'fighter:second-wind' }));
    expect(outcome.code).toBe('exhausted');
    expect(hpOf(t, 'bram')).toBe(before.hp);
    expect(t.campaign.state().rollsIssued).toBe(before.rolls);
  });
});

describe('a Paladin can lay on hands', () => {
  const chapel = () => {
    const t = table('lay-on-hands');
    expectOk(t.call('create_character', { id: 'ser', choices: character('paladin', 3) }));
    expectOk(t.call('create_character', { id: 'bram', choices: character('fighter', 3) }));
    expectOk(t.rule('improvised_damage', { target: 'bram', amount: 8, ruling: 'the chandelier' }));
    return t;
  };

  /**
   * SRD: "restore a number of Hit Points to that creature, up to the maximum
   * amount remaining in the pool" — a number of the Paladin's own points, and
   * the only quantity on this whole surface that leaves a caller's hands.
   */
  it('draws hit points out of the pool and puts them in an ally', () => {
    const t = chapel();
    const hurt = hpOf(t, 'bram');

    expectOk(
      t.call('draw_on_healing_pool', {
        who: 'ser',
        feature: 'paladin:lay-on-hands',
        target: 'bram',
        hitPoints: 5,
      }),
    );

    expect(hpOf(t, 'bram')).toBe(hurt + 5);
    expect(sheetOf(t, 'ser').pool('lay-on-hands')).toMatchObject({ max: 15, spent: 5, left: 10 });
  });

  /**
   * SRD: "expend 5 Hit Points from the pool of healing power to remove the
   * Poisoned condition; those points don't also restore Hit Points." So a
   * drawing of 3 with a lifting costs 8 and heals 3.
   */
  it('lifts a condition at its own price, and those points heal nothing', () => {
    const t = chapel();
    expectOk(t.call('apply_condition', { who: 'bram', condition: 'poisoned', ruling: 'the bad wine' }));
    const hurt = hpOf(t, 'bram');

    expectOk(
      t.call('draw_on_healing_pool', {
        who: 'ser',
        feature: 'paladin:lay-on-hands',
        target: 'bram',
        hitPoints: 3,
        lift: ['poisoned'],
      }),
    );

    expect(hpOf(t, 'bram')).toBe(hurt + 3);
    expect(sheetOf(t, 'ser').pool('lay-on-hands')).toMatchObject({ spent: 8, left: 7 });
    expect(t.surface.observe().creatures.find((one) => one.id === 'bram')!.conditions).toEqual([]);
  });

  it('refuses a drawing larger than the pool, and spends none of it', () => {
    const t = chapel();
    const hurt = hpOf(t, 'bram');

    const outcome = expectRefused(
      t.call('draw_on_healing_pool', {
        who: 'ser',
        feature: 'paladin:lay-on-hands',
        target: 'bram',
        hitPoints: 40,
      }),
    );
    expect(outcome.code).toBe('exhausted');
    expect(hpOf(t, 'bram')).toBe(hurt);
    expect(sheetOf(t, 'ser').pool('lay-on-hands')!.left).toBe(15);
  });
});

describe('a Warlock can regain what a feature gives back', () => {
  const pact = () => {
    const t = table('pact');
    expectOk(t.call('create_character', { id: 'nim', choices: character('warlock', 3, ['hex']) }));
    expectOk(t.call('create_character', { id: 'bram', choices: character('fighter', 3) }));
    expectOk(t.call('set_scene', { width: 60, depth: 40, height: 20 }));
    expectOk(t.call('add_landmark', { name: 'the circle', at: { x: 10, y: 10 } }));
    expectOk(t.call('place_creature', { who: 'nim', fromLandmark: 'the circle', feet: 0 }));
    expectOk(t.call('place_creature', { who: 'bram', fromCreature: 'nim', feet: 15, bearing: 0 }));
    expectOk(t.call('declare_sight', { from: 'nim', to: 'bram', seen: true }));
    return t;
  };

  /**
   * SRD Magical Cunning: "you can regain all expended Pact Magic spell slots
   * ... no more than a number equal to half your maximum (round up)". How much
   * comes back is the feature's own sentence; the call names no number.
   */
  it('gives a Pact slot back, and the amount is the feature’s, not the caller’s', () => {
    const t = pact();
    expectOk(t.call('cast_spell', { caster: 'nim', spellId: 'hex', targets: ['bram'], slotLevel: 2 }));
    expect(sheetOf(t, 'nim').pactSlots).toEqual([{ level: 2, max: 2, spent: 1, left: 1 }]);

    const outcome = expectOk(t.call('regain_uses', { who: 'nim', feature: 'warlock:magical-cunning' }));
    expect(outcome.resolution['regained']).toBe(1);
    expect(sheetOf(t, 'nim').pactSlots).toEqual([{ level: 2, max: 2, spent: 0, left: 2 }]);
    expect(sheetOf(t, 'nim').pool('warlock:magical-cunning')!.left).toBe(0);
  });

  it('refuses a second use, because the feature’s own pool is empty', () => {
    const t = pact();
    expectOk(t.call('cast_spell', { caster: 'nim', spellId: 'hex', targets: ['bram'], slotLevel: 2 }));
    expectOk(t.call('regain_uses', { who: 'nim', feature: 'warlock:magical-cunning' }));

    const outcome = expectRefused(t.call('regain_uses', { who: 'nim', feature: 'warlock:magical-cunning' }));
    expect(outcome.code).toBe('exhausted');
  });

  it('refuses when there is nothing expended to give back', () => {
    const t = pact();
    const outcome = expectRefused(t.call('regain_uses', { who: 'nim', feature: 'warlock:magical-cunning' }));
    expect(outcome.code).toBe('nothing_to_regain');
    expect(sheetOf(t, 'nim').pool('warlock:magical-cunning')!.left).toBe(1);
  });
});

/**
 * SRD Channel Divinity, which is a pool with a menu: one use, several named
 * purchases, and an effect list behind each of them.
 *
 * The pool has been declared, sized and refilled correctly since pools landed,
 * and what a use *bought* was executed by nothing until this week. The engine
 * executes it now, which is what makes a door here honest rather than a room
 * with nothing in it: `sheet` reports the options and `use_pool_option` spends
 * one.
 */
describe('a Cleric can be told to turn undead', () => {
  const chapel = (seed: string) => {
    const t = table(seed);
    expectOk(t.call('create_character', { id: 'ilsa', choices: character('cleric', 5) }));
    expectOk(t.call('add_creature', { id: 'bones', monsterId: 'skeleton' }));
    expectOk(t.call('set_scene', { width: 60, depth: 40, height: 20 }));
    expectOk(t.call('add_landmark', { name: 'the altar', at: { x: 10, y: 10 } }));
    expectOk(t.call('place_creature', { who: 'ilsa', fromLandmark: 'the altar', feet: 0 }));
    expectOk(t.call('place_creature', { who: 'bones', fromCreature: 'ilsa', feet: 15, bearing: 0 }));
    return t;
  };

  /**
   * The report first, because a caller that has not been told the menu cannot
   * name an item off it: the feature carries its options and the tool that
   * spends them.
   */
  it('reports the menu a use buys, and the tool that spends one', () => {
    const t = chapel('turn-undead');
    const held = sheetOf(t, 'ilsa');

    expect(held.pool('channel-divinity')).toMatchObject({ label: 'Channel Divinity', left: 2 });
    expect(held.feature('cleric:channel-divinity')).toMatchObject({
      kind: 'pool-option',
      spentBy: 'use_pool_option',
      action: 'action',
      pool: 'channel-divinity',
      left: 2,
    });
    const options = (
      held.feature('cleric:channel-divinity') as unknown as {
        readonly options: readonly { readonly option: string; readonly name: string }[];
      }
    ).options;
    // Four, because the Life Domain's Preserve Life is a **form of Channel
    // Divinity** rather than a feature with a pool of its own — a subclass
    // adding an option to the base feature's menu, which is what the holder
    // sees here.
    expect(options.map((one) => one.option)).toEqual([
      'turn-undead',
      'divine-spark-restore',
      'divine-spark-harm',
      'preserve-life',
    ]);
  });

  /**
   * SRD: "Each Undead of your choice within 30 feet of you ... must make a
   * Wisdom saving throw. If the creature fails its save, it has the Frightened
   * and Incapacitated conditions for 1 minute."
   *
   * The DC is the Cleric's own and the save is the skeleton's; the call names
   * neither. What is asserted is the save happening against the creature the
   * emanation caught, and the use coming out of the pool.
   */
  it('censures the Undead in the emanation, and spends one use of the pool', () => {
    const t = chapel('turn-undead');

    const outcome = expectOk(
      t.call('use_pool_option', {
        who: 'ilsa',
        feature: 'cleric:channel-divinity',
        option: 'turn-undead',
      }),
    );

    expect(outcome.resolution['used']).toBe('turn-undead');
    const outcomes = outcome.resolution['outcomes'] as readonly { readonly target: string }[];
    expect(outcomes.map((one) => one.target)).toEqual(['bones']);
    // The engine rolled the skeleton's save; the caller sent no number and
    // reads none back but the one the log carries.
    expect(outcome.events.some((event) => event.type === 'roll-recorded')).toBe(true);
    expect(sheetOf(t, 'ilsa').pool('channel-divinity')!.left).toBe(1);
  });

  /**
   * SRD Divine Spark deals "Necrotic or Radiant damage (your choice)", and the
   * engine refuses to choose. The refusal names the field that answers it, and
   * the answer is the same call with that field filled in — which is
   * `damageType` doing on a feature exactly what it does on a casting.
   */
  it('refuses the choice it will not make for the caller, and spends nothing', () => {
    const t = chapel('divine-spark');
    const before = {
      pool: sheetOf(t, 'ilsa').pool('channel-divinity')!.left,
      rolls: t.campaign.state().rollsIssued,
    };

    const refusal = expectRefused(
      t.call('use_pool_option', {
        who: 'ilsa',
        feature: 'cleric:channel-divinity',
        option: 'divine-spark-harm',
        target: 'bones',
      }),
    );
    expect(refusal.code).toBe('damage_type_required');
    expect(sheetOf(t, 'ilsa').pool('channel-divinity')!.left).toBe(before.pool);
    expect(t.campaign.state().rollsIssued).toBe(before.rolls);

    // And the same call again, with the field the refusal named, goes through.
    const answered = expectOk(
      t.call('use_pool_option', {
        who: 'ilsa',
        feature: 'cleric:channel-divinity',
        option: 'divine-spark-harm',
        target: 'bones',
        damageType: 'radiant',
      }),
    );
    expect(answered.events.some((event) => event.type === 'damage-taken')).toBe(true);
    expect(sheetOf(t, 'ilsa').pool('channel-divinity')!.left).toBe(before.pool - 1);
  });

  it('refuses an option the feature does not offer, naming the ones it does', () => {
    const t = chapel('no-such-option');
    const refusal = expectRefused(
      t.call('use_pool_option', {
        who: 'ilsa',
        feature: 'cleric:channel-divinity',
        option: 'smite-the-heretic',
      }),
    );
    expect(refusal.code).toBe('no_such_option');
    expect(refusal.reason).toContain('turn-undead');
    expect(sheetOf(t, 'ilsa').pool('channel-divinity')!.left).toBe(2);
  });

  /**
   * And a Paladin's Channel Divinity is still shut, which is the honest half
   * of this door: the pool is declared and what a use buys is executed by
   * nothing, so the feature offers no option and reports no tool to spend it.
   */
  it('leaves shut the pool whose options nothing executes', () => {
    const t = table('paladin-cd');
    expectOk(t.call('create_character', { id: 'ser', choices: character('paladin', 5) }));
    const held = sheetOf(t, 'ser');

    expect(held.pool('channel-divinity')).toMatchObject({ label: 'Channel Divinity' });
    expect(held.feature('paladin:channel-divinity')).toBeUndefined();
  });
});

describe('a casting can elect a feature its caster holds', () => {
  const study = (seed: string) => {
    const t = table(seed);
    expectOk(t.call('create_character', { id: 'vashti', choices: evoker() }));
    expectOk(t.call('create_character', { id: 'bram', choices: character('fighter', 5) }));
    expectOk(t.call('set_scene', { width: 60, depth: 40, height: 20 }));
    expectOk(t.call('add_landmark', { name: 'the bar', at: { x: 10, y: 10 } }));
    expectOk(t.call('place_creature', { who: 'vashti', fromLandmark: 'the bar', feet: 0 }));
    expectOk(t.call('place_creature', { who: 'bram', fromCreature: 'vashti', feet: 15, bearing: 0 }));
    expectOk(t.call('declare_sight', { from: 'vashti', to: 'bram', seen: true }));
    return t;
  };

  const firebolt = (t: ReturnType<typeof table>, using?: readonly string[]) =>
    t.call('cast_spell', {
      caster: 'vashti',
      spellId: 'fire-bolt',
      targets: ['bram'],
      ...(using === undefined ? {} : { usingFeatures: using }),
    });

  /**
   * SRD Empowered Evocation: "you can add your Intelligence modifier to one
   * damage roll of that spell."
   *
   * Two campaigns on one seed throw the same dice, so the whole of the
   * difference between them is the rule — and the rule is a modifier the
   * engine read off the sheet, not a number anybody sent.
   */
  it('adds exactly what the feature adds, and nothing when it is not elected', () => {
    const plain = study('elect');
    const damageWithout = expectOk(firebolt(plain)).events
      .filter((event) => event.type === 'damage-taken')
      .reduce((sum, event) => sum + (event.type === 'damage-taken' ? event.amount : 0), 0);

    const elected = study('elect');
    const damageWith = expectOk(firebolt(elected, ['evoker:empowered-evocation'])).events
      .filter((event) => event.type === 'damage-taken')
      .reduce((sum, event) => sum + (event.type === 'damage-taken' ? event.amount : 0), 0);

    expect(damageWithout).toBeGreaterThan(0);
    expect(damageWith - damageWithout).toBe(EVOKER_INT_MODIFIER);
  });

  /** A feature this caster has no claim to is a refusal naming it. */
  it('refuses a feature the caster has not got, and spends no slot', () => {
    const t = study('elect');
    const outcome = expectRefused(firebolt(t, ['evoker:overchannel']));
    expect(outcome.code).toBe('no_such_feature');
    expect(outcome.reason).toContain('evoker:overchannel');
    expect(hpOf(t, 'bram')).toBe(sheetOf(t, 'bram').all['hpMax']);
  });
});
