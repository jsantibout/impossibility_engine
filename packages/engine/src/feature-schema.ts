import { ABILITIES, err, ok, type Ability, type Result } from '@ie/shared';
import { ABILITY_SCORE_MAXIMUM } from './character.js';
import type { FeatureDefinition, FeatureOptionMeaning, PoolSizing } from './progression.js';

/**
 * Whether a feature definition is *coherent*, asked of a value rather than of a
 * compilation.
 *
 * The twelve class files are already pure declarative data — a level, an
 * automation, a note, and at most one closed-union grant. What they never had
 * is anything that checks one at **runtime**: the TypeScript compiler was the
 * only guard, so every claim a definition makes about itself was believed.
 *
 * **The failure this exists to catch is on the record.** Nine features
 * declared `automation: 'engine'` on the strength of a note saying "declared
 * as a pool", and not one of them declared a pool: Bardic Inspiration, both
 * Channel Divinities, Wild Shape, Second Wind, Action Surge, Monk's Focus, Lay
 * On Hands and Sorcery Points. A Bard built by the engine had a Hit Die, three
 * spell-slot pools and nowhere to spend an inspiration from.
 * `class-pools.test.ts` closed that instance by scanning the *prose*; this is
 * the structural half, and it asks a different question:
 *
 * | | Asks |
 * |---|---|
 * | `class-pools.test.ts` | is this feature's **note** honest about what it declares |
 * | here | is this **declaration** coherent, and does anything read it |
 * | `creation.ts` | may **this character** take it, at this level, with these choices |
 *
 * `spell-schema.ts` is the precedent and the shape: every problem is reported
 * rather than the first, each carries a path, and
 * {@link parseFeatureDefinition} is the `Result` half over `unknown` — so a
 * definition may come from a file, a loader or a tool rather than from `tsc`.
 *
 * **Every rule below was run against all of the engine's features before it
 * was written.** Only one fires, and it fires on a blind spot rather than a
 * defect: see {@link FeatureContext.readableFields}.
 */

/** One thing wrong with a feature definition, and where. */
export interface FeatureDefinitionProblem {
  /** The path to the offending field, e.g. `grants.usesByLevel`. */
  readonly field: string;
  readonly code: string;
  readonly reason: string;
}

/**
 * What a feature cannot know about itself.
 *
 * Every member is a fact held somewhere else — the table that grants it, the
 * readers that consume it, the parsed book. Passed in rather than read,
 * because `packages/engine` is pure and cannot open a file, and because a
 * derivation the caller supplies is one a test can drive over a synthetic case
 * it must catch. That is the `coverageGaps` discipline, applied here.
 */
export interface FeatureContext {
  /** How many levels the granting source's table has. */
  readonly levels: number;
  /**
   * The `FeatureGrant` kinds the engine's readers discriminate on.
   *
   * Derived by {@link readableGrantKinds} from the readers themselves, never
   * from a hand-written list: a list is the claim this repository has had
   * falsified four times, and the thing rule 4 is about is exactly a claim
   * nobody checked.
   */
  readonly readableGrants: ReadonlySet<string>;
  /**
   * The optional `FeatureDefinition` fields the readers dereference.
   *
   * A feature is executed through one of these or through nothing. The
   * derivation is blind to a feature executed through a declaration on its
   * *class* rather than on itself — a `spellcasting` block, or a sibling
   * feature's table — and that blindness is stated in the test rather than
   * exempted away.
   */
  readonly readableFields: ReadonlySet<string>;
  /** Whether the parsed SRD prints a spell with this id. */
  readonly spellExists: (id: string) => boolean;
  /**
   * Feature ids the granting source itself executes, through a declaration
   * on the source rather than on the feature.
   *
   * A class's `spellcasting` block executes exactly one of its features —
   * the one `ClassSpellcasting.feature` names, `<class>:spellcasting` or
   * `<class>:pact-magic` — so that feature declares nothing of its own and
   * is not the failure rule 4 exists to catch. Derived from the class by
   * whoever builds the context, never typed out.
   */
  readonly executedBySource?: ReadonlySet<string>;
}

const ABILITY_NAMES: ReadonlySet<string> = new Set<Ability>(ABILITIES);

/**
 * A note that says nothing.
 *
 * The failure mode a required note has is not an absent sentence but a hollow
 * one, and this is the half of that which is mechanically checkable — the same
 * floor `refusal-sweep.test.ts` applies to an exemption and
 * `spell-honesty.test.ts` to an adjudication. Whether a note is *true* is
 * review's; whether it is prose rather than a placeholder is this.
 *
 * The second alternative is the one worth having: CLAUDE.md's rule is that "an
 * unexplained 'not automated' is not a useful thing to read at three in the
 * morning", so a bare negation naming nothing is refused while the shortest
 * real note in the engine — "The Wish effect is not modelled." — names Wish
 * and passes.
 */
const HOLLOW_NOTE =
  /^(?:(?:todo|tbd|n\/?a|none|later|unknown)|(?:(?:this )?(?:feature|it) )?(?:is )?not (?:modelled|modeled|automated|implemented|executed|applied|done))\.?$/i;

/** A whole number of at least one — what the SRD prints for a pool's size. */
const isCount = (value: unknown): boolean =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1;

/**
 * The sizing a grant declares, wherever it declares one.
 *
 * Three grant kinds carry one and `poolsFor` reads all three, so a rule that
 * looked only at `pool` would leave Rage's column and Indomitable's unchecked.
 */
const poolSizingOf = (
  grant: FeatureDefinition['grants'],
): { readonly at: string; readonly sizing: PoolSizing } | null => {
  if (grant === undefined) return null;
  if (grant.kind === 'pool') return { at: 'grants', sizing: grant };
  if (grant.kind === 'activated' && grant.pool !== null) return { at: 'grants', sizing: grant };
  if (grant.kind === 'reaction' && grant.declares !== undefined) {
    return { at: 'grants.declares', sizing: grant.declares };
  }
  return null;
};

/** A spread as the rules compare them: the points, largest first. */
const asSpread = (points: readonly number[]): string =>
  [...points].sort((a, b) => b - a).join('+');

/**
 * The branches an `ability-score` choice prints, judged against the two
 * things that read them.
 *
 * `checkFeatureChoices` counts the player's answer into a spread and looks for
 * it here, and it reads the length a legal answer must have off the branches'
 * common total — so branches that disagree about the total would make one of
 * them unanswerable, which is the quiet kind of wrong.
 */
function abilityChoiceProblems(
  feature: FeatureDefinition,
): readonly FeatureDefinitionProblem[] {
  const asked = feature.choice;
  if (asked === undefined || asked.kind !== 'ability-score') return [];
  const found: FeatureDefinitionProblem[] = [];
  const spreads: unknown = asked.spreads;

  if (!Array.isArray(spreads) || spreads.length === 0) {
    return [
      {
        field: 'choice.spreads',
        code: 'bad_ability_spread',
        reason:
          'a choice that raises ability scores prints at least one branch, as the points it puts into that many distinct scores',
      },
    ];
  }

  const totals = new Set<number>();
  const seen = new Set<string>();
  (spreads as readonly unknown[]).forEach((spread, index) => {
    const at = `choice.spreads[${index}]`;
    if (!Array.isArray(spread) || spread.length === 0) {
      found.push({
        field: at,
        code: 'bad_ability_spread',
        reason: 'a branch puts points into at least one score; one that puts none raises nothing',
      });
      return;
    }
    // Six scores, six places for a point to go: a branch naming more distinct
    // scores than a creature has could never be answered.
    if (spread.length > ABILITY_NAMES.size) {
      found.push({
        field: at,
        code: 'bad_ability_spread',
        reason: `a branch spreads points over ${String(spread.length)} distinct scores and a creature has ${String(ABILITY_NAMES.size)}`,
      });
      return;
    }
    const bad = (spread as readonly unknown[]).findIndex((points) => !isCount(points));
    if (bad !== -1) {
      found.push({
        field: `${at}[${bad}]`,
        code: 'bad_ability_spread',
        reason: `a score is raised by a whole number of at least one point, not ${String((spread as readonly unknown[])[bad])}`,
      });
      return;
    }
    const points = spread as readonly number[];
    totals.add(points.reduce((sum, one) => sum + one, 0));
    const shape = asSpread(points);
    if (seen.has(shape)) {
      found.push({
        field: at,
        code: 'duplicate_ability_spread',
        reason: `${shape} is printed twice, and one branch of a sentence is one way of answering it`,
      });
    }
    seen.add(shape);
  });

  if (totals.size > 1) {
    found.push({
      field: 'choice.spreads',
      code: 'uneven_ability_spreads',
      reason: `the branches hand out ${[...totals].sort((a, b) => a - b).join(' and ')} points, and the length of a legal answer is read off that total, so one of them could never be answered`,
    });
  }

  return found;
}

/**
 * The scores an `ability-score-increase` grant raises, and the ceiling it
 * lifts for them.
 *
 * A grant that lifts a maximum for no score lifts it for nobody, and a
 * feature that both names its scores and asks which is two sentences the SRD
 * never prints together — both would read as transcribed and grant something
 * other than what the book says.
 */
function abilityGrantProblems(
  feature: FeatureDefinition,
): readonly FeatureDefinitionProblem[] {
  const grant = feature.grants;
  if (grant === undefined || grant.kind !== 'ability-score-increase') return [];
  const found: FeatureDefinitionProblem[] = [];
  const asks = feature.choice?.kind === 'ability-score';
  const raises: unknown = grant.raises;

  if (raises !== undefined) {
    if (asks) {
      found.push({
        field: 'grants.raises',
        code: 'ability_raise_and_choice',
        reason: `${feature.id} names the scores it raises and asks which to raise; the SRD writes one sentence or the other, and a reader cannot tell which the maximum belongs to`,
      });
    }
    if (!Array.isArray(raises) || raises.length === 0) {
      found.push({
        field: 'grants.raises',
        code: 'bad_ability_raise',
        reason: 'a feature that raises scores outright names at least one, with the points it adds',
      });
    } else {
      const named = new Set<string>();
      (raises as readonly unknown[]).forEach((raise, index) => {
        const at = `grants.raises[${index}]`;
        const entry = raise as { ability?: unknown; points?: unknown } | null;
        if (entry === null || typeof entry !== 'object') {
          found.push({ field: at, code: 'bad_ability_raise', reason: 'a raise names an ability and the points it adds' });
          return;
        }
        if (typeof entry.ability !== 'string' || !ABILITY_NAMES.has(entry.ability as Ability)) {
          found.push({
            field: `${at}.ability`,
            code: 'bad_ability_raise',
            reason: `"${String(entry.ability)}" is not one of the six abilities`,
          });
          return;
        }
        if (!isCount(entry.points)) {
          found.push({
            field: `${at}.points`,
            code: 'bad_ability_raise',
            reason: `a score is raised by a whole number of at least one point, not ${String(entry.points)}`,
          });
        }
        if (named.has(entry.ability)) {
          found.push({
            field: `${at}.ability`,
            code: 'duplicate_ability_raise',
            reason: `${entry.ability} is raised twice by one sentence, and the second would be read and the first forgotten`,
          });
        }
        named.add(entry.ability);
      });
    }
  }

  const maximum: unknown = grant.maximum;
  if (maximum !== undefined) {
    if (!Number.isInteger(maximum) || (maximum as number) <= ABILITY_SCORE_MAXIMUM) {
      found.push({
        field: 'grants.maximum',
        code: 'bad_ability_maximum',
        reason: `a lifted ceiling is a whole number above the ${ABILITY_SCORE_MAXIMUM} every score already has, not ${String(maximum)}`,
      });
    }
    if (raises === undefined && !asks) {
      found.push({
        field: 'grants.maximum',
        code: 'ability_maximum_lifts_nothing',
        reason: `${feature.id} lifts a ceiling for the scores it touches, and it neither names a score nor asks for one, so it would lift nothing for anybody`,
      });
    }
  }

  if (raises === undefined && maximum === undefined) {
    found.push({
      field: 'grants',
      code: 'empty_ability_grant',
      reason: `${feature.id} neither raises a score nor lifts a ceiling, so nothing about it reaches a sheet`,
    });
  }

  return found;
}

/**
 * Everything wrong with a feature definition, rather than the first thing.
 *
 * The shape `checkCharacter` and `checkSpellDefinition` already use, for the
 * same reason: somebody filling in a definition does not want to be told about
 * one mistake at a time. {@link parseFeatureDefinition} is the `Result` half.
 */
export function checkFeatureDefinition(
  feature: FeatureDefinition,
  context: FeatureContext,
): readonly FeatureDefinitionProblem[] {
  const found: FeatureDefinitionProblem[] = [];

  // Rule 1, the half that is about one definition. A feature id is a global
  // key — `featureChoices` is keyed by it, `classLevelFor` splits it on the
  // colon, and it reaches the log inside `character-created`. So the namespace
  // is not decoration.
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*:[a-z0-9]+(?:-[a-z0-9]+)*$/.test(feature.id)) {
    found.push({
      field: 'id',
      code: 'bad_feature_id',
      reason: `"${feature.id}" is not a namespaced id: lower-case hyphenated words either side of one colon, as in "source:feature-name"`,
    });
  }

  if (feature.name.trim().length === 0) {
    found.push({ field: 'name', code: 'bad_name', reason: 'a feature needs a name' });
  }

  if (feature.automation !== 'engine' && feature.automation !== 'manual') {
    found.push({
      field: 'automation',
      code: 'bad_automation',
      reason: `"${String(feature.automation)}" is neither "engine" nor "manual"; there is no third state in which the engine half-does something`,
    });
  }

  // Rule 2. A feature granted at a level its own source's table does not reach
  // is unreachable: `featuresAt` filters by equality and `cumulativeFeatures`
  // by `<=`, so nobody would ever be granted it and nothing would say so.
  if (
    !Number.isInteger(feature.level) ||
    feature.level < 1 ||
    feature.level > context.levels
  ) {
    found.push({
      field: 'level',
      code: 'unreachable_level',
      reason: `level ${feature.level} is outside the 1 to ${context.levels} this source's table reaches, so nothing would ever grant it`,
    });
  }

  // Rule 3. Only of a manual feature: `manual` means a DM applies it, and the
  // note is the whole of what tells them what is left to do. An absent note
  // and a placeholder one are the same failure, so they take one code.
  const note = feature.note.trim();
  if (feature.automation === 'manual' && (note.length === 0 || HOLLOW_NOTE.test(note))) {
    found.push({
      field: 'note',
      code: 'hollow_note',
      reason:
        'a manual feature\'s note says what a DM still has to do; an unexplained "not automated" is not a useful thing to read at three in the morning',
    });
  }

  // Rule 4. The structural form of the nine-features failure: a feature that
  // claims the engine executes it, and declares nothing the engine reads.
  if (feature.automation === 'engine') {
    const grant = feature.grants;
    if (grant !== undefined && !context.readableGrants.has(grant.kind)) {
      found.push({
        field: 'grants.kind',
        code: 'grant_not_read',
        reason: `nothing in the engine's readers discriminates on a "${grant.kind}" grant, so this feature claims to be executed and nothing executes it`,
      });
    }

    const declares = [...context.readableFields].filter(
      (field) => (feature as unknown as Record<string, unknown>)[field] !== undefined,
    );
    // Executed through another feature's declaration, or through the source's
    // own — see {@link FeatureDefinition.executedBy} and
    // {@link FeatureContext.executedBySource}.
    const elsewhere =
      feature.executedBy !== undefined || context.executedBySource?.has(feature.id) === true;
    if (declares.length === 0 && !elsewhere) {
      found.push({
        field: 'automation',
        code: 'engine_declares_nothing',
        reason: `this feature claims to be executed and declares none of ${[...context.readableFields].sort().join(', ')}, so nothing on the feature reaches a reader`,
      });
    }
  }

  // Rule 5. A fixed grant is the feature's own answer rather than the
  // player's, so its ids are never validated against a character's choices —
  // which is precisely why a typo in one would go unseen for ever.
  const grant = feature.grants;
  if (grant?.kind === 'spells' && grant.fixed !== undefined) {
    if (grant.fixed.length === 0) {
      found.push({
        field: 'grants.fixed',
        code: 'empty_spell_grant',
        reason: 'a fixed spell grant that names no spell grants nothing',
      });
    }
    grant.fixed.forEach((id, index) => {
      if (!context.spellExists(id)) {
        found.push({
          field: `grants.fixed[${index}]`,
          code: 'unknown_granted_spell',
          reason: `the SRD prints no spell with the id "${id}"`,
        });
      }
    });
    const seen = new Set<string>();
    grant.fixed.forEach((id, index) => {
      if (seen.has(id)) {
        found.push({
          field: `grants.fixed[${index}]`,
          code: 'duplicate_granted_spell',
          reason: `"${id}" is granted twice by one feature`,
        });
      }
      seen.add(id);
    });
  }

  // Rule 6. The three ways the SRD sizes a pool, which are the three branches
  // `poolSizeOf` implements — plus its fourth, which names no shape at all and
  // is a pool of one ("Once you use this feature, you can't do so again until
  // you finish a Long Rest").
  const sized = poolSizingOf(grant);
  if (sized !== null) {
    const { at, sizing } = sized;
    const shapes = [
      sizing.usesByLevel === undefined ? null : 'usesByLevel',
      sizing.fromAbilityModifier === undefined ? null : 'fromAbilityModifier',
      sizing.perClassLevel === undefined ? null : 'perClassLevel',
    ].filter((shape): shape is string => shape !== null);

    if (shapes.length > 1) {
      found.push({
        field: at,
        code: 'ambiguous_pool_sizing',
        reason: `${shapes.join(' and ')} both size this pool, and poolSizeOf reads exactly one — the others are silently ignored`,
      });
    }

    if (sizing.usesByLevel !== undefined) {
      if (sizing.usesByLevel.length !== context.levels) {
        found.push({
          field: `${at}.usesByLevel`,
          code: 'not_a_table_column',
          reason: `a column of this source's table has ${context.levels} entries, not ${sizing.usesByLevel.length}`,
        });
      }
      // A use count may be zero — the levels before the feature arrives — but
      // never negative and never fractional.
      const bad = sizing.usesByLevel.findIndex(
        (uses) => !Number.isInteger(uses) || uses < 0,
      );
      if (bad !== -1) {
        found.push({
          field: `${at}.usesByLevel[${bad}]`,
          code: 'bad_pool_sizing',
          reason: `a class table prints a whole number of uses, not ${String(sizing.usesByLevel[bad])}`,
        });
      }
    }

    if (
      sizing.fromAbilityModifier !== undefined &&
      !ABILITY_NAMES.has(sizing.fromAbilityModifier)
    ) {
      found.push({
        field: `${at}.fromAbilityModifier`,
        code: 'bad_pool_sizing',
        reason: `"${String(sizing.fromAbilityModifier)}" is not one of the six abilities`,
      });
    }

    if (sizing.perClassLevel !== undefined && !isCount(sizing.perClassLevel)) {
      found.push({
        field: `${at}.perClassLevel`,
        code: 'bad_pool_sizing',
        reason: `a multiple of the class level is a whole number of at least one, not ${String(sizing.perClassLevel)}`,
      });
    }

    if (sizing.minimum !== undefined && !isCount(sizing.minimum)) {
      found.push({
        field: `${at}.minimum`,
        code: 'bad_pool_sizing',
        reason: `a floor is a whole number of at least one, not ${String(sizing.minimum)}`,
      });
    }
  }

  // Rule 8, the half a definition can answer about itself — rule 7 is the
  // population's and lives below. The other half, whether the sibling a grant
  // names exists and asks anything, is `checkContent`'s: it needs the source
  // this feature belongs to, which a feature does not know.
  const table = feature.optionMeans;
  if (table !== undefined) {
    const asked = feature.choice;
    if (asked === undefined || asked.kind !== 'option') {
      found.push({
        field: 'optionMeans',
        code: 'table_without_a_choice',
        reason:
          asked === undefined
            ? 'a table of what each option means is keyed by a choice, and this feature asks for none'
            : `a "${asked.kind}" choice offers no named options for a table to be keyed by`,
      });
    } else {
      const offered = new Set(asked.from);
      for (const option of asked.from) {
        if (!Object.prototype.hasOwnProperty.call(table, option)) {
          found.push({
            field: `optionMeans.${option}`,
            code: 'option_missing_from_table',
            reason: `the choice offers ${option} and the table says nothing about it, so a character who took it would get nothing and nothing would say so`,
          });
        }
      }
      for (const key of Object.keys(table)) {
        if (!offered.has(key)) {
          found.push({
            field: `optionMeans.${key}`,
            code: 'unknown_option_in_table',
            reason: `the table says what ${key} means and the choice does not offer it, so nobody can pick it`,
          });
        }
      }
    }

    // The values, whatever the keys came to. An unknown *field* on a meaning
    // is left alone — see {@link FeatureOptionMeaning} — but a field this
    // engine does know has to be the shape it knows.
    for (const [key, meaning] of Object.entries(table)) {
      if (typeof meaning !== 'object' || meaning === null || Array.isArray(meaning)) {
        found.push({
          field: `optionMeans.${key}`,
          code: 'bad_option_meaning',
          reason: 'what an option means is an object saying what it supplies',
        });
        continue;
      }
      const types = (meaning as FeatureOptionMeaning).damageTypes;
      if (
        types !== undefined &&
        (!Array.isArray(types) ||
          types.length === 0 ||
          types.some((type) => typeof type !== 'string' || type.trim().length === 0))
      ) {
        found.push({
          field: `optionMeans.${key}.damageTypes`,
          code: 'bad_option_meaning',
          reason: 'damage types an option supplies are a non-empty list of named types',
        });
      }
    }
  }

  // Rule 9. Two points of ability, and a score above twenty — the shape every
  // class prints twice. Both halves are checkable one definition at a time,
  // because both live on the same feature: the branches the sentence offers,
  // and the scores its grant raises or lifts a ceiling for.
  found.push(...abilityChoiceProblems(feature));
  found.push(...abilityGrantProblems(feature));

  // And the reading end of the same rule: the field says where a choice is
  // read *from*, so a grant that reads no choice names a source for nothing.
  if (
    grant?.kind === 'standing' &&
    grant.choiceFrom !== undefined &&
    grant.damageTypesFromChoice !== true &&
    grant.onlyIfChoice === undefined
  ) {
    found.push({
      field: 'grants.choiceFrom',
      code: 'choice_from_reads_nothing',
      reason: `${feature.id} says its choice is made on ${grant.choiceFrom} and nothing on the grant reads a choice`,
    });
  }

  return found;
}

/**
 * Rule 1's other half, which is about a population rather than a definition.
 *
 * Two features may not share an id anywhere in the engine, not merely within
 * one class: `featureChoices` is one flat record keyed by feature id, and a
 * multiclassed character holds features from two classes at once.
 */
export function duplicateFeatureIds(
  features: readonly FeatureDefinition[],
): readonly string[] {
  const seen = new Set<string>();
  const shared = new Set<string>();
  for (const feature of features) {
    if (seen.has(feature.id)) shared.add(feature.id);
    seen.add(feature.id);
  }
  return [...shared].sort();
}

/**
 * Enough of the shape that the semantic rules can read it without throwing.
 *
 * Not a second copy of the type: the compiler owns the shape for anything
 * written in this repository, and this exists for the input that was not. So
 * it checks the fields the rules above **dereference**, and stops — an unknown
 * extra field is not an error, because a definition written against a later
 * engine is data this one does not understand rather than data that is wrong.
 *
 * The dereferences are the whole of the list: rule 4 reads `grants.kind`, rule
 * 5 walks `grants.fixed`, and rule 6 measures the three arrays a `PoolSizing`
 * may carry. Each is a place where an untyped blob turns a refusal into a
 * `TypeError`, and **rules-legal refusals are values, not exceptions.**
 */
function checkFeatureShape(value: unknown): FeatureDefinitionProblem | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { field: '', code: 'not_a_feature', reason: 'a feature definition is an object' };
  }
  const record = value as Record<string, unknown>;

  if (record['executedBy'] !== undefined && typeof record['executedBy'] !== 'string') {
    return { field: 'executedBy', code: 'bad_feature_shape', reason: 'executedBy names a feature id' };
  }
  // Rule 8 walks the table's keys and its values; a string here would walk as
  // an array of characters and report options nobody wrote.
  const table = record['optionMeans'];
  if (table !== undefined && (typeof table !== 'object' || table === null || Array.isArray(table))) {
    return {
      field: 'optionMeans',
      code: 'bad_feature_shape',
      reason: 'a table of what each option means is an object keyed by the option',
    };
  }
  for (const field of ['id', 'name', 'automation', 'note'] as const) {
    if (typeof record[field] !== 'string') {
      return {
        field,
        code: 'bad_feature_shape',
        reason: `every feature definition carries a string ${field}`,
      };
    }
  }
  if (typeof record['level'] !== 'number') {
    return {
      field: 'level',
      code: 'bad_feature_shape',
      reason: 'every feature definition carries a level',
    };
  }

  const grants = record['grants'];
  if (grants === undefined) return null;
  if (typeof grants !== 'object' || grants === null || Array.isArray(grants)) {
    return { field: 'grants', code: 'bad_feature_shape', reason: 'a grant is an object' };
  }
  const grant = grants as Record<string, unknown>;
  if (typeof grant['kind'] !== 'string') {
    return {
      field: 'grants.kind',
      code: 'bad_feature_shape',
      reason: 'a grant says which kind it is, as a string',
    };
  }

  // Rule 8's reading end names a feature, exactly as `executedBy` does.
  if (grant['choiceFrom'] !== undefined && typeof grant['choiceFrom'] !== 'string') {
    return {
      field: 'grants.choiceFrom',
      code: 'bad_feature_shape',
      reason: 'choiceFrom names the feature whose choice this grant reads',
    };
  }

  if (grant['fixed'] !== undefined) {
    if (!Array.isArray(grant['fixed']) || grant['fixed'].some((id) => typeof id !== 'string')) {
      return {
        field: 'grants.fixed',
        code: 'bad_feature_shape',
        reason: 'a fixed spell grant is a list of spell ids',
      };
    }
  }

  // `declares` is where a reaction grant keeps its sizing, so its arrays are
  // read exactly as the grant's own are.
  const declares = grant['declares'];
  if (declares !== undefined && (typeof declares !== 'object' || declares === null)) {
    return {
      field: 'grants.declares',
      code: 'bad_feature_shape',
      reason: 'a declared pool is an object',
    };
  }
  for (const [at, holder] of [
    ['grants', grant],
    ['grants.declares', declares as Record<string, unknown> | undefined],
  ] as const) {
    if (holder === undefined) continue;
    const column = holder['usesByLevel'];
    if (column === undefined) continue;
    if (!Array.isArray(column) || column.some((uses) => typeof uses !== 'number')) {
      return {
        field: `${at}.usesByLevel`,
        code: 'bad_feature_shape',
        reason: 'a column of a class table is a list of numbers',
      };
    }
  }

  return null;
}

/**
 * A definition, or the first thing wrong with it.
 *
 * Takes `unknown` deliberately, for the reason `parseSpellDefinition` does:
 * the point of a validator is that a definition need not have come through the
 * compiler. The shape is checked first and the semantics second, so a caller
 * handing over a JSON blob gets the same answers as one handing over a
 * compiled constant — and, in particular, gets an answer at all rather than an
 * exception.
 */
export function parseFeatureDefinition(
  value: unknown,
  context: FeatureContext,
): Result<FeatureDefinition> {
  const shape = checkFeatureShape(value);
  if (shape !== null) {
    return err(shape.code, shape.field === '' ? shape.reason : `${shape.field}: ${shape.reason}`);
  }

  const problems = checkFeatureDefinition(value as FeatureDefinition, context);
  if (problems.length > 0) {
    const first = problems[0]!;
    return err(first.code, `${first.field}: ${first.reason}`);
  }
  return ok(value as FeatureDefinition);
}

// `spell-schema.ts` carries a third entry point — every problem at once, over
// untyped input — and this deliberately does not. It would have no user, and a
// member with no user is a guess dressed up as a structure: add it with the
// authoring path that wants it, not ahead of one.

/**
 * Comments removed, so a kind named only in prose is not mistaken for a reader.
 *
 * This file's whole population is heavily documented — `progression.ts` names
 * every grant kind in prose several times over — so a search that counted a
 * docstring would report that everything is read and check nothing.
 */
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

/**
 * The `FeatureGrant` members the engine's readers actually discriminate on.
 *
 * Derived from the readers rather than listed, because rule 4 is about a claim
 * nobody checked and a hand-kept list is another one. A kind is readable when
 * it appears as a string literal in reader *code*.
 *
 * **The probe is coarser than the reader**, deliberately and in the way
 * `spell-schema.test.ts`'s member sweep already is: it matches the literal
 * anywhere in code rather than only in a `kind ===` position, because
 * `choicesGranting(choices, features, 'expertise')` passes the kind as a typed
 * *argument* and a position-aware probe would call Expertise unread. What that
 * coarseness costs is a kind whose name the readers use for something else —
 * there is none today, and the union's members are hyphenated phrases
 * (`unarmored-defense`, `widens-reaction`) rather than ordinary words.
 */
export function readableGrantKinds(
  declared: Iterable<string>,
  readerSources: readonly string[],
): ReadonlySet<string> {
  const code = readerSources.map(stripComments).join('\n');
  const readable = new Set<string>();
  for (const kind of declared) {
    if (code.includes(`'${kind}'`) || code.includes(`"${kind}"`)) readable.add(kind);
  }
  return readable;
}

/**
 * The optional `FeatureDefinition` fields the readers dereference.
 *
 * The boundary matters: `.grants` must not be matched by `.grantsFeat`, which
 * is a different field read by a different rule. A loose boundary would make
 * every `grantsFeat` reader look like a `grants` reader and the derivation
 * would answer "yes" to everything.
 */
export function readableFeatureFields(
  declared: Iterable<string>,
  readerSources: readonly string[],
): ReadonlySet<string> {
  const code = readerSources.map(stripComments).join('\n');
  const readable = new Set<string>();
  for (const field of declared) {
    if (new RegExp(`\\.${field}(?![A-Za-z0-9_$])`).test(code)) readable.add(field);
  }
  return readable;
}

/**
 * The kinds the `FeatureGrant` union declares, read out of its own source.
 *
 * **The union's arms and not the unions nested inside them.** `recovery`
 * carries `restores: { kind: 'pool' } | { kind: 'pact-slots' }`, and
 * `pact-slots` is not a `FeatureGrant` member — reading it as one would report
 * a member nobody could ever write, which is the one thing a guard must not
 * do. Prettier writes a top-level arm at two spaces and a nested one deeper,
 * so the arms are what the split reads.
 */
export function declaredGrantKinds(progressionSource: string): ReadonlySet<string> {
  const start = progressionSource.indexOf('export type FeatureGrant =');
  if (start === -1) return new Set();
  const rest = progressionSource.slice(start + 'export type FeatureGrant ='.length);
  const end = rest.search(/^export /m);
  const union = end === -1 ? rest : rest.slice(0, end);

  const kinds = new Set<string>();
  for (const arm of union.split(/^ {2}\| /m).slice(1)) {
    const match = /readonly kind: '([a-z0-9-]+)'/.exec(stripComments(arm));
    if (match?.[1] !== undefined) kinds.add(match[1]);
  }
  return kinds;
}

/**
 * The optional fields `FeatureDefinition` declares, read out of its own source.
 *
 * The candidates rule 4's second half asks about: a feature is executed
 * through one of these or through nothing on the feature at all.
 *
 * **The interface's own fields, not the ones inside them.** `grantsFeat` is
 * declared as an inline object carrying its own optional `spellList`, on the
 * same line — so indentation cannot separate the two and the probe anchors to
 * the start of a line instead. Reading `spellList` as a field of a feature
 * would report a field no reader reads that no definition declares either,
 * which is the same false positive the nested-union case has.
 */
export function declaredOptionalFields(progressionSource: string): ReadonlySet<string> {
  const start = progressionSource.indexOf('export interface FeatureDefinition {');
  if (start === -1) return new Set();
  const rest = progressionSource.slice(start);
  const end = rest.search(/^}/m);
  const body = stripComments(end === -1 ? rest : rest.slice(0, end));

  const fields = new Set<string>();
  for (const match of body.matchAll(/^ {2}readonly ([A-Za-z0-9_$]+)\?:/gm)) {
    if (match[1] !== undefined) fields.add(match[1]);
  }
  return fields;
}

/**
 * Rule 7: the members no class writes.
 *
 * **Names, never a count.** A count needs maintaining by whoever next changes
 * the format and passes for the wrong reason the moment two changes cancel.
 * A member that turns out to have zero users is *reported* here and never
 * removed — removing one belongs to `progression.ts`'s owner.
 */
export function unwrittenGrantKinds(
  declared: Iterable<string>,
  written: ReadonlySet<string>,
): readonly string[] {
  return [...declared].filter((kind) => !written.has(kind)).sort();
}
