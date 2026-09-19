import { readFileSync } from 'node:fs';
import { SPELL_DEFINITIONS, SRD_CONTENT } from '@ie/content';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { asCharacterId, isErr, expect as unwrap, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { spellSlotKey } from './resources.js';
import { declaredCasting } from './spellcasting.js';
import { statesFoughtFact } from './spell-definitions.js';
import { pendingCastingsOf, resolveDeclaredCast, resolveSpell } from './commands.js';

/**
 * "It does so with Advantage if you or your allies are fighting it."
 *
 * Five SRD spells key a saving throw's Advantage on a fact the engine does not
 * hold and cannot derive. **It is not `side`.** Allegiance answers a different
 * question — a bandit may be an enemy and not yet be fought, a charmed ally may
 * be fought and still be on the party's side — and `side` may simply be
 * undeclared, which is the three-valued discipline declared cover and declared
 * sight already follow. So the caster states it, once, at the casting, exactly
 * as they state the damage type Spirit Guardians prints two of.
 *
 * **It is not a `RollModifier` either.** `roll-modifiers.ts` selects a roll by
 * family, relation, ability and skill, and none of those can say "the saving
 * throw *this casting* is calling for".
 *
 * **And it is a mode, not a number.** It goes in as a named `ModeSource` and
 * `combineRollModes` decides, so a fought target who is also Restrained rolls a
 * normal save rather than a net-positive one — the rule CLAUDE.md states as
 * "Advantage is presence, not arithmetic".
 *
 * **It is a list, because the SRD asks it of the target**: "…fighting **it**",
 * and both Charms upcast to several targets. The fixture that says so is the
 * level 2 Charm Person at two creatures with one of them named — every other
 * case here has a single target, under which a per-target list and a
 * per-casting boolean are indistinguishable.
 *
 * The fixture never declares a side that agrees with the stated fact, and it
 * casts the *same* spell at the *same* creature twice with the fact told both
 * ways. A test that declared sides and then asserted the save would prove
 * nothing about which of the two facts was read.
 */

const id = (s: string) => asCharacterId(s);
const WIZARD = id('wizard');
/** On the party's side, and fought anyway: `side` cannot be what is read. */
const TURNCOAT = id('turncoat');
/** An enemy nobody is fighting yet, for the other half of the same point. */
const BANDIT = id('bandit');

const PREPARED = ['charm-person', 'dominate-person', 'hold-person', 'spirit-guardians'];

const sheet = (): CharacterSheet => ({
  level: 9,
  abilities: { str: 10, dex: 10, con: 10, int: 18, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'int',
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
  added(WIZARD, 'party'),
  added(TURNCOAT, 'party'),
  added(BANDIT, 'foes'),
  {
    type: 'spellcasting-declared',
    id: WIZARD,
    spellcasting: declaredCasting({ ability: 'int', prepared: PREPARED }),
  },
  ...[1, 2, 3, 4, 5].map(
    (level): GameEvent => ({
      type: 'resource-pool-declared',
      id: WIZARD,
      pool: { key: spellSlotKey(level), label: `level ${level}`, max: 6, recovers: 'long-rest' },
    }),
  ),
  { type: 'scene-set', extent: { width: 300, depth: 300, height: 40 } },
  { type: 'landmark-added', name: 'here', at: { x: 100, y: 100, z: 0 } },
  { type: 'creature-placed', id: WIZARD, placement: { from: { landmark: 'here' }, feet: 0 } },
  { type: 'creature-placed', id: TURNCOAT, placement: { from: { creature: WIZARD }, feet: 10, bearing: 0 } },
  { type: 'creature-placed', id: BANDIT, placement: { from: { creature: WIZARD }, feet: 15, bearing: 90 } },
  { type: 'sight-declared', from: WIZARD, to: TURNCOAT, seen: true },
  { type: 'sight-declared', from: WIZARD, to: BANDIT, seen: true },
  {
    type: 'combat-started',
    combatants: [
      { id: WIZARD, initiative: 30, speed: 30 },
      { id: TURNCOAT, initiative: 20, speed: 30 },
      { id: BANDIT, initiative: 10, speed: 30 },
    ],
  },
];

const world = (extra: readonly GameEvent[] = []): GameState => fold('seed', [...SETUP, ...extra]);
const supply = (seed = 'fought') => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

const refusal = (out: { readonly ok: boolean }): string =>
  isErr(out as never) ? (out as unknown as { code: string }).code : 'not refused';

/**
 * Each spell's own printed prose, out of the parsed book.
 *
 * The same reader `area-triggers.test.ts` uses, for the same reason: a comment
 * saying a clause is in the SRD is only as honest as whoever wrote it.
 */
const PROSE: ReadonlyMap<string, string> = new Map(
  (
    JSON.parse(
      readFileSync(
        fileURLToPath(new URL('../../srd/src/generated/spells.json', import.meta.url)),
        'utf8',
      ),
    ) as readonly { id: string; description: string }[]
  ).map((spell) => [spell.id, spell.description]),
);

describe('a casting states whether the target is being fought', () => {
  /**
   * SRD Charm Person prints the clause, so the casting must answer it.
   *
   * Named among the fought, the save carries a named source and the mode is
   * Advantage; left out of the list, the spell contributes nothing at all. Both
   * are the same casting at the same creature with the same seed, which is what
   * makes the difference attributable to the stated fact and to nothing else.
   */
  it('rolls the save with Advantage when the caster says the target is fought', () => {
    const out = unwrap(
      resolveSpell(
        world(),
        WIZARD,
        { spellId: 'charm-person', targets: [TURNCOAT], slotLevel: 1, fought: [TURNCOAT] },
        supply(),
      ),
      'charm person',
    );
    const save = out.outcomes[0]!.save!;
    expect(save.modeSources.some((m) => m.source.includes('Charm Person'))).toBe(true);
    expect(save.mode).toBe('advantage');
  });

  it('rolls an ordinary save when the caster says it is not', () => {
    const out = unwrap(
      resolveSpell(
        world(),
        WIZARD,
        { spellId: 'charm-person', targets: [TURNCOAT], slotLevel: 1, fought: [] },
        supply(),
      ),
      'charm person',
    );
    const save = out.outcomes[0]!.save!;
    expect(save.modeSources.some((m) => m.source.includes('Charm Person'))).toBe(false);
    expect(save.mode).toBe('normal');
  });

  /**
   * **No default.** An answer the engine fills in is the engine inventing the
   * fact, and the refusal costs nothing — it lands before the slot, before the
   * action and before the first die, which is the whole of what "refuse, don't
   * guess" buys here.
   *
   * **Two assertions, because two different things are at stake and only one of
   * them is free.** A refusal is an `Err` and carries no events, so the slot
   * and the Action cannot have gone — a state comparison would be comparing two
   * folds of the same list and pinning nothing. What is *not* free is the
   * generator: `resolveSpell` is handed one, and a refusal that had already
   * rolled would be a rejected operation that moved authoritative state, which
   * is the rule this engine calls "validate before rolling". So the fixture
   * holds **one** `Rng` and compares its snapshot across the call; a fresh one
   * per call, which is what `supply()` builds, could never have said so.
   */
  it('refuses the casting when the spell prints the clause and nothing was stated', () => {
    const rng = createRng('unspent') as Rng;
    const before = rng.snapshot();
    const out = resolveSpell(
      world(),
      WIZARD,
      { spellId: 'charm-person', targets: [TURNCOAT], slotLevel: 1 },
      { issuer: createRollIssuer('r'), rng, content: SRD_CONTENT },
    );
    expect(refusal(out)).toBe('fought_fact_required');

    // No events at all, so nothing was spent; and the generator has not moved.
    expect(isErr(out)).toBe(true);
    expect(rng.snapshot()).toEqual(before);
  });

  /** A spell that prints no such clause is refused for being told one. */
  it('refuses a stated fact from a spell that does not print the clause', () => {
    const out = resolveSpell(
      world(),
      WIZARD,
      { spellId: 'hold-person', targets: [TURNCOAT], slotLevel: 2, fought: [TURNCOAT] },
      supply(),
    );
    expect(refusal(out)).toBe('no_fought_clause');
  });

  /**
   * And an **empty** list is refused as loudly as a full one, because a spell
   * that prints no clause asks no question — answering "none of them" to it is
   * still a caller who has misread the spell.
   */
  it('refuses a spell without the clause being told nobody is fought', () => {
    const out = resolveSpell(
      world(),
      WIZARD,
      { spellId: 'hold-person', targets: [TURNCOAT], slotLevel: 2, fought: [] },
      supply(),
    );
    expect(refusal(out)).toBe('no_fought_clause');
  });

  /**
   * **Allegiance is not the fact.** The turncoat is on the caster's own side
   * and is fought; the bandit is an enemy and is not. Both castings state the
   * fact explicitly and the engine reads what it was told, so a substitution of
   * `side` would get both of them backwards.
   */
  it('reads the stated fact rather than the declared side', () => {
    const ally = unwrap(
      resolveSpell(
        world(),
        WIZARD,
        { spellId: 'charm-person', targets: [TURNCOAT], slotLevel: 1, fought: [TURNCOAT] },
        supply('a'),
      ),
      'fought ally',
    );
    const enemy = unwrap(
      resolveSpell(
        world(),
        WIZARD,
        { spellId: 'charm-person', targets: [BANDIT], slotLevel: 1, fought: [] },
        supply('b'),
      ),
      'unfought enemy',
    );
    expect(ally.outcomes[0]!.save!.mode).toBe('advantage');
    expect(enemy.outcomes[0]!.save!.mode).toBe('normal');
  });

  /**
   * **The SRD asks it of the target, and one casting can have several.**
   *
   * "It does so with Advantage if you or your allies are fighting **it**" —
   * and Charm Person carries `extraPerSlotLevelAbove: 1`, so a level 2 casting
   * names two creatures and may have two different answers. This is the
   * fixture that tells a per-target list from a per-casting boolean: every
   * other case in this file names one target, under which the two are
   * indistinguishable — the same weakness as the multiclass fixture and the
   * Rogue who resisted nothing.
   *
   * Both saves come out of **one** casting, so nothing about the seed, the DC
   * or the caster differs between them; the only difference is which creature
   * the caster said they were fighting.
   */
  it('answers per target, so an upcast casting can differ within itself', () => {
    const out = unwrap(
      resolveSpell(
        world(),
        WIZARD,
        {
          spellId: 'charm-person',
          targets: [TURNCOAT, BANDIT],
          slotLevel: 2,
          fought: [TURNCOAT],
        },
        supply('upcast'),
      ),
      'upcast charm person',
    );
    const of = (who: CharacterId) => out.outcomes.find((o) => o.target === who)!.save!;
    expect(of(TURNCOAT).mode).toBe('advantage');
    expect(of(TURNCOAT).modeSources.some((m) => m.source.includes('Charm Person'))).toBe(true);
    expect(of(BANDIT).mode).toBe('normal');
    expect(of(BANDIT).modeSources.some((m) => m.source.includes('Charm Person'))).toBe(false);
  });

  /**
   * **An empty list is an answer; absence is not.** This is the one place the
   * fact parts company with the designation it otherwise copies — an empty
   * `unaffected` is elided because it means what a spell with no such clause
   * means, and an empty `fought` is the caster answering "none of them" to a
   * question the spell insisted on. Elide it and a settled casting becomes one
   * that could never have been declared.
   */
  it('keeps an empty answer on the record rather than eliding it', () => {
    const declared = unwrap(
      resolveSpell(
        world(),
        WIZARD,
        { spellId: 'charm-person', targets: [TURNCOAT], slotLevel: 1, fought: [], hold: true },
        supply(),
      ),
      'declared',
    );
    const open = world(declared.events);
    expect(pendingCastingsOf(open)[0]?.fought).toEqual([]);
    expect(pendingCastingsOf(open)[0]).toHaveProperty('fought');
  });

  /** And a creature nobody has heard of is the ordinary stranger refusal. */
  it('refuses a stranger named among the creatures being fought', () => {
    const out = resolveSpell(
      world(),
      WIZARD,
      { spellId: 'charm-person', targets: [TURNCOAT], slotLevel: 1, fought: [id('nobody')] },
      supply(),
    );
    expect(refusal(out)).toBe('unknown_creature');
  });
});

describe('a held casting settles with the fact its caster stated', () => {
  /**
   * SRD Counterspell answers "a creature in the process of casting a spell",
   * and settlement takes no fresh request — so the fact rides on the pending
   * record beside the targets, the origin and the damage type. Dropped there, a
   * Charm Person declared against a creature the party is fighting settles
   * without the Advantage the book gives it, and nothing in the log would say
   * why the save came out normal.
   */
  it('carries the fact onto the pending record and reads it back', () => {
    const declared = unwrap(
      resolveSpell(
        world(),
        WIZARD,
        { spellId: 'charm-person', targets: [TURNCOAT], slotLevel: 1, fought: [TURNCOAT], hold: true },
        supply(),
      ),
      'declared',
    );
    const open = world(declared.events);
    expect(pendingCastingsOf(open)[0]?.fought).toEqual([TURNCOAT]);

    const settled = unwrap(resolveDeclaredCast(open, declared.castingId!, supply('settle')), 'settled');
    expect(settled.outcomes[0]!.save!.mode).toBe('advantage');
    expect(
      settled.outcomes[0]!.save!.modeSources.some((m) => m.source.includes('Charm Person')),
    ).toBe(true);
  });

  /** And a declaration that said no settles with no Advantage of its own. */
  it('settles without Advantage when the declaration said the target is not fought', () => {
    const declared = unwrap(
      resolveSpell(
        world(),
        WIZARD,
        { spellId: 'charm-person', targets: [TURNCOAT], slotLevel: 1, fought: [], hold: true },
        supply(),
      ),
      'declared',
    );
    const open = world(declared.events);
    expect(pendingCastingsOf(open)[0]?.fought).toEqual([]);

    const settled = unwrap(resolveDeclaredCast(open, declared.castingId!, supply('settle')), 'settled');
    expect(settled.outcomes[0]!.save!.mode).toBe('normal');
  });
});

describe('the clause is transcribed, spell by spell', () => {
  /**
   * **A neighbouring spell must not lend this one a clause it does not print.**
   *
   * Held against each definition's own SRD paragraph out of the parsed book,
   * which is the technique `area-triggers.test.ts` already uses for exactly
   * this question — a hand-written list of five ids is only as honest as
   * whoever typed it, and the book can be read.
   *
   * **Advantage and fighting in one sentence**, rather than either word alone.
   * SRD Enthrall is the adversarial case and is why: "Any creature you or your
   * companions are fighting **automatically succeeds** on this save" prints the
   * fact and not the outcome, so a scan for "fighting" would demand the clause
   * of a spell this shape cannot express. Reading the two words together is
   * what tells the five apart from it.
   */
  it.each(SPELL_DEFINITIONS.map((d) => [d.id, d] as const))(
    'gives %s the clause only where its own paragraph prints one',
    (spellId, definition) => {
      const printed = (PROSE.get(spellId) ?? '')
        .split(/(?<=\.)\s+/)
        .some((sentence) => /\bAdvantage\b/i.test(sentence) && /\bfighting\b/i.test(sentence));
      expect(statesFoughtFact(definition)).toBe(printed);
    },
  );

  /** And the sweep is not vacuous: some definitions really do carry it. */
  it('finds the spells the book prints it for', () => {
    expect(
      SPELL_DEFINITIONS.filter(statesFoughtFact)
        .map((d) => d.id)
        .sort(),
    ).toEqual([
      'charm-monster',
      'charm-person',
      'dominate-beast',
      'dominate-monster',
      'dominate-person',
    ]);
  });

  /**
   * And each of the five has stopped saying it is missing.
   *
   * `unmodelled` is a claim about what the engine does not do; leaving the
   * sentence there once the engine does it is the "green tick" failure in
   * reverse, and it reaches every casting as an `unverified` line.
   */
  it('no longer reports the clause as unmodelled', () => {
    for (const spellId of [
      'charm-person',
      'charm-monster',
      'dominate-beast',
      'dominate-person',
      'dominate-monster',
    ]) {
      const clauses = SRD_CONTENT.spell(spellId)!.unmodelled ?? [];
      expect(
        clauses.filter((clause) => clause.includes('fighting')),
        spellId,
      ).toEqual([]);
    }
  });
});
