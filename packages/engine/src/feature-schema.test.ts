import { READABLE_FEATURE_FIELDS, READABLE_GRANT_KINDS } from './content.js';
import { readFileSync } from 'node:fs';
import { BACKGROUNDS, SPECIES, SRD_CONTENT } from '@ie/content';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isErr } from '@ie/shared';
import { spellById } from '@ie/srd';
import {
  MULTIATTACK_LEDGER,
  RESERVED_LEDGER_NAMESPACES,
  STATED_BONUS_ACTION_LEDGER,
} from './combat.js';
import { MAX_LEVEL, type FeatureDefinition } from './progression.js';
import {
  checkFeatureDefinition,
  declaredGrantKinds,
  declaredOptionalFields,
  duplicateFeatureIds,
  parseFeatureDefinition,
  readableFeatureFields,
  readableGrantKinds,
  unwrittenGrantKinds,
  type FeatureContext,
} from './feature-schema.js';

/**
 * A feature definition is data, and until now nothing checked it.
 *
 * The failure this file exists to catch is on the record: **nine features
 * declared `automation: 'engine'` with a note saying "declared as a pool", and
 * none of them declared a pool.** A Bard had a Hit Die, three slot pools and
 * nowhere to spend an inspiration from. `class-pools.test.ts` closed that one
 * instance — a note that claims a pool must be a feature that declares one —
 * and the *class* of failure is wider than the instance: a feature declares
 * its own automation, and the coverage table reads that declaration.
 *
 * This is the structural half. `class-pools.test.ts` keeps its own guards
 * rather than being folded in: one asks whether a note's prose is honest, and
 * this asks whether the declaration is coherent. Two instruments asking
 * different questions is the point.
 */

const here = fileURLToPath(new URL('.', import.meta.url));
const read = (name: string): string => readFileSync(`${here}${name}`, 'utf8');

/**
 * The three modules that read a feature's declaration.
 *
 * Named by the brief, and read as **one string** for the reason every sweep
 * here does: the readers call one another, so asking each on its own stops the
 * walk at the import that carries it.
 */
const READER_FILES = ['standing.ts', 'creation.ts', 'commands/features.ts'] as const;
const READERS = READER_FILES.map(read);
const PROGRESSION = read('progression.ts');

const DECLARED_KINDS = declaredGrantKinds(PROGRESSION);
const READABLE_KINDS = readableGrantKinds(DECLARED_KINDS, READERS);
const READABLE_FIELDS = readableFeatureFields(declaredOptionalFields(PROGRESSION), READERS);

/** Every feature the engine declares, with the source that grants it. */
interface Entry {
  readonly source: string;
  readonly classId: string | null;
  readonly levels: number;
  readonly feature: FeatureDefinition;
}

const population = (): readonly Entry[] => {
  const rows: Entry[] = [];
  for (const definition of SRD_CONTENT.classes) {
    const levels = definition.table.length;
    for (const feature of definition.features) {
      rows.push({ source: definition.id, classId: definition.id, levels, feature });
    }
    for (const sub of SRD_CONTENT.subclasses.filter((s) => s.classId === definition.id)) {
      for (const feature of sub.features) {
        rows.push({ source: sub.id, classId: definition.id, levels, feature });
      }
    }
  }
  // A species or a background has no table of its own; its traits are keyed to
  // character level, which runs to the same twenty.
  for (const species of SPECIES) {
    for (const feature of species.features) {
      rows.push({ source: species.id, classId: null, levels: MAX_LEVEL, feature });
    }
  }
  for (const background of BACKGROUNDS) {
    for (const feature of background.features) {
      rows.push({ source: background.id, classId: null, levels: MAX_LEVEL, feature });
    }
  }
  return rows;
};

const POPULATION = population();

const contextFor = (entry: Entry): FeatureContext => ({
  levels: entry.levels,
  readableGrants: READABLE_KINDS,
  readableFields: READABLE_FIELDS,
  spellExists: (id) => spellById(id) !== null,
  // The class's own spellcasting block executes the feature it names.
  executedBySource: new Set(spellcastingFeatureIds().filter((id) => id.startsWith(`${entry.source}:`))),
});

/** A minimal feature that passes every rule, for a synthetic pair to vary. */
const sound: FeatureDefinition = {
  id: 'wizard:a-sound-feature',
  name: 'A Sound Feature',
  level: 3,
  automation: 'manual',
  note: 'The thing this feature does is not modelled, because nothing tracks a spellbook on fire.',
};

const CONTEXT: FeatureContext = {
  levels: MAX_LEVEL,
  readableGrants: READABLE_KINDS,
  readableFields: READABLE_FIELDS,
  spellExists: (id) => spellById(id) !== null,
};

const codes = (feature: FeatureDefinition, context: FeatureContext = CONTEXT): string[] =>
  checkFeatureDefinition(feature, context).map((problem) => problem.code);

/** `<class>:<the feature its own spellcasting block names>`. */
const spellcastingFeatureIds = (): readonly string[] =>
  SRD_CONTENT.classes
    .filter((definition) => definition.spellcasting !== undefined)
    .map((definition) => `${definition.id}:${definition.spellcasting?.feature ?? 'spellcasting'}`);

describe('the readers are found at all', () => {
  it('reads three reader modules and the declarations', () => {
    expect(READERS).toHaveLength(3);
    for (const source of READERS) expect(source.length).toBeGreaterThan(500);
    expect(PROGRESSION.length).toBeGreaterThan(500);
  });

  /**
   * A floor rather than a count, for the reason `refusal-sweep.test.ts` gives:
   * the population grows with the engine, and what it must never do is
   * silently drop to nothing, which is how a regex that stopped matching looks.
   */
  it('finds the population, and does not quietly see none', () => {
    expect(POPULATION.length).toBeGreaterThan(200);
    expect(DECLARED_KINDS.size).toBeGreaterThan(10);
    expect(READABLE_KINDS.size).toBeGreaterThan(10);
    expect(READABLE_FIELDS.size).toBeGreaterThan(2);
  });
});

describe('rule 1 — ids are unique and namespaced', () => {
  it('reports a namespace-less id, and accepts a namespaced one', () => {
    expect(codes({ ...sound, id: 'a-sound-feature' })).toContain('bad_feature_id');
    expect(codes({ ...sound, id: 'Wizard:Scholar' })).toContain('bad_feature_id');
    expect(codes(sound)).not.toContain('bad_feature_id');
  });

  /**
   * **And not a namespace the engine keeps for its own turn ledger.**
   *
   * `featureUsedOnTurn` is one map: a feature's id goes in it the moment
   * something is spent once per turn, and so do the engine's own per-turn
   * entries, behind a prefix. `statedBonusActionsUsed` reads one of those
   * prefixes back out and hands what it finds to a Multiattack branch the book
   * gates on a printed Bonus Action — so a feature id inside that prefix would
   * open the gate with a class feature. The write side was always the engine's;
   * this is the read side, which a convention cannot cover.
   */
  it('reports an id in a namespace the engine writes into the turn ledger', () => {
    for (const namespace of RESERVED_LEDGER_NAMESPACES) {
      expect(codes({ ...sound, id: `${namespace}something` })).toContain(
        'reserved_feature_namespace',
      );
    }
    expect(codes(sound)).not.toContain('reserved_feature_namespace');
    // And the list is the one the readers actually use, rather than a copy of
    // it: the gate reads this prefix and the sequence slots read the other.
    expect(RESERVED_LEDGER_NAMESPACES).toContain(STATED_BONUS_ACTION_LEDGER);
    expect(RESERVED_LEDGER_NAMESPACES).toContain(MULTIATTACK_LEDGER);
  });

  /** And no feature the engine ships is in one, which is the same claim of the catalogue. */
  it('has no feature anywhere in the engine inside a reserved namespace', () => {
    const inside = POPULATION.map((entry) => entry.feature.id).filter((id) =>
      RESERVED_LEDGER_NAMESPACES.some((namespace) => id.startsWith(namespace)),
    );
    expect(inside).toEqual([]);
  });

  it('reports a shared id, and accepts a population with none', () => {
    const shared = { ...sound, id: 'wizard:scholar' };
    expect(duplicateFeatureIds([shared, { ...shared, name: 'Other' }])).toEqual(['wizard:scholar']);
    expect(duplicateFeatureIds([shared, sound])).toEqual([]);
  });

  it('has no two features sharing an id anywhere in the engine', () => {
    expect(duplicateFeatureIds(POPULATION.map((entry) => entry.feature))).toEqual([]);
  });
});

describe('rule 2 — a level the table reaches', () => {
  it('reports a level past the table, and accepts one inside it', () => {
    expect(codes({ ...sound, level: 21 })).toContain('unreachable_level');
    expect(codes({ ...sound, level: 0 })).toContain('unreachable_level');
    expect(codes({ ...sound, level: 3.5 })).toContain('unreachable_level');
    expect(codes({ ...sound, level: 20 })).not.toContain('unreachable_level');
  });

  /**
   * The discriminating case: a level the *character* can reach and this
   * source's table does not. A context of twenty cannot tell the two apart.
   */
  it('reads the source’s own table, not a universal twenty', () => {
    const short: FeatureContext = { ...CONTEXT, levels: 3 };
    expect(codes({ ...sound, level: 5 }, short)).toContain('unreachable_level');
    expect(codes({ ...sound, level: 3 }, short)).not.toContain('unreachable_level');
  });
});

describe('rule 3 — a manual feature says what is missing', () => {
  it('reports a hollow note, and accepts one that says something', () => {
    expect(codes({ ...sound, note: '' })).toContain('hollow_note');
    expect(codes({ ...sound, note: '   ' })).toContain('hollow_note');
    expect(codes({ ...sound, note: 'TODO' })).toContain('hollow_note');
    expect(codes({ ...sound, note: 'Not modelled.' })).toContain('hollow_note');
    expect(codes({ ...sound, note: 'This feature is not automated' })).toContain('hollow_note');
    expect(codes({ ...sound, note: 'The Wish effect is not modelled.' })).not.toContain(
      'hollow_note',
    );
    expect(codes(sound)).not.toContain('hollow_note');
  });

  /**
   * The rule reads a *manual* feature, because that is where an unexplained
   * "not automated" costs somebody at three in the morning. An `engine`
   * feature's note describes what the engine does and is prose either way.
   */
  it('does not demand one of an engine feature', () => {
    const executed: FeatureDefinition = {
      ...sound,
      automation: 'engine',
      note: '',
      grants: { kind: 'expertise' },
    };
    expect(codes(executed)).not.toContain('hollow_note');
  });
});

describe('rule 4 — an engine feature declares something the engine reads', () => {
  it('reports a grant kind nothing reads, and accepts one that is read', () => {
    const unread = {
      ...sound,
      automation: 'engine' as const,
      grants: { kind: 'telepathy' } as never,
    };
    expect(codes(unread)).toContain('grant_not_read');
    expect(
      codes({ ...sound, automation: 'engine', grants: { kind: 'expertise' } }),
    ).not.toContain('grant_not_read');
  });

  it('reports an engine feature that declares nothing, and accepts one that does', () => {
    expect(codes({ ...sound, automation: 'engine' })).toContain('engine_declares_nothing');
    expect(
      codes({ ...sound, automation: 'engine', choice: { kind: 'skill', choose: 1 } }),
    ).not.toContain('engine_declares_nothing');
    expect(
      codes({
        ...sound,
        automation: 'engine',
        grantsFeat: { featId: 'magic-initiate', spellList: 'wizard' },
      }),
    ).not.toContain('engine_declares_nothing');
  });

  /**
   * **`grantsSubclass` does not satisfy it, because nothing reads it** — see
   * the unread-field sweep below. Written down here as well, because a reader
   * meeting this rule will reach for that field first: a feature declaring
   * only `grantsSubclass` claims to be executed and reaches nothing.
   */
  it('is not satisfied by a field no reader dereferences', () => {
    expect(codes({ ...sound, automation: 'engine', grantsSubclass: true })).toContain(
      'engine_declares_nothing',
    );
  });

  /** A manual feature is recorded and not executed, so it declares nothing. */
  it('does not demand a declaration of a manual feature', () => {
    expect(codes(sound)).not.toContain('engine_declares_nothing');
  });

  /**
   * The derivation is over the readers, never a list — a hand-kept list is the
   * claim this repository has had falsified four times. So it is driven over a
   * synthetic reader it must see and a synthetic one it must not.
   */
  it('derives readability from the readers, and is driven over a source it must catch', () => {
    const kinds = ['seen', 'unseen', 'commented'];
    const reader = [
      "if (grant?.kind !== 'seen') continue;",
      "// a docstring naming 'commented' is not a reader",
      '/** nor is `commented` in a block comment */',
    ].join('\n');
    const readable = readableGrantKinds(kinds, [reader]);
    expect([...readable]).toEqual(['seen']);
  });

  it('sees a kind a reader names and a kind no reader names, in the real modules', () => {
    // Non-vacuous in both directions against the engine's own readers.
    expect(READABLE_KINDS.has('expertise')).toBe(true);
    expect(readableGrantKinds(['a-kind-nobody-reads'], READERS).size).toBe(0);
  });

  it('derives which feature fields a reader reads', () => {
    const fields = readableFeatureFields(['alpha', 'beta', 'gamma'], [
      'const x = feature.alpha; const y = thing.beta;',
    ]);
    expect([...fields].sort()).toEqual(['alpha', 'beta']);
  });

  /**
   * `.grants` must not be matched by `.grantsFeat`. The two are different
   * fields and creation reads both; a loose boundary would make every
   * `grantsFeat` reader look like a `grants` reader.
   */
  it('does not let one field name swallow a longer one', () => {
    expect([...readableFeatureFields(['grants'], ['feature.grantsFeat'])]).toEqual([]);
    expect([...readableFeatureFields(['grants'], ['feature.grants?.kind'])]).toEqual(['grants']);
  });
});

describe('rule 5 — a fixed spell grant names spells the book prints', () => {
  const withFixed = (fixed: readonly string[]): FeatureDefinition => ({
    ...sound,
    automation: 'engine',
    grants: { kind: 'spells', fixed },
  });

  it('reports a spell the book does not print, and accepts one it does', () => {
    expect(codes(withFixed(['dragon-breath']))).toContain('unknown_granted_spell');
    expect(codes(withFixed(['dragons-breath']))).not.toContain('unknown_granted_spell');
  });

  it('reports an empty fixed list, because a grant of nothing grants nothing', () => {
    expect(codes(withFixed([]))).toContain('empty_spell_grant');
    expect(codes(withFixed(['bless']))).not.toContain('empty_spell_grant');
  });

  /**
   * **Class-list membership is deliberately not checked, and the SRD is why.**
   *
   * The brief asked for "on that class's list", and four of the engine's
   * fifteen fixed grants are off it — correctly. SRD 5.2.1 Fiend Spells:
   * "when you reach a Warlock level specified in the Fiend Spells table, you
   * thereafter always have the listed spells prepared", level 3: "Burning
   * Hands, Command, Scorching Ray, Suggestion". Three of those four are on no
   * Warlock list, and that is the entire point of a subclass spell grant —
   * it hands you spells the class does not otherwise get. Draconic Spells does
   * the same with Command.
   *
   * So enforcing it would have required deleting SRD content from four
   * correct transcriptions, which is a change to what the engine executes. The
   * counterexamples are asserted here rather than described, so a future rule
   * meets them.
   */
  it('does not require a fixed grant to be on the class’s own list', () => {
    const offList = ['burning-hands', 'command', 'scorching-ray'];
    for (const id of offList) {
      expect(spellById(id)?.classes ?? []).not.toContain('warlock');
    }
    expect(codes(withFixed(offList))).toEqual([]);
  });
});

describe('rule 6 — a pool is sized the three ways the SRD sizes one', () => {
  const pool = (sizing: Record<string, unknown>): FeatureDefinition => ({
    ...sound,
    automation: 'engine',
    grants: {
      kind: 'pool',
      key: 'a-pool',
      recovers: 'long-rest',
      ...sizing,
    } as never,
  });

  it('reports two sizings at once, and accepts exactly one', () => {
    expect(codes(pool({ usesByLevel: new Array(20).fill(1), perClassLevel: 5 }))).toContain(
      'ambiguous_pool_sizing',
    );
    expect(codes(pool({ perClassLevel: 5 }))).not.toContain('ambiguous_pool_sizing');
  });

  it('reports a column that is not the length of the table, and accepts one that is', () => {
    expect(codes(pool({ usesByLevel: [1, 2, 3] }))).toContain('not_a_table_column');
    expect(codes(pool({ usesByLevel: new Array(MAX_LEVEL).fill(1) }))).not.toContain(
      'not_a_table_column',
    );
  });

  it('reports a sizing that is not a number the SRD could print', () => {
    expect(codes(pool({ perClassLevel: 0 }))).toContain('bad_pool_sizing');
    expect(codes(pool({ perClassLevel: -1 }))).toContain('bad_pool_sizing');
    expect(codes(pool({ minimum: 0.5 }))).toContain('bad_pool_sizing');
    expect(codes(pool({ usesByLevel: new Array(20).fill(-1) }))).toContain('bad_pool_sizing');
    expect(codes(pool({ fromAbilityModifier: 'luck' }))).toContain('bad_pool_sizing');
    expect(codes(pool({ fromAbilityModifier: 'cha', minimum: 1 }))).not.toContain(
      'bad_pool_sizing',
    );
  });

  /**
   * SRD Arcane Recovery: "Once you use this feature, you can't do so again
   * until you finish a Long Rest." A pool of one names no shape at all, which
   * is `poolSizeOf`'s fourth branch and a real answer rather than an omission.
   */
  it('accepts a pool of one, which names no sizing shape', () => {
    expect(codes(pool({ minimum: 1 }))).toEqual([]);
    expect(codes(pool({}))).toEqual([]);
  });

  /** The sizing is read wherever a grant declares one, not only on `pool`. */
  it('reads the sizing an activated grant and a reaction grant declare', () => {
    const activated: FeatureDefinition = {
      ...sound,
      automation: 'engine',
      grants: {
        kind: 'activated',
        action: 'bonus-action',
        pool: 'a-pool',
        lasts: 'end-of-next-turn',
        usesByLevel: [1, 2, 3],
      },
    };
    expect(codes(activated)).toContain('not_a_table_column');

    const reaction: FeatureDefinition = {
      ...sound,
      automation: 'engine',
      grants: {
        kind: 'reaction',
        costsReaction: true,
        reach: { kind: 'self' },
        does: [{ kind: 'reroll' }],
        pool: 'a-pool',
        declares: { usesByLevel: [1, 2, 3], recovers: 'long-rest' },
      },
    };
    expect(codes(reaction)).toContain('not_a_table_column');
  });

  /**
   * And the recovery a **later feature** rewrites, judged by the two ways the
   * rewrite could be silent.
   *
   * SRD Font of Inspiration moves a pool declared four levels earlier onto a
   * Short Rest. `recoveryOf` in `creation.ts` gates that on the character
   * holding the feature named, so a name nobody could hold never fires — and a
   * tag that is the one already declared is a rewrite of nothing at all.
   * Whether the id names a *real* sibling is `checkContent`'s, which sees the
   * source's other features; both halves are asked, neither twice.
   */
  it('reports a rewrite naming nobody, and one that changes nothing', () => {
    expect(codes(pool({ recoversSooner: { withFeature: '  ', recovers: 'short-rest' } }))).toContain(
      'rewrite_without_a_feature',
    );
    expect(codes(pool({ recoversSooner: { recovers: 'short-rest' } }))).toContain(
      'rewrite_without_a_feature',
    );
    expect(
      codes(pool({ recoversSooner: { withFeature: 'a-class:later', recovers: 'long-rest' } })),
    ).toContain('rewrite_changes_nothing');
    expect(
      codes(pool({ recoversSooner: { withFeature: 'a-class:later', recovers: 'short-rest' } })),
    ).toEqual([]);
  });
});

/**
 * A choice on one feature, and a table saying what each of its options *means*
 * to the features written in terms of it.
 *
 * The SRD writes this several times over — a species trait that asks which
 * ancestry, lineage or legacy you take, and later traits written as
 * "determined by" that choice. Two halves, and this rule is the half a
 * definition can answer about itself: the table's keys are exactly the options
 * the choice offers, and each value is a shape the vocabulary knows. Whether
 * the *reading* grant's sibling exists is a question about a population, so it
 * lives in `checkContent` beside the other cross-definition rules.
 */
describe('rule 8 — a table of what each option means, and a grant that reads one', () => {
  /** The choosing half: three options and what each means to a reader. */
  const chooses: FeatureDefinition = {
    ...sound,
    id: 'wizard:an-ancestry',
    level: 1,
    choice: { kind: 'option', choose: 1, from: ['Ember', 'Frost', 'Gale'] },
    optionMeans: {
      Ember: { damageTypes: ['fire'] },
      Frost: { damageTypes: ['cold'] },
      Gale: { damageTypes: ['lightning'] },
    },
  };

  it('accepts a table whose keys are exactly the options offered', () => {
    expect(codes(chooses)).toEqual([]);
  });

  it('reports a table on a feature that asks nothing', () => {
    const noChoice: FeatureDefinition = {
      ...sound,
      id: chooses.id,
      ...(chooses.optionMeans === undefined ? {} : { optionMeans: chooses.optionMeans }),
    };
    expect(codes(noChoice)).toContain('table_without_a_choice');
  });

  /**
   * A skill or a feat choice has no named option list for a table to key on,
   * so the table would cover nothing whatever it said.
   */
  it('reports a table beside a choice that is not a list of options', () => {
    expect(codes({ ...chooses, choice: { kind: 'skill', choose: 1 } })).toContain(
      'table_without_a_choice',
    );
  });

  it('reports an option the table leaves out', () => {
    const short = { Ember: { damageTypes: ['fire'] }, Frost: { damageTypes: ['cold'] } };
    expect(codes({ ...chooses, optionMeans: short })).toContain('option_missing_from_table');
  });

  it('reports a key the choice does not offer', () => {
    const surplus = { ...chooses.optionMeans, Storm: { damageTypes: ['thunder'] } };
    expect(codes({ ...chooses, optionMeans: surplus })).toContain('unknown_option_in_table');
  });

  it('reports a meaning that is not a shape the vocabulary knows', () => {
    const wrong = { ...chooses.optionMeans, Gale: { damageTypes: 'lightning' } } as never;
    expect(codes({ ...chooses, optionMeans: wrong })).toContain('bad_option_meaning');
    const empty = { ...chooses.optionMeans, Gale: { damageTypes: [] } };
    expect(codes({ ...chooses, optionMeans: empty })).toContain('bad_option_meaning');
    const notAnObject = { ...chooses.optionMeans, Gale: 'lightning' } as never;
    expect(codes({ ...chooses, optionMeans: notAnObject })).toContain('bad_option_meaning');
  });

  /**
   * A meaning the vocabulary has no field for is *not* refused here: a table
   * written against a later engine is data this one does not understand rather
   * than data that is wrong, which is the rule `checkFeatureShape` already
   * follows for an unknown field. What refuses it is the reading grant, in
   * `checkContent`, which knows what it came to read.
   */
  it('accepts a meaning this engine has no reader for', () => {
    const later = { ...chooses.optionMeans, Gale: {} };
    expect(codes({ ...chooses, optionMeans: later })).toEqual([]);
  });

  /** The reading half: a grant that says where its choice is read from. */
  const reads: FeatureDefinition = {
    ...sound,
    id: 'wizard:an-inheritance',
    level: 1,
    automation: 'engine',
    grants: {
      kind: 'standing',
      reach: 'self',
      effects: [{ kind: 'damage-resistance', damageTypes: [] }],
      damageTypesFromChoice: true,
      choiceFrom: 'wizard:an-ancestry',
    },
  };

  it('accepts a grant that names where its choice is read from', () => {
    expect(codes(reads)).toEqual([]);
  });

  /**
   * The field says where a choice is read *from*, so a grant that reads no
   * choice at all is naming a source for nothing.
   */
  it('reports a grant that names a source and reads no choice', () => {
    const idle: FeatureDefinition = {
      ...reads,
      grants: {
        kind: 'standing',
        reach: 'self',
        effects: [{ kind: 'speed', feet: 5 }],
        choiceFrom: 'wizard:an-ancestry',
      },
    };
    expect(codes(idle)).toContain('choice_from_reads_nothing');
  });

  /** And the option gate reads a choice too, which is the other thing one says. */
  it('accepts a grant that gates on a sibling’s option', () => {
    const gated: FeatureDefinition = {
      ...reads,
      grants: {
        kind: 'standing',
        reach: 'self',
        effects: [{ kind: 'speed', feet: 5 }],
        onlyIfChoice: 'Gale',
        choiceFrom: 'wizard:an-ancestry',
      },
    };
    expect(codes(gated)).toEqual([]);
  });
});

describe('rule 7 — no FeatureGrant member sits unwritten', () => {
  /**
   * Every writer of the vocabulary, which is no longer only the class tables.
   *
   * A magic item is a `CatalogueItem` that has grown grants written in this
   * same `FeatureGrant` vocabulary — see `docs/design/characters-and-equipment.md`
   * — so an item writing a member is a writer of it, and a feat declaring one
   * is too. Three members have no class writer at all. They are the two halves of one SRD sentence: `casts`
   * is an item casting a spell from its own charges, and `confers` is an item
   * that "bypasses the casting of a spell" and hands the effects over
   * directly. Both are looked up by the granting item's id and `checkContent`
   * refuses either on a feature outright.
   *
   * **And a feat is the third writer.** SRD Alert declares
   * `initiative-proficiency`, which `creation.ts` reads off the feat; the
   * engine used to pay that bonus out by comparing a chosen feat's id against
   * a literal, and the member exists so that it no longer has to. No class
   * feature writes it, exactly as none writes `casts`.
   *
   * Reading only the classes would report all three as members nobody writes,
   * which is the one thing this guard must not do: the population is what has
   * grown, not the vocabulary's honesty. The third case below holds the
   * widening to exactly those members, in both directions.
   */
  const written: ReadonlySet<string> = new Set([
    ...POPULATION.flatMap((entry) =>
      entry.feature.grants === undefined ? [] : [String(entry.feature.grants.kind)],
    ),
    ...SRD_CONTENT.items.flatMap((item) =>
      (item.grants ?? []).map((grant) => String(grant.kind)),
    ),
    ...SRD_CONTENT.feats.flatMap((feat) =>
      feat.grants === undefined ? [] : [String(feat.grants.kind)],
    ),
  ]);

  /**
   * Both directions, which together are a bijection: a member the extraction
   * misses fails the first, and a member nobody writes fails the second.
   * Names, never a count — a count needs maintaining by whoever next changes
   * the format, and passes for the wrong reason the moment two changes cancel.
   */
  it('declares every kind a class or an item writes', () => {
    expect([...written].filter((kind) => !DECLARED_KINDS.has(kind)).sort()).toEqual([]);
  });

  it('has a class or an item writing every kind it declares', () => {
    expect(unwrittenGrantKinds(DECLARED_KINDS, written)).toEqual([]);
  });

  /**
   * And the widening is real rather than a way of going green: the catalogue
   * has an item writing each member no class does, and the members the two
   * populations share are shared rather than quietly item-only.
   */
  it('has the items and the feats writing what the class tables do not', () => {
    const fromClasses = new Set(
      POPULATION.flatMap((entry) =>
        entry.feature.grants === undefined ? [] : [String(entry.feature.grants.kind)],
      ),
    );
    expect([...written].filter((kind) => !fromClasses.has(kind)).sort()).toEqual([
      'casts',
      'confers',
      'initiative-proficiency',
    ]);
    expect(fromClasses.has('pool')).toBe(true);

    // And each of the two later populations really writes its own, so a
    // widening cannot be satisfied by the population beside it.
    const fromFeats = new Set(
      SRD_CONTENT.feats.flatMap((feat) =>
        feat.grants === undefined ? [] : [String(feat.grants.kind)],
      ),
    );
    // The Epic Boons write the second: SRD prints "to a maximum of 30" on
    // the boon rather than on the level 19 class feature that grants one, so
    // this kind is written by a class table *and* by a feat, which is the
    // sharing this assertion is here to make visible.
    expect([...fromFeats].sort()).toEqual(['ability-score-increase', 'initiative-proficiency']);
    expect(fromClasses.has('ability-score-increase')).toBe(true);
  });

  it('reports a member nobody writes, driven over a synthetic one', () => {
    expect(unwrittenGrantKinds(['expertise', 'telepathy'], new Set(['expertise']))).toEqual([
      'telepathy',
    ]);
  });

  /**
   * The extraction takes the union's own arms and not the unions nested inside
   * them. `FeatureGrant`'s `recovery` arm carries
   * `restores: { kind: 'pool' } | { kind: 'pact-slots' }`, and `pact-slots` is
   * not a `FeatureGrant` member — reading it as one would report a member
   * nobody could ever write.
   */
  it('does not mistake a nested union’s arm for a member of this one', () => {
    expect(DECLARED_KINDS.has('pact-slots')).toBe(false);
    expect(DECLARED_KINDS.has('reaction')).toBe(true);
  });

  it('is driven over a synthetic declaration it must read exactly', () => {
    const source = [
      'export type FeatureGrant =',
      "  | { readonly kind: 'alpha' }",
      '  | {',
      "      readonly kind: 'beta';",
      '      readonly restores:',
      "        | { readonly kind: 'nested-one' }",
      "        | { readonly kind: 'nested-two' };",
      '    };',
      '',
      'export interface PoolSizing {',
      "  readonly kind: 'not-a-grant';",
      '}',
    ].join('\n');
    expect([...declaredGrantKinds(source)].sort()).toEqual(['alpha', 'beta']);
  });

  /**
   * The same question one level up: a **field** of `FeatureDefinition` that
   * every class writes and no reader reads.
   *
   * `grantsSubclass` is the one, and it is a finding rather than a fix. All
   * twelve classes set it `true` on the feature that opens their subclass, and
   * nothing in `standing.ts`, `creation.ts` or `commands/features.ts`
   * dereferences it — `creation.ts:412` asks `definition.subclassLevel`, the
   * **class's** own declaration, and `checkFeatureChoices` reads the feature's
   * `choice: { kind: 'subclass' }`. So it is a second place recording a fact
   * the engine reads from the first, which is the "two answers to one
   * question" failure this repository keeps naming.
   *
   * Removing it is `progression.ts`'s owner's — this task may not change those
   * types, and deleting the twelve writers while the field still stands would
   * be worse than leaving them. So the exemption names it, and the sweep is
   * held in both directions so it cannot silently grow a second entry.
   */
  const UNREAD_FIELDS: Readonly<Record<string, string>> = {
    executedBy:
      'Read by the content validator and by nothing that executes a feature: it is a claim about which sibling feature’s declaration carries this one’s effect, held to a sibling that declares something a reader reads. A reader dereferencing it would be a reader executing a feature twice.',
    grantsSubclass:
      'Written `true` by all twelve classes and dereferenced by no reader. Creation decides a subclass is due from `ClassDefinition.subclassLevel` and asks for it through the feature’s own `choice: { kind: "subclass" }`, so this field records a third time what two other declarations already say. Ends when `progression.ts`’s owner removes it, or when a reader is written that prefers it to `subclassLevel`.',
  };

  /** The engine's runtime copies of the derived sets are held to the derivation, both ways. */
  it('keeps the runtime vocabulary the content validator uses equal to the derived one', () => {
    expect([...READABLE_FEATURE_FIELDS].sort()).toEqual([...READABLE_FIELDS].sort());
    expect([...READABLE_GRANT_KINDS].sort()).toEqual([...READABLE_KINDS].sort());
  });

  it('names every optional feature field no reader reads, and exempts none that is read', () => {
    const declared = declaredOptionalFields(PROGRESSION);
    const unread = [...declared].filter((field) => !READABLE_FIELDS.has(field)).sort();
    expect(unread).toEqual(Object.keys(UNREAD_FIELDS).sort());
    // Not vacuous: the fields that *are* read are read.
    expect([...READABLE_FIELDS].sort()).toEqual([
      'choice',
      'grants',
      'grantsFeat',
      'optionMeans',
    ]);
  });

  it('has a reason on the unread field, and it says something', () => {
    const hollow = /^(todo|tbd|n\/?a|none|later|unknown)\.?$/i;
    for (const [field, reason] of Object.entries(UNREAD_FIELDS)) {
      expect(reason.length, field).toBeGreaterThan(80);
      expect(hollow.test(reason.trim()), field).toBe(false);
    }
  });

  /**
   * Driven over a declaration carrying the two shapes that mislead it: a
   * neighbouring interface, and an **inline** optional nested on the same line
   * as the field that holds it — which is how `grantsFeat` writes `spellList`,
   * and is why indentation cannot be what separates them.
   */
  it('reads the optional fields a feature may declare, and not the ones inside them', () => {
    const source = [
      'export interface FeatureDefinition {',
      '  readonly id: string;',
      '  readonly choice?: FeatureChoice;',
      '  readonly grants?: FeatureGrant;',
      '  readonly grantsFeat?: { readonly featId: string; readonly spellList?: string };',
      '}',
      'export interface Other {',
      '  readonly nope?: string;',
      '}',
    ].join('\n');
    expect([...declaredOptionalFields(source)].sort()).toEqual([
      'choice',
      'grants',
      'grantsFeat',
    ]);
  });
});

describe('the whole SRD catalogue’s features validate', () => {
  it('reports nothing', () => {
    const problems = POPULATION.flatMap((entry) =>
      checkFeatureDefinition(entry.feature, contextFor(entry)).map(
        (problem) => `${entry.feature.id} ${problem.code}: ${problem.reason}`,
      ),
    );
    expect(problems).toEqual([]);
  });

  /**
   * Rule 4's second half has two honest escapes and both are derived from the
   * definitions rather than typed out here: the feature a class's own
   * `spellcasting` block executes, and a feature that names the sibling whose
   * table steps at its level. Held in both directions, so a stale claim fails
   * rather than sitting there.
   */
  it('derives the spellcasting exemptions from the class declarations', () => {
    const byId = new Set(POPULATION.map((entry) => entry.feature.id));
    const derived = spellcastingFeatureIds();
    expect(derived.length).toBeGreaterThan(5);
    for (const id of derived) expect(byId.has(id)).toBe(true);
    expect(derived).toContain('warlock:pact-magic');
  });

  it('holds every executedBy to a sibling that declares something', () => {
    const claims = POPULATION.filter((entry) => entry.feature.executedBy !== undefined);
    expect(claims.map((entry) => entry.feature.id).sort()).toEqual([
      'cleric:improved-blessed-strikes',
      'druid:improved-elemental-fury',
    ]);
    for (const entry of claims) {
      const sibling = POPULATION.find(
        (other) => other.source === entry.source && other.feature.id === entry.feature.executedBy,
      );
      expect(sibling, entry.feature.id).toBeDefined();
      expect(sibling?.feature.grants, entry.feature.id).toBeDefined();
    }
  });

  /** And without either escape the rule still fires: the exemption is not a licence. */
  it('still catches an engine feature that declares nothing and names nothing', () => {
    const bare = POPULATION.filter(
      (entry) =>
        entry.feature.automation === 'engine' &&
        entry.feature.executedBy === undefined &&
        !spellcastingFeatureIds().includes(entry.feature.id) &&
        READABLE_FIELDS.size > 0 &&
        [...READABLE_FIELDS].every(
          (field) => (entry.feature as unknown as Record<string, unknown>)[field] === undefined,
        ),
    );
    expect(bare).toEqual([]);
    expect(codes({ ...sound, automation: 'engine' })).toContain('engine_declares_nothing');
    expect(
      codes({ ...sound, automation: 'engine', executedBy: 'wizard:scholar' }),
    ).not.toContain('engine_declares_nothing');
  });
});

describe('parseFeatureDefinition is the Result half', () => {
  /**
   * The codes are named rather than only `isErr`, because a code a tool
   * surface branches on is a rule that lives in a string and nowhere else —
   * `refusal-sweep.test.ts` is what says so, and it counts this file.
   */
  it('takes unknown and refuses what is not a feature at all', () => {
    const refusal = (value: unknown): string => {
      const result = parseFeatureDefinition(value, CONTEXT);
      expect(isErr(result)).toBe(true);
      return result.ok ? '' : result.code;
    };
    expect(refusal(null)).toBe('not_a_feature');
    expect(refusal('wizard:scholar')).toBe('not_a_feature');
    expect(refusal([sound])).toBe('not_a_feature');
    expect(refusal({ id: 'wizard:scholar' })).toBe('bad_feature_shape');
    expect(refusal({ ...sound, level: '3' })).toBe('bad_feature_shape');
  });

  /**
   * **Every field a rule dereferences, because that is where a refusal turns
   * into a `TypeError`.** The first version checked the five scalars and
   * nothing else, so `grants: null` threw reading `.kind`, a string `fixed`
   * threw on `.forEach` and a numeric `usesByLevel` threw on `.findIndex` —
   * three exceptions out of a function whose whole contract is that it answers
   * a caller who did not come through the compiler. Rules-legal refusals are
   * values, not exceptions, and this is the task's own subject arriving in the
   * task: a docstring made a claim and nothing checked it.
   */
  it('answers rather than throwing on every field a rule reads', () => {
    const malformed: readonly [string, unknown][] = [
      ['a grant that is not an object', { ...sound, grants: null }],
      ['a grant that is a list', { ...sound, grants: [{ kind: 'expertise' }] }],
      ['a grant with no kind', { ...sound, grants: {} }],
      ['a grant whose kind is not a string', { ...sound, grants: { kind: 7 } }],
      ['a fixed list that is a string', { ...sound, grants: { kind: 'spells', fixed: 'bless' } }],
      [
        'a fixed list holding something that is not an id',
        { ...sound, grants: { kind: 'spells', fixed: ['bless', 3] } },
      ],
      [
        'a column that is a number',
        { ...sound, grants: { kind: 'pool', key: 'k', recovers: 'long-rest', usesByLevel: 20 } },
      ],
      [
        'a column holding something that is not a number',
        {
          ...sound,
          grants: { kind: 'pool', key: 'k', recovers: 'long-rest', usesByLevel: ['1'] },
        },
      ],
      [
        'a declared pool that is not an object',
        { ...sound, grants: { kind: 'reaction', declares: 'twice' } },
      ],
      [
        'a declared pool whose column is a number',
        { ...sound, grants: { kind: 'reaction', declares: { usesByLevel: 3 } } },
      ],
      // Rule 8's two, which a rule walks the same way: a string table would
      // walk as its characters and report options nobody wrote, and a
      // sibling named by a number names nothing.
      ['a table that is a string', { ...sound, optionMeans: 'fire' }],
      ['a table that is a list', { ...sound, optionMeans: [{ damageTypes: ['fire'] }] }],
      [
        'a sibling reference that is not an id',
        { ...sound, grants: { kind: 'standing', reach: 'self', choiceFrom: 7 } },
      ],
    ];

    for (const [label, value] of malformed) {
      const result = parseFeatureDefinition(value, CONTEXT);
      expect(result.ok, label).toBe(false);
      if (!result.ok) expect(result.code, label).toBe('bad_feature_shape');
    }
  });

  /**
   * The shape check stops at what the rules read. A field the engine does not
   * know is data a later engine understands, not data that is wrong — the
   * reading `checkShape` takes and the reason this is not a second copy of the
   * type.
   */
  it('does not refuse a field it has never heard of', () => {
    expect(parseFeatureDefinition({ ...sound, telepathy: { range: 30 } }, CONTEXT).ok).toBe(true);
  });

  /** A shape it *can* read, refused on the semantics, keeps the rule's code. */
  it('carries the rule’s own code through, with the field in front of it', () => {
    const result = parseFeatureDefinition({ ...sound, level: 99 }, CONTEXT);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('unreachable_level');
      expect(result.reason).toMatch(/^level: /);
    }
  });

  it('returns the definition when it is sound', () => {
    const parsed = parseFeatureDefinition(sound, CONTEXT);
    expect(parsed.ok).toBe(true);
  });

  it('drives every feature the engine declares through the untyped half', () => {
    const refused = POPULATION.map((entry) =>
      parseFeatureDefinition(entry.feature, { ...contextFor(entry), readableFields: READABLE_FIELDS }),
    )
      .map((result, index) =>
        result.ok
          ? null
          : `${POPULATION[index]?.feature.id}: ${result.code} ${result.reason}`,
      )
      .filter((line): line is string => line !== null)
      // The rule-4 blind spot is the one thing the population trips, and it is
      // accounted for above.
      .filter((line) => !line.includes('engine_declares_nothing'));
    expect(refused).toEqual([]);
  });
});

/**
 * The grants a *use* hangs, which are the stored half of a standing effect —
 * see `ActivatedFeature.hangs`. Two promises can be written there that nothing
 * downstream would keep, and both are silent: the grant lands, and what the
 * definition said about its ending is simply not what happens.
 */
describe('a hung grant may not promise an ending nothing keeps', () => {
  const hanging = (hangs: unknown): FeatureDefinition =>
    ({
      ...sound,
      automation: 'engine',
      note: 'A Bonus Action that hangs something on its holder, for the validator to read.',
      grants: {
        kind: 'activated',
        action: 'bonus-action',
        pool: null,
        lasts: 'start-of-next-turn',
        hangs,
      },
    }) as FeatureDefinition;

  const advantage = (roll: string) => ({
    kind: 'roll-mode',
    modifier: { mode: 'advantage', selector: { roll, relation: 'roller' }, oneShot: true },
    lasts: 'end-of-current-turn',
  });

  it('accepts the one SRD writes: a one-shot on an attack roll', () => {
    expect(codes(hanging([advantage('attack')]))).toEqual([]);
  });

  /** Only the two attack rollers spend one; on a save it runs to its deadline. */
  it('refuses a one-shot on a roll nothing spends one from', () => {
    expect(codes(hanging([advantage('saving-throw')]))).toContain('one_shot_off_an_attack');
  });

  /** Two of one kind share a source, and one ending would end both. */
  it('refuses two grants of one kind, which would share a source', () => {
    expect(codes(hanging([advantage('attack'), advantage('attack')]))).toContain(
      'two_grants_of_one_kind',
    );
  });

  /**
   * The half of this validator that takes `unknown`: a homebrew class arrives
   * as JSON text through `parseFeatureDefinition`, where a missing modifier is
   * a refusal and never a `TypeError` thrown out of a function whose contract
   * is to hand back every problem it found.
   */
  it('refuses a hung roll-mode with nothing to read, rather than throwing', () => {
    expect(codes(hanging([{ kind: 'roll-mode', lasts: 'end-of-current-turn' }]))).toContain(
      'bad_roll_modifier',
    );
    expect(
      codes(
        hanging([
          {
            kind: 'roll-mode',
            modifier: { mode: 'advantage', oneShot: true },
            lasts: 'end-of-current-turn',
          },
        ]),
      ),
    ).toContain('bad_roll_modifier');
  });

  it('says so through the door untyped content comes in by', () => {
    const refused = parseFeatureDefinition(
      hanging([{ kind: 'roll-mode', lasts: 'end-of-current-turn' }]),
      CONTEXT,
    );
    expect(isErr(refused) && refused.code).toBe('bad_roll_modifier');
  });

  it('allows two grants of different kinds, which is the sentence Steady Aim writes', () => {
    expect(
      codes(
        hanging([
          advantage('attack'),
          { kind: 'speed', change: 'zero', lasts: 'end-of-current-turn' },
        ]),
      ),
    ).toEqual([]);
  });
});
