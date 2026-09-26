import { readFileSync, readdirSync } from 'node:fs';
import { SRD_CONTENT } from '@ie/content';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Rule 4's other half, asserted rather than left to review.
 *
 * `spell-schema.test.ts` holds the spell and class half: no engine file names
 * a spell of the catalogue, writes a definition's `id:` line, writes a fixed
 * spell grant, or names a class. The other populations the registry
 * holds — **species, backgrounds, feats and the features any of them grant** —
 * were held by a reader noticing, and by nothing else. `docs/design/content.md`
 * says so in as many words, and calls it "a gap noticed while the
 * sibling-choice grant was built, and worth closing with a test rather than a
 * habit". This is that test.
 *
 * **And since the structure audit of 2026-09-21, the last four as well:**
 * items, languages, alignments and monsters. `Content` declares ten
 * populations; the two sweeps between them covered six, and for the rest the
 * rule was a promise. The whole bestiary and every item, language and
 * alignment are swept here now, and what that found is written up under
 * {@link ALSO_VOCABULARY}: four collisions, every one a word the engine
 * would still write if the SRD sold none of them, and no breach.
 *
 * It is the spell sweep's argument applied to the other half, so it repeats
 * the three choices that argument turns on:
 *
 * - **A file listing rather than an array.** Every non-test source under
 *   `src`, at any depth, found by reading the directory. A hand-kept list of
 *   modules is the thing these sweeps exist to replace; the spell sweep's
 *   list was wrong twice before it became a listing.
 * - **A population derived from the catalogue.** Whatever species,
 *   backgrounds, feats and features `SRD_CONTENT` holds are the ids swept,
 *   so content added tomorrow is swept tomorrow without anyone remembering.
 * - **A mutation driven against every file the sweep covers**, not against a
 *   string written here. A sweep whose only evidence is that nothing threw
 *   passes just as happily when it is broken.
 *
 * It lives beside `spell-schema.test.ts` rather than inside
 * `feature-schema.test.ts` because `feature-schema.test.ts` is the *validator's*
 * file — it asks whether one feature definition is coherent, and reads three
 * named reader modules as one string to do it. This asks a different question
 * of the whole runtime, about eight populations of which features are only one,
 * three of which have no validator file to live in. Two instruments asking
 * different questions is the point, and folding this in would have made that
 * file two instruments wearing one name.
 */
describe('no origin, feat, feature, item, language, alignment or monster is special-cased', () => {
  const here = fileURLToPath(new URL('.', import.meta.url));

  /** Every non-test source file under `src`, at any depth. */
  const sourcesUnder = (dir: string, prefix = ''): readonly string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory()
        ? sourcesUnder(`${dir}${entry.name}/`, `${prefix}${entry.name}/`)
        : entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')
          ? [`${prefix}${entry.name}`]
          : [],
    );

  const RUNTIME = sourcesUnder(here);
  const source = (file: string): string => readFileSync(`${here}${file}`, 'utf8');

  /**
   * The populations, read off the catalogue.
   *
   * A feature belongs to whatever granted it, so the feature population is
   * every feature every class, subclass, species and background declares —
   * asked of the four holders rather than of a list, for the same reason the
   * file listing is a listing.
   *
   * **Items, languages, alignments and monsters were the four `Content`
   * declares that nothing swept.** `spell-schema.test.ts` holds spells and
   * classes, this file held species, backgrounds, feats and features, and
   * rule 4 names ten populations — so it was enforced for six and promised
   * for four, which is the shape of a rule that is true until the day it
   * is not. They are here now, and the hole turned out to be empty: the four
   * hits are all mechanics wearing an item's name rather than breaches, and
   * each is argued one at a time under {@link ALSO_VOCABULARY}.
   */
  const POPULATIONS = {
    species: SRD_CONTENT.species.map((entry) => entry.id),
    background: SRD_CONTENT.backgrounds.map((entry) => entry.id),
    feat: SRD_CONTENT.feats.map((entry) => entry.id),
    feature: [
      ...SRD_CONTENT.classes,
      ...SRD_CONTENT.subclasses,
      ...SRD_CONTENT.species,
      ...SRD_CONTENT.backgrounds,
    ].flatMap((holder) => holder.features.map((feature) => feature.id)),
    item: SRD_CONTENT.items.map((entry) => entry.id),
    language: SRD_CONTENT.languages.map((entry) => entry.id),
    alignment: SRD_CONTENT.alignments.map((entry) => entry.id),
    monster: SRD_CONTENT.monsters.map((entry) => entry.id),
  } as const;

  /**
   * Where a catalogue id is also a word the **engine's own vocabulary** uses.
   *
   * The spell sweep next door keeps the same list for the same reason, and
   * its docstring argues the case eight times over: `shield` is an item and
   * a spell and the thing `fold/inventory.ts` equips; `darkvision` is a spell
   * and a sense the rules glossary defines. A catalogue must not be unable to
   * hold an entry because its slug collides with a mechanic the engine
   * executes.
   *
   * The widening found four, all of them item slugs, and every one is a word
   * the engine would still be writing if the SRD sold none of them. **The
   * breach record below is still empty**, which is a claim about each of
   * these four and is why each gets its own paragraph.
   *
   * - **`spellbook`.** `SpellcastingStyle` has had a `spellbook` member since
   *   the Wizard was built — the style of preparation where spells are copied
   *   into a book and prepared from it — and `creation.ts` and
   *   `progression.ts` write the word thirteen times deciding how a class
   *   prepares. The SRD also sells a Spellbook for 50 gp under the same slug.
   * - **`shield`.** The armour record's `category` is
   *   `light | medium | heavy | shield`, and `fold/inventory.ts` sorts worn
   *   pieces into the two slots by reading it. The spell sweep excuses the
   *   same word for the same file by name, which is this argument already
   *   made once.
   * - **`ammunition`.** A member of `ItemKind` (`catalogue.ts`), the closed
   *   vocabulary for what *kind* of thing an item is. A homebrew quiver of
   *   bolts is `kind: 'ammunition'` and gets the same treatment.
   * - **`string`.** `typeof entry === 'string'`, in a dozen files. The SRD
   *   sells ten feet of String for a copper piece, and its slug is the name
   *   of a primitive type. This is the flattest collision in the repository
   *   and it excuses the least: nothing about `typeof` reads a catalogue.
   *
   * The test in each case is the one the feat allowance below states —
   * delete the catalogue entry and see whether the engine still means the
   * word — and all four pass it. Named one word at a time rather than matched
   * loosely, so each entry is reviewed rather than being a heuristic that
   * quietly stops catching things.
   */
  const ALSO_VOCABULARY: ReadonlySet<string> = new Set([
    'spellbook',
    'shield',
    'ammunition',
    'string',
  ]);

  type Kind = keyof typeof POPULATIONS;
  const KINDS = Object.keys(POPULATIONS) as readonly Kind[];

  /** Every id in the catalogue, tagged with which population it came from. */
  const CATALOGUE: readonly (readonly [Kind, string])[] = KINDS.flatMap((kind) =>
    POPULATIONS[kind].map((id) => [kind, id] as const),
  );

  // — the one construct that is data rather than a branch ————————————————

  /** A named declaration's text, from its `export` to the next one. */
  const declarationOf = (text: string, name: string): string => {
    const start = text.indexOf(`export type ${name} =`);
    const end = text.indexOf('\nexport ', start + 1);
    return start < 0 ? '' : text.slice(start, end < 0 ? undefined : end);
  };

  /**
   * Where naming a feat id is **mechanics** rather than a branch on content.
   *
   * One construct, and it is excused as a *construct* — matched by shape,
   * wherever it is written — rather than as a line or a file, which is the
   * distinction the spell sweep's own docstring records going wrong the one
   * time it was written the other way.
   *
   * `FeatRequirement` is the engine's closed vocabulary for what a feat asks
   * of the character who takes it, and one of its kinds is spelled
   * `magic-initiate`, which is also the id of the SRD feat that first needed
   * it. Branching on a requirement *kind* is branching on a mechanic the
   * engine executes, exactly as branching on an effect kind is: a homebrew
   * feat called anything at all gets the same treatment by declaring
   * `requires: { kind: 'magic-initiate', … }`, and deleting the SRD's feat
   * changes nothing. That is the test for whether a string is a catalogue id
   * or a mechanic, and this passes it.
   *
   * So the kinds are read out of the union the engine declares rather than
   * written down here, and only a `kind:` or `kind ===` beside one of them is
   * excused. The same word written anywhere else — `featId === 'magic-initiate'`
   * above all — still counts, which is asserted below.
   */
  const REQUIREMENT_KINDS: readonly string[] = [
    ...declarationOf(source('origins.ts'), 'FeatRequirement').matchAll(/kind: '([a-z0-9-]+)'/g),
  ].flatMap((match) => match.slice(1));

  const REQUIREMENT_KIND = new RegExp(
    String.raw`kind\s*(?::|[=!]==)\s*'(?:${REQUIREMENT_KINDS.join('|')})'`,
    'g',
  );

  /** A file's text with that one data construct removed. */
  const proseOf = (text: string): string => text.replace(REQUIREMENT_KIND, "kind: 'a-mechanic'");

  /** Every catalogue id a file names outside that construct, tagged by population. */
  const namedIn = (text: string): readonly string[] => {
    const prose = proseOf(text);
    return CATALOGUE.filter(([, id]) => !ALSO_VOCABULARY.has(id))
      .filter(([, id]) => prose.includes(`'${id}'`) || prose.includes(`"${id}"`))
      .map(([kind, id]) => `${kind} ${id}`);
  };

  // — and the direct shape: an id compared against a literal ————————————————

  /**
   * The field spellings an id arrives under, derived from the population names
   * rather than listed: `speciesId` / `species.id`, and so on for all four.
   *
   * A prefix is enough — `choices.feats[i].featId` is caught by `featId`, the
   * way `request.spellId` is caught by `spellId` next door. What is compared
   * is not narrowed to catalogue ids: comparing an id field against *any*
   * literal is the failure, whether or not the literal is one the SRD happens
   * to print today.
   */
  const COMPARED_FIELDS = KINDS.flatMap((kind) => [`${kind}Id`, String.raw`${kind}\.id`]);

  const COMPARISON = new RegExp(
    String.raw`(?:${COMPARED_FIELDS.join('|')})\s*[=!]==\s*['"][a-z0-9-]+(?::[a-z0-9-]+)?['"]`,
    'g',
  );

  /** Every `<id field> === '<literal>'` a file writes, as written. */
  const comparedIn = (text: string): readonly string[] =>
    [...text.matchAll(COMPARISON)].map((match) => match[0]);

  // — what the sweep found the day it was written ——————————————————————————

  /**
   * **The record is empty, and the machinery stays.**
   *
   * There were two. The first was cosmetic — `feature-schema.ts` taught the id
   * format with `"wizard:arcane-recovery"`, a live SRD feature — and the
   * example became a generic one. The second was `creation.ts` reading one
   * feat by name, `feat.featId === 'alert'`, and paying out the Initiative
   * bonus itself; it went the way this record is designed to send a breach.
   * Alert's benefit is declared by the feat now — `FeatureGrant`
   * `initiative-proficiency`, read by `declaredInitiativeBonuses` — and the
   * entry was deleted in the same commit that made the deletion necessary,
   * because the test below fails while a fixed breach is still recorded.
   *
   * The shape is kept rather than deleted with the last entry. A breach in
   * engine code is its own brief, and the discipline is the point: it is
   * recorded with the line that is wrong, the honest assertion is written and
   * **skipped** so the suite says out loud what it is not checking, and a
   * separate test holds each breached file to *exactly* this record — so a new
   * id smuggled into a breached file still fails, and a breach that gets fixed
   * fails too, until its entry here is deleted. With nothing recorded, every
   * runtime file is swept by the two unconditional sweeps above and nothing is
   * excused at all, which is the state this record exists to reach.
   *
   * What is never done is the thing this whole sweep exists to prevent:
   * quietly widening an exemption until the breach is spelled "allowed".
   */
  interface Breach {
    readonly file: string;
    readonly line: string;
    readonly named: readonly string[];
    readonly compared: readonly string[];
  }

  const BREACHES: readonly Breach[] = [];

  const BREACHED = new Set(BREACHES.map((breach) => breach.file));
  const CLEAN = RUNTIME.filter((file) => !BREACHED.has(file));

  // — the sweep ————————————————————————————————————————————————————————————

  it.each(CLEAN.map((file) => [file] as const))(
    '%s compares no catalogue id this sweep holds against a literal',
    (file) => {
      expect(comparedIn(source(file)), file).toEqual([]);
    },
  );

  it.each(CLEAN.map((file) => [file] as const))(
    '%s names no origin, feat, feature, item, language, alignment or monster',
    (file) => {
      expect(namedIn(source(file)), file).toEqual([]);
    },
  );

  /** The honest assertion for any that fail it, written and skipped. */
  it.skip.each(BREACHES.length === 0 ? [] : BREACHES)(
    'A BREACH ON THE RECORD, NOT FIXED HERE — $file holds `$line`',
    (breach) => {
      expect(namedIn(source(breach.file)), breach.file).toEqual([]);
      expect(comparedIn(source(breach.file)), breach.file).toEqual([]);
    },
  );

  /**
   * And the record cannot rot in either direction.
   *
   * Equality rather than containment: an id smuggled into a breached file
   * fails here, and so does a breach somebody fixed — which is the failure
   * that says "delete this entry", and the only way a skipped test ever comes
   * back.
   */
  it('holds every breached file to exactly the breach on the record, and no more', () => {
    for (const breach of BREACHES) {
      expect(source(breach.file), breach.file).toContain(breach.line);
      expect(namedIn(source(breach.file)), breach.file).toEqual(breach.named);
      expect(comparedIn(source(breach.file)), breach.file).toEqual(breach.compared);
    }
    // And with an empty record, every runtime file is swept above with nothing
    // excused — asserted rather than assumed, so emptying the list cannot be
    // mistaken for deleting the sweep.
    expect(CLEAN).toEqual(RUNTIME);
  });

  // — the proof that none of the above is vacuous ————————————————————————

  /**
   * The mutation, driven against **every** file the sweep covers — any
   * breached ones included, since they are still swept for anything new.
   *
   * One smuggled special case per population, so no kind is covered only in
   * principle: a file that somehow excused the smuggled line would be a file
   * this sweep does not really cover, and it would say so by name.
   */
  const SAMPLE: Readonly<Record<Kind, string>> = {
    species: 'dragonborn',
    background: 'acolyte',
    feat: 'savage-attacker',
    feature: 'wizard:scholar',
    item: 'longsword',
    language: 'dwarvish',
    alignment: 'chaotic-evil',
    monster: 'commoner',
  };

  it.each(RUNTIME.map((file) => [file] as const))(
    '%s would fail if a special case were smuggled into it',
    (file) => {
      const text = source(file);
      for (const kind of KINDS) {
        const smuggled = `${text}\nif (choice.${kind}Id === '${SAMPLE[kind]}') return err('no');\n`;
        expect(comparedIn(smuggled), `${file}: ${kind}`).toContain(
          `${kind}Id === '${SAMPLE[kind]}'`,
        );
        expect(namedIn(smuggled), `${file}: ${kind}`).toContain(`${kind} ${SAMPLE[kind]}`);
      }
    },
    // Eight scans of the file each: `spell-definitions.ts` takes ~2.6 s alone
    // and past the 5 s default under a full run beside other worktrees' suites.
    30_000,
  );

  it('has a population and a catalogue worth sweeping', () => {
    expect(RUNTIME).toContain('origins.ts');
    expect(RUNTIME).toContain('creation.ts');
    expect(RUNTIME).toContain('progression.ts');
    expect(RUNTIME).toContain('commands/turns.ts');
    expect(RUNTIME).toContain('fold/apply.ts');
    expect(RUNTIME.filter((file) => file.endsWith('.test.ts'))).toEqual([]);
    // A floor rather than a count, for the reason `COVERAGE.md` exists: the
    // populations grow, and what they must never do is quietly become none.
    expect(RUNTIME.length).toBeGreaterThan(40);
    for (const kind of KINDS) expect(POPULATIONS[kind].length, kind).toBeGreaterThan(3);
    expect(POPULATIONS.feature.length).toBeGreaterThan(200);
    // The four the mutation drives are really in the catalogue, so a rename in
    // content fails here rather than turning the mutation into a no-op.
    for (const kind of KINDS) expect(POPULATIONS[kind], kind).toContain(SAMPLE[kind]);
  });

  /**
   * Every kind is watched under a spelling the engine really writes — except
   * the one it writes none of, which is pinned rather than waved through.
   *
   * Both spellings are swept for each kind because either could arrive, but
   * at least one has to be live or the kind is watched only in theory — which
   * is how a field rename blinds a sweep without turning it red.
   *
   * **`alignment` is the exception and is the honest answer**, not a hole.
   * Nothing in the 2024 rules hangs off the choice — `origins.ts` says the
   * nine "are recorded rather than read from" — so the engine has no
   * `alignmentId` field and no `alignment.id` read, and the comparison half
   * of this sweep watches the population in principle only. The *naming* half
   * above still sweeps all nine ids in every file, which is the half that
   * would catch a `'lawful-good'` appearing in a rule. Pinned as equality, so
   * the day the engine reads an alignment off anything this test fails and
   * the exception is deleted rather than inherited.
   */
  it('watches a field spelling each population really writes', () => {
    const whole = RUNTIME.map(source).join('\n');
    const written = (kind: Kind): boolean =>
      [`${kind}Id`, `${kind}.id`].some((field) => whole.includes(field));
    expect(KINDS.filter((kind) => !written(kind))).toEqual(['alignment']);
  });

  /**
   * The vocabulary allowance is needed, is narrow, and blinds only one half.
   *
   * Three claims, because a word list is the easiest kind of exemption to
   * let rot. Each word must really be a catalogue id (or it excuses nothing
   * and should go), the engine must really write it (same), and the
   * comparison half of the sweep must still catch it — `item.id === 'shield'`
   * is a branch on a catalogue entry whatever the word is, and the allowance
   * has no business excusing that.
   */
  it('excuses a vocabulary word in prose, and never in a comparison', () => {
    const ids = new Set(CATALOGUE.map(([, id]) => id));
    const whole = RUNTIME.map(source).join('\n');
    expect([...ALSO_VOCABULARY].filter((word) => !ids.has(word))).toEqual([]);
    expect([...ALSO_VOCABULARY].filter((word) => !whole.includes(`'${word}'`))).toEqual([]);
    for (const word of ALSO_VOCABULARY) {
      expect(namedIn(`const x = '${word}';`), word).toEqual([]);
      expect(comparedIn(`if (item.id === '${word}') return;`), word).toEqual([
        `item.id === '${word}'`,
      ]);
    }
  });

  /** And the one allowance is needed, and is narrow. */
  it('excuses a mechanic kind that collides with a feat id, and nothing else', () => {
    // Needed: the engine really declares a requirement kind spelled like a
    // feat, and really branches on it. Derived, so it is the collision that is
    // excused rather than a word somebody typed here.
    const collisions = REQUIREMENT_KINDS.filter((kind) => POPULATIONS.feat.includes(kind));
    expect(collisions).not.toEqual([]);
    // Pinned as well as derived, the way the spell sweep pins its two words:
    // deriving keeps the allowance honest about *why* a word is excused, and
    // pinning makes a second collision arrive as a failure a reviewer reads
    // rather than as an exemption that granted itself.
    expect(collisions).toEqual(['magic-initiate']);
    for (const kind of collisions) {
      expect(source('creation.ts')).toContain(`requires.kind === '${kind}'`);

      // Narrow: excused where it is a kind, and nowhere else on earth.
      expect(namedIn(`kind === '${kind}'`)).toEqual([]);
      expect(namedIn(`{ readonly kind: '${kind}'; readonly lists: readonly string[] }`)).toEqual([]);
      expect(namedIn(`const x = '${kind}';`)).toEqual([`feat ${kind}`]);
      expect(namedIn(`if (feat.featId === '${kind}') return;`)).toEqual([`feat ${kind}`]);
      expect(comparedIn(`if (feat.featId === '${kind}') return;`)).toEqual([
        `featId === '${kind}'`,
      ]);
    }
    // And a kind that is not a feat id is excused nothing it needed excusing
    // for, which is what keeps the allowance from being a word list.
    expect(REQUIREMENT_KINDS.length).toBeGreaterThan(collisions.length);
  });

  /**
   * The sweep sees a bare id in prose as readily as one in a comparison —
   * both shapes, because the failure the boundary actually grows through is a
   * string sitting in a table, not always an `if`.
   */
  it('catches a bare id and a compared id alike', () => {
    expect(namedIn("// the Dragonborn's 'dragonborn' trait")).toEqual(['species dragonborn']);
    expect(namedIn('const rows = { "acolyte": 3 };')).toEqual(['background acolyte']);
    expect(namedIn("grants('wizard:scholar')")).toEqual(['feature wizard:scholar']);
    expect(comparedIn("if (sheet.speciesId !== 'elf') return;")).toEqual([
      "speciesId !== 'elf'",
    ]);
    expect(comparedIn("if (grant.featureId === 'wizard:scholar') return;")).toEqual([
      "featureId === 'wizard:scholar'",
    ]);
    // Two ids compared with each other is ordinary lookup and is not this.
    expect(comparedIn('if (grant.featureId === feature.id) return;')).toEqual([]);
    // And an id that merely ends in a catalogue id is a different id.
    expect(namedIn("const x = 'criminal:alert';")).toEqual(['feature criminal:alert']);
  });
});
