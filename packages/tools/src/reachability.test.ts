/**
 * Everything the engine executes, reachable from the door above it.
 *
 * `docs/ROADMAP.md` ship criterion 2: *everything executed is reachable*. A
 * feature the engine runs and no caller can reach is worse than one nobody
 * wrote — it passes every test the engine has, it is counted as done, and a
 * session holding it can do nothing with it. Action Surge was exactly that
 * for a week: `useBudgetPurchase` was complete, tested and on the barrel, and
 * no tool on either surface called it.
 *
 * ## What is claimed
 *
 * One character of **every path the catalogue publishes** — a class and a
 * subclass — built at level 5 through `create_character`, read back through
 * `sheet`, and every feature it holds that claims `automation: 'engine'` is
 * one of five things:
 *
 * | Reach | What it means |
 * |---|---|
 * | *spendable* | the sheet names a tool this surface really has |
 * | *a Reaction* | the sheet names a window {@link TAKEN_BY} answers |
 * | *passive* | a standing benefit that is never anybody's to spend |
 * | *joins a menu* | its options are compiled onto another feature's line, which is spendable |
 * | *at creation* | pinned onto the sheet when the character was made, and read by the engine from there |
 *
 * Anything else is a room with no door, and the test fails naming it.
 *
 * ## Why both sides are derived
 *
 * The population is read out of the catalogue — the class's features, the
 * chosen subclass's, the species' and the background's, at the level they
 * arrive — rather than listed here, for `doors.test.ts`'s reason: a list
 * stops guarding the day somebody adds to it. The verdicts are read off the
 * `sheet` the surface really publishes, through `surface.call` and nothing
 * else, so a feature reachable only by reaching past the door counts as
 * unreachable, which is what it is.
 *
 * **The one hand-written table is the list of what is still shut**, and it is
 * checked in both directions: a feature that stops being reachable fails
 * here, and a feature in the table that becomes reachable fails here too, so
 * the line has to be deleted in the same commit as the door that opened it.
 * Every entry is a pool the engine holds and nothing yet executes what a use
 * of it buys — the rule that kept Channel Divinity, Bardic Inspiration and
 * Action Surge shut, and the reason the first two stopped being on this list.
 *
 * It imports no engine: `@ie/content` for the book and `@ie/tools` for the
 * door, which is the same claim `holdings.test.ts` makes.
 */

import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { createCampaign, createSurface, TAKEN_BY, TOOL_NAMES, type ToolOutcome } from '@ie/tools';

/**
 * The grants one feature carries, whether it wrote one or a list.
 *
 * Normalised here rather than imported, because this file imports no engine —
 * `featureGrants` is the engine's own copy of these three lines.
 */
interface Granted {
  readonly kind: string;
  readonly feature?: string;
  readonly options?: readonly { readonly id: string }[];
  readonly amends?: readonly { readonly option: string }[];
  /** The option of the feature's own question this grant belongs to. */
  readonly onlyIfChoice?: string;
}

const grantsOf = (feature: { readonly grants?: unknown }): readonly Granted[] => {
  const grants = feature.grants;
  if (grants === undefined) return [];
  return (Array.isArray(grants) ? grants : [grants]) as readonly Granted[];
};

/**
 * Every question a feature asks, and where its answer is filed.
 *
 * {@link grantsOf}'s neighbour, normalised here for the same reason: a feature
 * may ask more than one thing — SRD Divine Order asks which order and, of one
 * order, which extra cantrip — and this file imports no engine.
 */
const questionsOf = <Q,>(feature: {
  readonly choice?: Q;
  readonly choices?: readonly Q[];
}): readonly Q[] => feature.choices ?? (feature.choice === undefined ? [] : [feature.choice]);

/** The key an answer is filed under: the feature's id, or its id and the question's key. */
const answerKey = (featureId: string, key: string | undefined): string =>
  key === undefined ? featureId : `${featureId}:${key}`;

// — a character of any path at level 5 —————————————————————————————————————

const LEVEL = 5;

const SKILLS = [
  'acrobatics', 'animal-handling', 'arcana', 'athletics', 'deception', 'history', 'insight',
  'intimidation', 'investigation', 'medicine', 'nature', 'perception', 'performance', 'persuasion',
  'religion', 'sleight-of-hand', 'stealth', 'survival',
];

/**
 * A path: a class and one of its subclasses.
 *
 * Derived rather than the twelve written out, and keyed by the **subclass**,
 * because a thirteenth subclass is a thirteenth path with features of its own
 * — and a path nobody builds is a path nothing here is claimed about.
 */
interface Path {
  readonly classId: string;
  readonly subclassId: string;
}

const PATHS: readonly Path[] = SRD_CONTENT.subclasses.map((one) => ({
  classId: one.classId,
  subclassId: one.id,
}));

const onList = (classId: string, level: number): readonly string[] =>
  SRD_CONTENT.spells
    .filter(
      (spell) =>
        spell.level === level &&
        (SRD_CONTENT.spellEntry(spell.id)?.classes ?? []).includes(classId),
    )
    .map((spell) => spell.id);

const row = (classId: string, level: number) => SRD_CONTENT.classById(classId)!.table[level - 1]!;

/** A list of exactly `want` spells, whichever the book offers first. */
const filled = (want: number, pool: readonly string[]): readonly string[] => pool.slice(0, want);

const levelled = (classId: string): readonly string[] => {
  const out: string[] = [];
  for (let spellLevel = 1; spellLevel <= 9; spellLevel += 1) out.push(...onList(classId, spellLevel));
  return out;
};

/** The Wizard's book: six at level 1 and two a level after that. */
const bookFor = (classId: string, level: number) => {
  if (classId !== 'wizard') return [];
  return filled(6 + Math.max(0, level - 1) * 2, levelled('wizard')).map((spellId, index) => ({
    spellId,
    acquiredAt: index < 6 ? 1 : Math.ceil((index - 5) / 2) + 1,
    origin: 'level' as const,
  }));
};

/** Every feature this path holds at this level, from all four sources. */
const featuresUpTo = (path: Path, level: number) =>
  [
    ...(SRD_CONTENT.classById(path.classId)?.features ?? []),
    ...(SRD_CONTENT.subclassById(path.subclassId)?.features ?? []),
    ...(SRD_CONTENT.speciesById('human')?.features ?? []),
    ...(SRD_CONTENT.backgroundById('sage')?.features ?? []),
  ].filter((feature) => (feature.level ?? 1) <= level);

/** The first legal answer to every choice the plan asks, whatever they are. */
const autoChoices = (
  path: Path,
  level: number,
  taken: readonly string[],
): Record<string, readonly string[]> => {
  const out: Record<string, readonly string[]> = {};
  const used = new Set<string>(taken);
  const known = new Set(bookFor(path.classId, level).map((entry) => entry.spellId));
  for (const feature of featuresUpTo(path, level)) {
    for (const choice of questionsOf(feature)) {
      // Asked only of whoever took the option it names, which is the answer to
      // the first question — already written by the time this one is reached.
      if (
        choice.onlyIfChoice !== undefined &&
        !(out[feature.id] ?? []).includes(choice.onlyIfChoice)
      ) {
        continue;
      }
      const at = answerKey(feature.id, choice.key);
      if (choice.kind === 'skill') {
        const expertise = grantsOf(feature).some((grant) => grant.kind === 'expertise');
        const from = expertise ? [...used] : (choice.from ?? SKILLS).filter((one) => !used.has(one));
        const picked = from.slice(0, choice.choose);
        if (!expertise) for (const one of picked) used.add(one);
        out[at] = picked;
      } else if (choice.kind === 'option') {
        out[at] = choice.from.slice(0, choice.choose);
      } else if (choice.kind === 'spell') {
        const wantsCantrip = choice.maxLevel === 0;
        out[at] = SRD_CONTENT.spells
          .filter((spell) => !known.has(spell.id))
          .filter((spell) =>
            (SRD_CONTENT.spellEntry(spell.id)?.classes ?? []).includes(path.classId),
          )
          .filter(
            (spell) =>
              (choice.school === undefined || spell.school === choice.school) &&
              (choice.maxLevel === undefined || spell.level <= choice.maxLevel) &&
              (wantsCantrip ? spell.level === 0 : spell.level > 0),
          )
          .map((spell) => spell.id)
          .slice(0, choice.choose);
      }
    }
  }
  return out;
};

const FIGHTING_STYLES: readonly string[] = SRD_CONTENT.feats
  .filter((feat) => feat.category === 'fighting-style')
  .map((feat) => feat.id);

/**
 * A legal feat for every slot the plan asks about, whatever asks.
 *
 * The slots are taken from the same feature list every other choice is, so a
 * slot on a subclass is answered like one on a class; each Fighting Style
 * slot gets a different style, because the same feat twice is refused.
 */
const featSlots = (path: Path, level: number): Record<string, Record<string, unknown>> => {
  const out: Record<string, Record<string, unknown>> = {};
  let styles = 0;
  for (const feature of featuresUpTo(path, level)) {
    if (feature.choice?.kind !== 'feat') continue;
    // The two the origin asks for, answered the same way by every path here.
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

const character = (path: Path, level: number): Record<string, unknown> => {
  const classSkills = skillsFor(path.classId);
  return {
    name: `The ${path.subclassId}`,
    classId: path.classId,
    level,
    subclassId: path.subclassId,
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
    cantrips: filled(row(path.classId, level).cantripsKnown ?? 0, onList(path.classId, 0)),
    spellbook: bookFor(path.classId, level),
    preparedSpells: filled(row(path.classId, level).preparedSpells ?? 0, levelled(path.classId)),
    classEquipment: 'A',
    backgroundEquipment: 'A',
    equipped: [],
    hitPoints: { method: 'fixed' },
    featureChoices: autoChoices(path, level, classSkills),
    feats: {
      'sage:magic-initiate-wizard': {
        featId: 'magic-initiate',
        spellList: 'wizard',
        spellcastingAbility: 'int',
        cantrips: ['mage-hand', 'ray-of-frost'],
        levelOneSpell: 'find-familiar',
      },
      'human:versatile': { featId: 'alert' },
      ...featSlots(path, level),
    },
    dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
  };
};

// — the party, and what the surface says it holds —————————————————————————

interface HeldFeature {
  readonly feature: string;
  readonly name: string;
  readonly kind: string;
  readonly spentBy: string | null;
  readonly alsoSpentBy?: readonly string[];
  readonly window?: string;
  readonly options?: readonly { readonly option: string }[];
}

interface HeldSheet {
  readonly features: readonly HeldFeature[];
  readonly castingClasses: readonly string[];
}

const expectOk = (outcome: ToolOutcome) => {
  if (outcome.status !== 'ok') {
    throw new Error(
      `expected ok, got ${outcome.status}: ${JSON.stringify(outcome, null, 2).slice(0, 900)}`,
    );
  }
  return outcome;
};

/** One character of every path, created and read back through the door. */
function everyPath(seed = 'reachability'): ReadonlyMap<string, HeldSheet> {
  const campaign = createCampaign({ content: SRD_CONTENT, seed });
  const surface = createSurface(campaign);
  let calls = 0;
  const call = (tool: string, input: unknown): ToolOutcome =>
    surface.call({ tool, input, commandId: `toolu_${(calls += 1)}` });

  const sheets = new Map<string, HeldSheet>();
  for (const path of PATHS) {
    expectOk(call('create_character', { id: path.subclassId, choices: character(path, LEVEL) }));
    const sheet = expectOk(call('sheet', { who: path.subclassId })).resolution;
    const casting = sheet['spellcasting'] as {
      readonly classes: readonly { readonly classId: string }[];
    };
    sheets.set(path.subclassId, {
      features: sheet['features'] as readonly HeldFeature[],
      castingClasses: casting.classes.map((one) => one.classId),
    });
  }
  return sheets;
}

// — the five ways a feature is reachable ——————————————————————————————————

/**
 * The grants that are **pinned onto the sheet when the character is made**,
 * and the reason each is nobody's to elect.
 *
 * A caller says nothing to use any of these: the engine reads the number off
 * the record every time the rule applies. They are listed by grant kind
 * rather than by feature id, so a thirteenth class granting Extra Attack is
 * covered by the same line, and a grant kind nobody has classified falls
 * through to the list of rooms with no door — which is the direction that
 * hurts, and is the point.
 */
const AT_CREATION: Readonly<Record<string, string>> = {
  expertise: 'a doubled proficiency bonus on skills chosen at creation; every check reads it',
  spells: 'spells added to what the character can cast, reported under `spellcasting.granted`',
  'weapon-mastery': 'the mastery properties this character may use, chosen at creation and named on a swing',
  'extra-attack': 'the number of attacks an Attack action buys, which `resolveAttack` counts down',
  'unarmored-defense': 'an alternative base Armour Class, which `armorClassOf` reads',
  'hit-point-maximum':
    'hit points added to the maximum when the character was made, which every level recomputes',
  'strike-style': 'SRD Martial Arts: the die and the Bonus Action strike an Unarmed Strike reads',
  'critical-range': 'SRD Improved Critical: the natural roll a hit crits on, read by the attack pipeline',
  'ability-score-increase': 'an ability score raised at creation; every modifier derived from it follows',
  'save-proficiency': 'saving throws this character is proficient in, read by every save it rolls',
  'weapon-and-armor-training':
    'weapon categories and armour training added when the character was made, which `proficientWith` and every armour check read',
  initiative: 'a bonus the engine adds when Initiative is rolled, which no caller states',
  'on-dropping-a-hostile':
    'SRD Dark One’s Blessing: Temporary Hit Points the engine pays the moment an enemy reaches 0 Hit Points, on the sheet from creation and stated by no caller',
  'lifts-conditions': 'conditions a feature ends, lifted by the engine at the moment it names',
  'long-rest-length':
    'how long a Long Rest takes this creature, written onto the sheet at creation and read by `end_rest`',
};

/**
 * And the shapes that grant nothing at all and are still creation's.
 *
 * A feature with no grant is a question the plan asked and the character
 * answered: which subclass, which feat, which skills — or the one feature
 * that *is* the casting, which is proved rather than assumed by the sheet
 * reporting a route for the class.
 */
const spellcastingFeatureOf = (classId: string): string | null => {
  const casting = SRD_CONTENT.classById(classId)?.spellcasting;
  if (casting === undefined) return null;
  return `${classId}:${casting.feature ?? 'spellcasting'}`;
};

type Reach =
  | { readonly how: 'spendable'; readonly door: string }
  | { readonly how: 'reaction'; readonly door: string }
  | { readonly how: 'passive' }
  | { readonly how: 'joins-a-menu'; readonly host: string }
  | { readonly how: 're-asked-on-a-rest'; readonly door: string }
  | { readonly how: 'at-creation'; readonly why: string }
  | { readonly how: 'unreachable'; readonly why: string };

/**
 * How a caller reaches one feature, or why it cannot.
 *
 * The order is the order of evidence: what the surface *says* first, and what
 * the definition says only where the surface says nothing. A feature the
 * sheet reports as spendable is spendable whatever its grant looks like.
 */
function reachOf(
  path: Path,
  feature: ReturnType<typeof featuresUpTo>[number],
  sheet: HeldSheet,
): Reach {
  const line = sheet.features.find((one) => one.feature === feature.id);
  // A Reaction before the door check, because its line now names its door —
  // the tool that answers its window — and what this sweep wants to say about
  // it is that it is reached through a window rather than at will.
  if (line !== undefined && line.kind === 'reaction') {
    const window = line.window ?? '';
    const door = (TAKEN_BY as Readonly<Record<string, string>>)[window];
    return door === undefined
      ? { how: 'unreachable', why: `a Reaction in a window nothing answers: ${window}` }
      : { how: 'reaction', door };
  }
  if (line !== undefined && line.spentBy !== null) {
    return { how: 'spendable', door: line.spentBy };
  }
  if (line !== undefined && line.kind === 'passive') return { how: 'passive' };

  // Every grant the feature carries, because a feature may carry more than one
  // — and a second grant nobody can reach is the same room with no door as a
  // first one would be.
  //
  // **Except one belonging to an option this character did not take.** SRD
  // Divine Order prints two orders and this party's Cleric is a Protector, so
  // the Thaumaturge's benefits are not on their sheet to be reached: asking
  // this sheet for them would report a room with no door in a house nobody
  // built. The gate is read off the answers the character was made with.
  const taken = new Set(autoChoices(path, LEVEL, [])[feature.id] ?? []);
  const grants = grantsOf(feature).filter(
    (one) => one.onlyIfChoice === undefined || taken.has(one.onlyIfChoice),
  );

  // A menu compiled onto somebody else's line: SRD Preserve Life is a door
  // onto Channel Divinity's menu, so it is spent by naming the *host* feature
  // and this option. The host has to really print every option this grant
  // declares, and the host's own line has to name a tool.
  const menu = grants.find((one) => one.kind === 'pool-options');
  if (menu !== undefined) {
    const host = sheet.features.find((one) => one.feature === menu.feature);
    const printed = new Set((host?.options ?? []).map((one) => one.option));
    // Both halves of the door: a form this grant **adds** has to be reachable
    // by name, and a form it **amends** has to be one the host really prints —
    // SRD Sear Undead changes Turn Undead, and an amendment naming a form
    // nobody wrote would change nothing and say nothing.
    const missing = [
      ...(menu.options ?? []).map((one) => one.id),
      ...(menu.amends ?? []).map((one) => one.option),
    ].filter((one) => !printed.has(one));
    if (host === undefined || host.spentBy === null) {
      return { how: 'unreachable', why: `its menu joins ${menu.feature}, which names no tool` };
    }
    if (missing.length > 0) {
      return { how: 'unreachable', why: `${menu.feature} prints none of ${missing.join(', ')}` };
    }
    return { how: 'joins-a-menu', host: menu.feature ?? '' };
  }

  // A question a rest re-asks, which is `end_rest`'s door and nobody else's:
  // SRD Circle of the Land Spells and SRD Memorize Spell are answered by
  // ending a rest, and neither is spent from a pool, hung on the sheet or
  // taken as a Reaction. Such a feature also carries the grants its answer
  // selects — the four lands' spell lists — which are creation's, so the kind
  // joins the reached set below rather than returning ahead of it: a *second*
  // grant nobody can reach is still the room with no door this sweep is for.
  const rest = grants.find((one) => one.kind === 'rechosen-on-a-rest');

  if (grants.length > 0) {
    const unreached = grants.filter(
      (one) => AT_CREATION[one.kind] === undefined && one.kind !== 'rechosen-on-a-rest',
    );
    const first = unreached[0];
    if (first !== undefined) {
      return { how: 'unreachable', why: `a ${first.kind} grant that reaches no tool and no sheet line` };
    }
    if (rest !== undefined) return { how: 're-asked-on-a-rest', door: 'end_rest' };
    return {
      how: 'at-creation',
      why: [...new Set(grants.map((one) => AT_CREATION[one.kind]))].join('; '),
    };
  }

  // A feature that declares nothing of its own and names the one whose
  // declaration executes it. SRD Tactical Shift is the first of these in a
  // level 1\u20135 character's reach: its sentence rides on a use of Second
  // Wind, so it is reached through Second Wind's own door \u2014 and the feet it
  // hands over are spent by naming the grant on `move`.
  if (feature.executedBy !== undefined) {
    const host = sheet.features.find((one) => one.feature === feature.executedBy);
    if (host?.spentBy != null) return { how: 'spendable', door: host.spentBy };
    return {
      how: 'unreachable',
      why: `it is executed by ${feature.executedBy}, which names no tool`,
    };
  }

  if (feature.grantsSubclass === true) {
    return { how: 'at-creation', why: 'the subclass, chosen when the character is made' };
  }
  if (feature.grantsFeat !== undefined) {
    return { how: 'at-creation', why: `the ${feature.grantsFeat.featId} feat, taken at creation` };
  }
  if (feature.choice?.kind === 'feat') {
    return { how: 'at-creation', why: 'a feat or a Fighting Style, taken at creation' };
  }
  if (feature.choice?.kind === 'skill') {
    return { how: 'at-creation', why: 'proficiencies, chosen at creation' };
  }
  if (feature.id === spellcastingFeatureOf(path.classId)) {
    return sheet.castingClasses.includes(path.classId)
      ? { how: 'at-creation', why: 'the casting itself: `sheet` reports the route and `cast_spell` takes it' }
      : { how: 'unreachable', why: 'the class casts and the sheet reports no route for it' };
  }

  return { how: 'unreachable', why: 'it grants nothing the surface reports and asks for nothing' };
}

/**
 * The pools the engine holds that nothing yet spends, and why each is shut.
 *
 * **A narrow, named allowance and not a widening of the claim.** Each of
 * these is a feature whose whole content is a pool: the uses are counted, the
 * rest gives them back, and what a use *buys* is either unbuilt or prints
 * nothing this engine executes. The rule is the surface's own — "a pool a
 * caller can spend for no effect is worse than one it cannot spend, because
 * the use would be gone" — so the door waits on the mechanism, and the entry
 * here is what makes the wait deliberate rather than forgotten.
 *
 * The table is checked in both directions below, so opening one of these
 * deletes its line in the same commit.
 */
const NOTHING_TO_BUY: Readonly<Record<string, string>> = {};
// **The record is empty and the machinery stays.** A Paladin's Channel
// Divinity was the one entry it ever held, and it left the way the Cleric's
// did: Divine Sense is an activation on the pool the feature declares, so the
// sheet reports it as spendable through `activate_feature` and the sweep below
// finds no unreachable feature at all. A pool that closes is written down here
// rather than argued about, and the guard is checked in both directions — so a
// feature that stopped being reachable fails rather than being excused.

// — the sweep ——————————————————————————————————————————————————————————————

describe('every feature the engine executes can be reached from the door', () => {
  const sweep = () => {
    const sheets = everyPath();
    const found: { path: Path; feature: string; reach: Reach }[] = [];
    for (const path of PATHS) {
      const sheet = sheets.get(path.subclassId)!;
      for (const feature of featuresUpTo(path, LEVEL)) {
        if (feature.automation !== 'engine') continue;
        found.push({ path, feature: feature.id, reach: reachOf(path, feature, sheet) });
      }
    }
    return found;
  };

  /**
   * Non-vacuity, in the three ways this sweep could quietly stop measuring:
   * a party that was not built, a population that was not read, and a
   * classifier that answered everything the same way.
   *
   * Every one of the five reaches is really observed, so a branch that
   * stopped firing — the menu that joins another feature's is the fragile one
   * — would fail here rather than silently excuse whatever it used to catch.
   */
  it('sweeps something: every path in the book, and the features it holds', () => {
    const found = sweep();
    expect(PATHS.length).toBeGreaterThan(11);
    expect(new Set(found.map((one) => one.path.classId)).size).toBe(PATHS.length);
    expect(found.length).toBeGreaterThan(80);
    const observed = new Set(found.map((one) => one.reach.how));
    for (const how of [
      'spendable',
      'reaction',
      'passive',
      'joins-a-menu',
      'at-creation',
      're-asked-on-a-rest',
    ]) {
      expect([...observed]).toContain(how);
    }
  });

  /**
   * The claim itself. A feature that reaches nothing is named with the path
   * that holds it, because the same feature id under two subclasses is two
   * different characters' problem.
   */
  it('leaves no engine feature a caller cannot reach, beyond the pools recorded as shut', () => {
    const shut = sweep()
      .filter((one) => one.reach.how === 'unreachable')
      .filter((one) => NOTHING_TO_BUY[one.feature] === undefined)
      .map((one) => `${one.path.subclassId}: ${one.feature} — ${(one.reach as { why: string }).why}`);
    expect([...new Set(shut)].sort()).toEqual([]);
  });

  /** And every door the sheet names is a tool this surface really publishes. */
  it('names a real tool for every feature it says is spendable', () => {
    const doors = sweep()
      .map((one) => one.reach)
      .filter(
        (reach) =>
          reach.how === 'spendable' ||
          reach.how === 'reaction' ||
          reach.how === 're-asked-on-a-rest',
      )
      .map((reach) => (reach as { door: string }).door);
    expect(doors.length).toBeGreaterThan(0);
    for (const door of [...new Set(doors)]) expect(TOOL_NAMES).toContain(door);
  });

  /**
   * And the record of what is shut is exactly what is shut: a pool that opens
   * deletes its line here, and a pool that closes has to be written down.
   */
  it('records exactly the pools nothing can spend, and a reason for each', () => {
    const shut = new Set(
      sweep()
        .filter((one) => one.reach.how === 'unreachable')
        .map((one) => one.feature),
    );
    expect([...shut].sort()).toEqual(Object.keys(NOTHING_TO_BUY).sort());
    for (const [feature, why] of Object.entries(NOTHING_TO_BUY)) {
      expect(why.length, feature).toBeGreaterThan(40);
    }
  });
});
