import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseMonsters } from '@ie/srd';
import {
  asCharacterId,
  contextRequestsOf,
  isNeedsContext,
  expect as unwrap,
  type CharacterId,
} from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent } from './events.js';
import { adaptMonster } from './monster.js';
import { remaining } from './resources.js';
import { resolveAttack, resolveAttackDamage, resolveSpell } from './commands.js';
// Past the barrel on purpose, for one fixture: see "the backstop, driven
// rather than trusted" below. `resolveEffects` is a half rather than a
// command, and reaching it through a command is what makes its own guard
// unreachable.
import { resolveEffects } from './commands/spell-resolution.js';
import { declaredCasting } from './spellcasting.js';
import { createCharacter, type CharacterChoices } from './creation.js';
import { BLIGHT, isCreatureType, SPELL_DEFINITIONS } from './spell-definitions.js';

/**
 * An outcome that varies by the target's creature type.
 *
 * SRD 5.2.1, "Rules Glossary" → *Creature Type*: "Every creature, including
 * every player character, has a tag in the rules that identifies the type of
 * creature it is. ... The types don't have rules themselves, but **some rules
 * in the game affect creatures of certain types in different ways.**"
 *
 * Three such rules are printed about a *target*, and this suite drives all
 * three:
 *
 * | Spell | SRD | Shape |
 * |---|---|---|
 * | Blight | "A Plant creature automatically fails the save." | an automatic failure |
 * | Shatter | "A Construct has Disadvantage on the save." | a mode on the save |
 * | Divine Smite | "The damage increases by 1d8 if the target is a Fiend or an Undead." | extra damage dice |
 *
 * The fact was authoritative before any of them could read it —
 * `declareCreatureType` establishes it, a stat block prints it, a species
 * gives it — and reached targeting alone. This is the second reader.
 *
 * **The unknown case is a request, not a pass.** A creature nobody has typed
 * produces the `creature-type` `ContextRequest` that targeting has always
 * produced, and spends nothing: no slot, no action, no die. Taking the default
 * branch silently is the failure the whole three-valued discipline exists to
 * prevent.
 */

const id = (s: string) => asCharacterId(s);
const WIZARD = id('wizard');
const SHAMBLER = id('shambler');
const GOLEM = id('golem');
const THUG = id('thug');
const GOBLIN = id('goblin-warrior');
const STRANGER = id('stranger');

const bestiary = parseMonsters(
  readFileSync(fileURLToPath(new URL('../../srd/raw/monsters-A-Z.md', import.meta.url)), 'utf8'),
  'monsters-A-Z.md',
).items;

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 9,
  abilities: { str: 10, dex: 10, con: 10, int: 20, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'int',
  ...over,
});

/**
 * A target, typed or deliberately untyped.
 *
 * `creatureType` is omitted rather than nulled for {@link STRANGER}, because
 * "nobody has said" is the state under test and an omitted field is how a
 * caller who has not said it writes the event.
 */
const added = (who: CharacterId, creatureType?: string): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet({ abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 } }),
  maxHp: 400,
  diesAtZero: false,
  ...(creatureType === undefined ? {} : { creatureType }),
});

const SLOTS: readonly GameEvent[] = [1, 2, 3, 4, 5].map(
  (level): GameEvent => ({
    type: 'resource-pool-declared',
    id: WIZARD,
    pool: { key: `spell-slot:${level}`, label: `level ${level}`, max: 4, recovers: 'long-rest' },
  }),
);

const CASTER: readonly GameEvent[] = [
  {
    type: 'creature-added',
    id: WIZARD,
    name: WIZARD,
    sheet: sheet(),
    maxHp: 400,
    diesAtZero: false,
    creatureType: 'Humanoid',
  },
  {
    type: 'spellcasting-declared',
    id: WIZARD,
    spellcasting: declaredCasting({
      ability: 'int',
      classId: 'wizard',
      cantrips: SPELL_DEFINITIONS.filter((d) => d.level === 0).map((d) => d.id),
      prepared: SPELL_DEFINITIONS.filter((d) => d.level > 0).map((d) => d.id),
    }),
  },
  ...SLOTS,
];

/**
 * The caster and one target, twenty feet apart and in plain sight.
 *
 * One target, because the arithmetic comparisons need *the same dice* in both
 * runs and an area spell rolls per target — the lesson `evasion.test.ts`
 * already learned about any fixture with two subjects in it.
 */
const table = (who: CharacterId, creature: GameEvent): readonly GameEvent[] => [
  ...CASTER,
  creature,
  { type: 'scene-set', extent: { width: 400, depth: 400, height: 40 } },
  { type: 'landmark-added', name: 'the hall', at: { x: 100, y: 100, z: 0 } },
  { type: 'creature-placed', id: WIZARD, placement: { from: { landmark: 'the hall' }, feet: 0 } },
  {
    type: 'creature-placed',
    id: who,
    placement: { from: { creature: WIZARD }, feet: 20, bearing: 0 },
  },
  { type: 'sight-declared', from: WIZARD, to: who, seen: true },
];

const supply = (seed = 'blight', bonus?: number) => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  ...(bonus === undefined ? {} : { bonuses: [{ source: 'forced', flat: bonus }] }),
});

const cast = (
  log: readonly GameEvent[],
  spellId: string,
  targets: readonly CharacterId[],
  slotLevel: number,
  seed = 'blight',
  bonus?: number,
) =>
  resolveSpell(
    fold('seed', log),
    WIZARD,
    { spellId, targets: [...targets], slotLevel },
    supply(seed, bonus),
  );

const outcome = (out: ReturnType<typeof cast>, who: CharacterId) =>
  unwrap(out, 'cast').outcomes.find((o) => o.target === who)!;

// — an automatic failure ———————————————————————————————————————————————————

/**
 * SRD Blight: "A creature that you can see within range makes a Constitution
 * saving throw, taking 8d8 Necrotic damage on a failed save or half as much
 * damage on a successful one. **A Plant creature automatically fails the
 * save.**"
 *
 * The failure is automatic in the sense the engine already means by the word:
 * `autoFailed` overrides the total, exactly as a Stunned creature's Strength
 * save is overridden, and no bonus applied afterwards rescues it. The die is
 * still thrown and recorded, because other effects can care what it showed —
 * the reading `checks.ts` has taken since conditions closed the loop.
 */
describe('a Plant automatically fails Blight’s save', () => {
  it('fails whatever the die and whatever is added to it', () => {
    // +40 would beat any save DC the engine can produce. The Plant fails anyway.
    const out = outcome(cast(table(SHAMBLER, added(SHAMBLER, 'Plant')), 'blight', [SHAMBLER], 4, 'blight', 40), SHAMBLER);
    expect(out.save!.success).toBe(false);
    expect(out.save!.autoFailed).not.toBeNull();
    expect(out.save!.total).toBeGreaterThan(out.save!.dc);
    expect(out.affected).toBe(true);
  });

  /**
   * **Full, and the only thing that can say so is the same dice halved.**
   *
   * A lower bound cannot: halved 8d8 clears any floor 8d8 clears, so an
   * assertion of that shape survives the mutation it is written against. The
   * two castings differ in exactly one field — the target's type — so the
   * save and the 8d8 come off the same seed in the same order, and the
   * non-Plant's made save is the *same* damage with SRD's "half as much"
   * applied to it.
   */
  it('takes the full damage a failure deals, not the half a success buys', () => {
    const plant = outcome(
      cast(table(SHAMBLER, added(SHAMBLER, 'Plant')), 'blight', [SHAMBLER], 4, 'blight', 40),
      SHAMBLER,
    );
    const saved = outcome(
      cast(table(SHAMBLER, added(SHAMBLER, 'Humanoid')), 'blight', [SHAMBLER], 4, 'blight', 40),
      SHAMBLER,
    );
    expect(saved.save!.success).toBe(true);
    expect(saved.damage).toBe(Math.floor(plant.damage! / 2));
    // And the halving is visible rather than a rounding coincidence.
    expect(plant.damage).toBeGreaterThan(saved.damage!);
  });

  /**
   * The control, and the half this rule must not reach: the same spell, the
   * same forced save, a creature of another type — which still gets to make
   * its save and still takes half when it makes it.
   */
  it('leaves a creature of another type to roll its own save', () => {
    const out = outcome(cast(table(THUG, added(THUG, 'Humanoid')), 'blight', [THUG], 4, 'blight', 40), THUG);
    expect(out.save!.success).toBe(true);
    expect(out.save!.autoFailed).toBeNull();
    expect(out.affected).toBe(false);
  });
});

// — a mode on the save —————————————————————————————————————————————————————

/**
 * SRD Shatter: "Each creature in a 10-foot-radius Sphere centered there makes
 * a Constitution saving throw, taking 3d8 Thunder damage on a failed save or
 * half as much damage on a successful one. **A Construct has Disadvantage on
 * the save.**"
 *
 * Disadvantage is presence, not arithmetic, so it goes in as a `ModeSource`
 * and is combined by the one function that decides a mode — which means a
 * Construct that is also being helped somehow gets a *normal* roll, rather
 * than the engine quietly taking the difference.
 */
describe('a Construct has Disadvantage on Shatter’s save', () => {
  /** A 10-foot Sphere dropped on the target, so the area finds them. */
  const shatter = (who: CharacterId, type: string) =>
    unwrap(
      resolveSpell(
        fold('seed', table(who, added(who, type))),
        WIZARD,
        { spellId: 'shatter', targets: [], at: { x: 100, y: 120, z: 0 }, slotLevel: 2 },
        supply('boom'),
      ),
      'shatter',
    ).outcomes.find((o) => o.target === who)!;

  it('rolls two dice and keeps the lower', () => {
    const out = shatter(GOLEM, 'Construct');
    expect(out.save!.mode).toBe('disadvantage');
    expect(out.save!.rolls.length).toBe(2);
    expect(out.save!.natural).toBe(Math.min(...out.save!.rolls));
    expect(out.save!.modeSources.some((m) => m.source.includes('Shatter'))).toBe(true);
  });

  it('rolls one die for anything that is not a Construct', () => {
    const out = shatter(THUG, 'Humanoid');
    expect(out.save!.mode).toBe('normal');
    expect(out.save!.rolls.length).toBe(1);
    expect(out.save!.modeSources.some((m) => m.source.includes('Shatter'))).toBe(false);
  });
});

// — the unknown case ———————————————————————————————————————————————————————

/**
 * A creature nobody has typed.
 *
 * The engine asks and spends nothing. Silently taking the default branch is
 * the easiest thing in this whole rule to get wrong, and it is wrong in the
 * way that never shows up: a Plant nobody typed would have rolled its save,
 * and a Construct nobody typed would have rolled one die.
 */
describe('an undeclared creature type is a request, not a pass', () => {
  const log = table(STRANGER, added(STRANGER));

  it('asks for the type rather than assuming one', () => {
    const out = cast(log, 'blight', [STRANGER], 4);
    expect(isNeedsContext(out)).toBe(true);
    const asked = contextRequestsOf(out).filter((r) => r.kind === 'creature-type');
    expect(asked.length).toBe(1);
    expect(asked[0]!.subject).toBe(STRANGER);
    expect(asked[0]!.because).toContain('Blight');
  });

  it('spends no slot, no action and no die', () => {
    const before = fold('seed', log);
    const out = cast(log, 'blight', [STRANGER], 4);
    expect(out.ok).toBe(false);

    // The whole of what a refusal must leave alone: the pool, the generator,
    // and the roll ids the next casting is going to want.
    const issuer = createRollIssuer('r');
    const rng = createRng('blight') as Rng;
    const again = resolveSpell(before, WIZARD, { spellId: 'blight', targets: [STRANGER], slotLevel: 4 }, { issuer, rng });
    expect(again.ok).toBe(false);
    expect(issuer.count).toBe(0);
    expect(remaining(before.creatures[WIZARD]!.resources, 'spell-slot:4')).toBe(4);
    expect(before.combat).toBeNull();
  });

  /**
   * **A declaration must ask too, and it is the only thing that can.**
   *
   * `resolveSpell` with `hold` spends the action and drops whatever
   * Concentration the caster held, writes `spell-declared`, and stops — the
   * effects do not run until the casting settles. SRD Counterspell says the
   * action "is wasted" whatever follows, so an action spent on a casting that
   * cannot settle is spent for nothing, and the caster would only find out at
   * settlement. Asking before the declaration is what makes it free.
   */
  it('asks before a declaration, where nothing later could', () => {
    const out = resolveSpell(
      fold('seed', log),
      WIZARD,
      { spellId: 'blight', targets: [STRANGER], slotLevel: 4, hold: true },
      supply(),
    );
    expect(isNeedsContext(out)).toBe(true);
    expect(contextRequestsOf(out).map((r) => r.kind)).toEqual(['creature-type']);
    expect(fold('seed', log).pendingCasting).toBeNull();
  });

  /**
   * And it joins the list the other thin facts use, rather than being a
   * refusal of its own. A caller repairing a record should be told everything
   * that is missing at once — two round trips for two facts about one creature
   * is the shape `namedTargets` already refuses to take.
   */
  it('asks for everything thin about the target in one answer', () => {
    const unplaced: readonly GameEvent[] = [
      ...CASTER,
      added(STRANGER),
      { type: 'scene-set', extent: { width: 400, depth: 400, height: 40 } },
      { type: 'landmark-added', name: 'the hall', at: { x: 100, y: 100, z: 0 } },
      {
        type: 'creature-placed',
        id: WIZARD,
        placement: { from: { landmark: 'the hall' }, feet: 0 },
      },
    ];
    const out = cast(unplaced, 'blight', [STRANGER], 4);
    // Blight reaches 30 feet at "a creature that you can see", so the record
    // is thin three ways over and one answer names all three.
    expect(contextRequestsOf(out).map((r) => r.kind).sort()).toEqual([
      'creature-type',
      'position',
      'visibility',
    ]);
  });

  /** And once the fact is declared, the very same casting resolves. */
  it('resolves the same casting once the fact is established', () => {
    const typed: readonly GameEvent[] = [
      ...log,
      { type: 'creature-type-declared', id: STRANGER, creatureType: 'Plant' },
    ];
    const out = outcome(cast(typed, 'blight', [STRANGER], 4, 'blight', 40), STRANGER);
    expect(out.save!.autoFailed).not.toBeNull();
  });

  /**
   * **The backstop, driven rather than trusted.**
   *
   * `castOrRelease` asks first, so no casting the catalogue can express
   * reaches the guard inside `resolveEffects` — the three other ways in are an
   * area trigger settling later, a declared casting settling, and an
   * activation, and no registered definition pairs `againstType` with any of
   * them. A guard nothing can reach is not a rule, and deleting this one
   * passed the whole suite.
   *
   * It is `restoreOn`'s case rather than `placeArea`'s dead `no_scene`:
   * `resolveEffects` takes its definition, its effects and its targets as
   * arguments, so the case can simply be **built**. That is why this one
   * fixture reaches past the `commands.ts` barrel to the module — the thing
   * under test is the backstop itself, and the public path is the very thing
   * that stops it being reached.
   */
  it('asks again at the effects, for the paths that do not come through a cast', () => {
    const state = fold('seed', log);
    const caster = state.creatures[WIZARD]!;
    const out = resolveEffects(state, WIZARD, caster, BLIGHT, {
      castLevel: 4,
      route: null,
      numbers: { attackModifier: 7, saveDc: 16, spellcastingModifier: 5, casterLevel: 9 },
      targets: [STRANGER],
      unverified: [],
      supply: supply(),
      castingId: 'cast:1',
      events: [],
    });
    expect(isNeedsContext(out)).toBe(true);
    expect(contextRequestsOf(out).map((r) => r.kind)).toEqual(['creature-type']);
    // And not one die was thrown for the target it could not answer about.
    const issuer = createRollIssuer('r');
    resolveEffects(state, WIZARD, caster, BLIGHT, {
      castLevel: 4,
      route: null,
      numbers: { attackModifier: 7, saveDc: 16, spellcastingModifier: 5, casterLevel: 9 },
      targets: [STRANGER],
      unverified: [],
      supply: { issuer, rng: createRng('blight') as Rng },
      castingId: 'cast:1',
      events: [],
    });
    expect(issuer.count).toBe(0);
  });
});

// — the type, not the printed string ———————————————————————————————————————

/**
 * SRD prints a stat block's type and an optional subtype tag beside it, and
 * the tag is not a type: a Goblin Warrior is "Small Fey (Goblinoid)".
 * `CLAUDE.md` records that the *type* changed in 2024 and that every 2014
 * instinct about who is a Humanoid is worth re-reading.
 */
describe('a subtype tag is not a type', () => {
  const goblin = () => {
    const found = bestiary.find((m) => m.id === 'goblin-warrior');
    if (found === undefined) throw new Error('no Goblin Warrior in the parsed bestiary');
    return adaptMonster(found, GOBLIN);
  };

  it('reads a Goblin Warrior as Fey, which is what the book prints', () => {
    expect(goblin().creatureType).toBe('Fey');
  });

  it('matches a type exactly, and never a substring of one either way', () => {
    expect(isCreatureType('Fey', 'Fey')).toBe(true);
    expect(isCreatureType('fey', 'Fey')).toBe(true);
    expect(isCreatureType('Fey', 'Humanoid')).toBe(false);
    // The tag itself is not a type, so nothing may be written that names it.
    expect(isCreatureType('Fey', 'Goblinoid')).toBe(false);
    // And neither direction of containment is a match.
    expect(isCreatureType('Humanoid', 'Human')).toBe(false);
    expect(isCreatureType('Human', 'Humanoid')).toBe(false);
    expect(isCreatureType(null, 'Humanoid')).toBe(false);
  });

  /**
   * The rule this reaches through a spell rather than through the matcher
   * alone: Blight singles out a Plant, and a Fey is not one however it is
   * tagged.
   */
  it('leaves a Goblin Warrior to roll Blight’s save', () => {
    const adapted = goblin();
    const log = table(GOBLIN, {
      type: 'creature-added',
      id: GOBLIN,
      name: adapted.name,
      sheet: adapted.sheet,
      maxHp: 400,
      diesAtZero: false,
      creatureType: adapted.creatureType,
    });
    const out = outcome(cast(log, 'blight', [GOBLIN], 4, 'blight', 40), GOBLIN);
    expect(out.save!.autoFailed).toBeNull();
    expect(out.save!.success).toBe(true);
  });
});

// — extra damage dice ——————————————————————————————————————————————————————

/**
 * SRD Divine Smite: "The target takes an extra 2d8 Radiant damage from the
 * attack. **The damage increases by 1d8 if the target is a Fiend or an
 * Undead.**"
 *
 * It is a level 1 Evocation **spell** in SRD 5.2.1 — the brief called it a
 * class feature — so it reaches this vocabulary through the definition it
 * already has, and the extra die is a clause on its `attack-damage` effect.
 */
describe('Divine Smite deals an extra die against a Fiend or an Undead', () => {
  const PALADIN = id('aelric');

  const paladin = (): CharacterChoices => ({
    name: 'Aelric',
    classId: 'paladin',
    level: 5,
    speciesId: 'human',
    backgroundId: 'sage',
    abilities: {
      method: 'standard-array',
      assignment: { str: 15, dex: 10, con: 13, int: 8, wis: 12, cha: 14 },
    },
    abilityIncreases: { con: 2, wis: 1 },
    classSkills: ['athletics', 'persuasion'],
    languages: ['Dwarvish', 'Orc'],
    alignment: 'Lawful Good',
    subclassId: 'oath-of-devotion',
    cantrips: [],
    spellbook: [],
    preparedSpells: ['divine-smite', 'bless', 'cure-wounds', 'heroism', 'shield-of-faith', 'aid'],
    classEquipment: 'A',
    backgroundEquipment: 'A',
    equipped: [],
    hitPoints: { method: 'fixed' },
    featureChoices: { 'human:skillful': ['perception'] },
    feats: {
      'sage:magic-initiate-wizard': {
        featId: 'magic-initiate',
        spellList: 'wizard',
        spellcastingAbility: 'int',
        cantrips: ['mage-hand', 'light'],
        levelOneSpell: 'find-familiar',
      },
      'human:versatile': { featId: 'alert' },
      'paladin:fighting-style': { featId: 'defense' },
      'paladin:ability-score-improvement': { featId: 'savage-attacker' },
    },
    dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
  });

  /**
   * `warded` turns aside **both** the sword's Slashing and the smite's
   * Radiant, so a correct smite lands nothing at all on it.
   *
   * That is the only assertion here that can tell what *type* the extra die
   * is. An upper bound on the damage cannot: a mutation that dealt the extra
   * die as Necrotic instead left the total inside the greatsword's own range
   * under the seed, and passed. A target with nothing left to resist is what
   * makes the answer exact rather than likely.
   */
  const victim = (who: CharacterId, creatureType?: string, warded = false): GameEvent => ({
    type: 'creature-added',
    id: who,
    name: who,
    sheet: {
      ...sheet({ abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 } }),
      stated: { armorClass: 1 },
    },
    maxHp: 400,
    diesAtZero: false,
    ...(creatureType === undefined ? {} : { creatureType }),
    ...(warded
      ? { defenses: { radiant: { immune: true }, slashing: { immune: true } } }
      : {}),
  });

  const field = (who: CharacterId, creature: GameEvent): readonly GameEvent[] => [
    ...(unwrap(createCharacter(paladin(), PALADIN), 'create') as GameEvent[]),
    creature,
    { type: 'items-gained', id: PALADIN, items: [{ id: 'greatsword', quantity: 1 }], source: 'loot' },
    { type: 'scene-set', extent: { width: 200, depth: 200, height: 40 } },
    { type: 'landmark-added', name: 'the gate', at: { x: 50, y: 50, z: 0 } },
    { type: 'creature-placed', id: PALADIN, placement: { from: { landmark: 'the gate' }, feet: 0 } },
    {
      type: 'creature-placed',
      id: who,
      placement: { from: { creature: PALADIN }, feet: 5, bearing: 0 },
    },
  ];

  /** Swing with the damage held, then settle it with the smite. */
  const smite = (log: readonly GameEvent[], who: CharacterId, seed = 'hit') => {
    const swung = unwrap(
      resolveAttack(
        fold('seed', log),
        PALADIN,
        { target: who, weapon: 'greatsword', twoHanded: true, hold: true },
        { issuer: createRollIssuer('a'), rng: createRng(seed) as Rng },
      ),
      'attack',
    );
    const held: readonly GameEvent[] = [...log, ...swung.events];
    const issuer = createRollIssuer('d');
    const settled = resolveAttackDamage(
      fold('seed', held),
      PALADIN,
      { smite: { spellId: 'divine-smite', slotLevel: 1 } },
      { issuer, rng: createRng(seed) as Rng },
    );
    return { swung, held, settled, issuer, before: fold('seed', held) };
  };

  it('rolls one more die against an Undead than against a Humanoid', () => {
    const undead = smite(field(id('wight'), victim(id('wight'), 'Undead')), id('wight'));
    const living = smite(field(THUG, victim(THUG, 'Humanoid')), THUG);
    unwrap(undead.settled, 'undead');
    unwrap(living.settled, 'living');
    // 2d8 against the Humanoid and 3d8 against the Undead: one extra roll id,
    // issued for the extra component the clause adds.
    expect(undead.issuer.count).toBe(living.issuer.count + 1);
  });

  it('deals the extra die as Radiant, which a Radiant-immune target ignores', () => {
    const ward = smite(field(id('wight'), victim(id('wight'), 'Undead', true)), id('wight'));
    // Immune to the sword's Slashing and to the smite's Radiant alike, so a
    // correctly typed blow leaves nothing at all — the base 2d8 and the extra
    // 1d8 are one pool of one type, and both are turned aside.
    expect(unwrap(ward.settled, 'warded').damage ?? 0).toBe(0);
    // And the extra die really was thrown: it costing nothing is the target's
    // defences answering, not the clause failing to fire.
    const living = smite(field(THUG, victim(THUG, 'Humanoid', true)), THUG);
    unwrap(living.settled, 'living');
    expect(ward.issuer.count).toBe(living.issuer.count + 1);
  });

  /**
   * "A Fiend **or** an Undead" is one clause naming two types, so both answers
   * have to be the second one rather than the first — and the same seed against
   * the same sheet makes "the same" an exact comparison rather than a range.
   */
  it('reaches a Fiend by the same clause', () => {
    const fiend = smite(field(id('imp'), victim(id('imp'), 'Fiend')), id('imp'));
    const undead = smite(field(id('wight'), victim(id('wight'), 'Undead')), id('wight'));
    const living = smite(field(THUG, victim(THUG, 'Humanoid')), THUG);
    unwrap(living.settled, 'living');
    expect(unwrap(fiend.settled, 'fiend').damage).toBe(unwrap(undead.settled, 'undead').damage);
    expect(fiend.issuer.count).toBe(living.issuer.count + 1);
  });

  it('asks for an undeclared type rather than smiting a default', () => {
    const out = smite(field(STRANGER, victim(STRANGER)), STRANGER);
    expect(isNeedsContext(out.settled)).toBe(true);
    const asked = contextRequestsOf(out.settled).filter((r) => r.kind === 'creature-type');
    expect(asked.length).toBe(1);
    expect(asked[0]!.subject).toBe(STRANGER);
  });

  /**
   * A held attack is a debt, and a refusal must leave it standing rather than
   * half-settling it: the slot is unspent, no die was thrown, and the hit is
   * still there to be settled once the type is declared.
   */
  it('spends no slot and throws no die on the casting it did not make', () => {
    const out = smite(field(STRANGER, victim(STRANGER)), STRANGER);
    expect(out.settled.ok).toBe(false);
    expect(out.issuer.count).toBe(0);

    const slots = remaining(out.before.creatures[PALADIN]!.resources, 'spell-slot:1');
    const after = fold('seed', out.held);
    expect(remaining(after.creatures[PALADIN]!.resources, 'spell-slot:1')).toBe(slots);
    expect(slots).toBeGreaterThan(0);
    expect(after.pendingAttack).not.toBeNull();
  });
});
