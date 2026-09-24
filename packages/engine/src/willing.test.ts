import { SRD_CONTENT } from '@ie/content';
import { describe, expect, it } from 'vitest';
import {
  asCharacterId,
  contextRequestsOf,
  isErr,
  isNeedsContext,
  expect as unwrap,
  type CharacterId,
  type Result,
} from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { spellSlotKey } from './resources.js';
import { declaredCasting } from './spellcasting.js';
import { altitudeOf } from './positioning.js';
import { pendingCastingsOf, resolveDeclaredCast, resolveSpell } from './commands.js';
import { SPELL_DEFINITIONS } from '@ie/content';

/**
 * Consent, which the SRD asks for in two different sentences and the engine
 * held no word for at all.
 *
 * `willing` is the ninth fact a casting **states** rather than derives, beside
 * the damage type, the designation, the creatures being fought, a teleport's
 * destination, the caster's choice, a weapon, a stat block and an object. It
 * is a list of ids, because the book asks it of the *creature* and an upcast
 * Water Breathing names ten of them.
 *
 * Two printed clauses read it, and they are not the same rule:
 *
 * - **a save an unwilling creature may make** — SRD Levitate: "An unwilling
 *   creature that succeeds on a Constitution saving throw is unaffected." A
 *   target the caster named as willing skips the roll and is lifted; anybody
 *   else rolls it. The hostile reading is legal, so nothing is asked for here.
 * - **a target rule that requires consent** — SRD Mage Armor: "You touch a
 *   willing creature who isn't wearing armor." A target nobody has said
 *   consented is *asked about* rather than refused and never assumed: the
 *   engine holds no rule that an ally agrees, and a table's assumption is not
 *   a rule in the book.
 */

const id = (s: string) => asCharacterId(s);
const WIZARD = id('wizard');
const ALLY = id('ally');
const GOBLIN = id('goblin');

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 5,
  abilities: { str: 10, dex: 10, con: 10, int: 18, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'int',
  ...over,
});

const added = (who: CharacterId): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(),
  maxHp: 60,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side: who === GOBLIN ? 'foes' : 'party',
});

const SETUP: readonly GameEvent[] = [
  added(WIZARD),
  added(ALLY),
  added(GOBLIN),
  ...[1, 2, 3].map(
    (level): GameEvent => ({
      type: 'resource-pool-declared',
      id: WIZARD,
      pool: { key: spellSlotKey(level), label: `level ${level}`, max: 4, recovers: 'long-rest' },
    }),
  ),
  {
    type: 'spellcasting-declared',
    id: WIZARD,
    spellcasting: declaredCasting({
      ability: 'int',
      cantrips: ['fire-bolt', 'guidance'],
      prepared: ['levitate', 'mage-armor', 'jump'],
    }),
  },
  { type: 'scene-set', extent: { width: 400, depth: 400, height: 60 } },
  { type: 'landmark-added', name: 'the hall', at: { x: 100, y: 100, z: 0 } },
  { type: 'creature-placed', id: WIZARD, placement: { from: { landmark: 'the hall' }, feet: 0 } },
  {
    type: 'creature-placed',
    id: ALLY,
    placement: { from: { creature: WIZARD }, feet: 5, bearing: 90 },
  },
  {
    type: 'creature-placed',
    id: GOBLIN,
    placement: { from: { creature: WIZARD }, feet: 10, bearing: 180 },
  },
  { type: 'sight-declared', from: WIZARD, to: ALLY, seen: true },
  { type: 'sight-declared', from: WIZARD, to: GOBLIN, seen: true },
];

const world = (extra: readonly GameEvent[] = []): GameState => fold('seed', [...SETUP, ...extra]);

/** A supply whose flat bonus settles any saving throw outright. */
const supply = (seed = 'willing', flat?: number) => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  ...(flat === undefined ? {} : { bonuses: [{ source: 'the test insists', flat }] }),
  content: SRD_CONTENT,
});

const refusal = (out: Result<unknown>): string =>
  isErr(out) ? (out as unknown as { code: string }).code : 'not refused';

const height = (state: GameState, who: CharacterId): number | null =>
  altitudeOf(state.scene!, who);

const saves = (out: { readonly events: readonly GameEvent[] }): readonly GameEvent[] =>
  out.events.filter(
    (event) => event.type === 'roll-recorded' && event.label.includes('save vs'),
  );

// — the save an unwilling creature makes ——————————————————————————————————

describe('SRD Levitate asks the save of an unwilling creature and of nobody else', () => {
  /**
   * "An unwilling creature that succeeds on a Constitution saving throw is
   * unaffected." A creature the caster named consents, so there is nothing for
   * it to succeed on: the lift happens and no die is thrown.
   */
  it('lifts an ally stated willing with no saving throw at all', () => {
    const out = unwrap(
      resolveSpell(
        world(),
        WIZARD,
        { spellId: 'levitate', targets: [ALLY], slotLevel: 2, willing: [ALLY] },
        // A bonus that would carry any save, to prove none was rolled rather
        // than that one was rolled and failed.
        supply('willing-ally', 40),
      ),
      'Levitate on a willing ally',
    );

    expect(saves(out)).toHaveLength(0);
    expect(height(world(out.events), ALLY)).toBe(20);
  });

  /** And the caster is willing by being the caster; nobody has to say so. */
  it('lifts the caster with no saving throw, without being told', () => {
    const out = unwrap(
      resolveSpell(
        world(),
        WIZARD,
        { spellId: 'levitate', targets: [WIZARD], slotLevel: 2 },
        supply('willing-self', 40),
      ),
      'Levitate on yourself',
    );

    expect(saves(out)).toHaveLength(0);
    expect(height(world(out.events), WIZARD)).toBe(20);
  });

  /**
   * A creature nobody said consented is unwilling, which is the SRD's own
   * default and the one place this fact is **not** asked for: the hostile
   * reading is legal and the book puts the save on the creature that objects.
   */
  it('rolls the Constitution save for a goblin nobody named, and lifts it only on a failure', () => {
    const made = unwrap(
      resolveSpell(
        world(),
        WIZARD,
        { spellId: 'levitate', targets: [GOBLIN], slotLevel: 2 },
        supply('goblin-saves', 40),
      ),
      'Levitate on a goblin who makes the save',
    );
    expect(saves(made)).toHaveLength(1);
    expect(height(world(made.events), GOBLIN)).toBe(0);

    const failed = unwrap(
      resolveSpell(
        world(),
        WIZARD,
        { spellId: 'levitate', targets: [GOBLIN], slotLevel: 2 },
        supply('goblin-fails', -40),
      ),
      'Levitate on a goblin who fails it',
    );
    expect(saves(failed)).toHaveLength(1);
    expect(height(world(failed.events), GOBLIN)).toBe(20);
  });
});

// — the target rule that requires consent ——————————————————————————————————

describe('SRD Mage Armor is cast on a willing creature and on nobody else', () => {
  /** The caster is willing by being the caster. */
  it('lands on the caster with nothing stated', () => {
    const out = unwrap(
      resolveSpell(
        world(),
        WIZARD,
        { spellId: 'mage-armor', targets: [WIZARD], slotLevel: 1 },
        supply(),
      ),
      'Mage Armor on yourself',
    );
    expect(out.events.some((event) => event.type === 'spell-cast')).toBe(true);
  });

  /**
   * **Asked, not refused, and never assumed.** An ally's consent is a fact
   * about the fiction that the engine holds nothing to derive it from — `side`
   * is a different question — so a casting that has not been told is homework
   * rather than a rules refusal, and nothing is spent while it waits.
   */
  it('asks whose consent it is when nobody has said, and spends nothing', () => {
    const rng = createRng('unspent') as Rng;
    const before = rng.snapshot();
    const out = resolveSpell(
      world(),
      WIZARD,
      { spellId: 'mage-armor', targets: [ALLY], slotLevel: 1 },
      { issuer: createRollIssuer('r'), rng, content: SRD_CONTENT },
    );

    expect(isNeedsContext(out)).toBe(true);
    expect(refusal(out)).toBe('consent_not_stated');
    expect(contextRequestsOf(out).map((one) => one.subject)).toEqual([ALLY]);
    expect(contextRequestsOf(out)[0]!.satisfyWith).toContain('willing');
    // Nothing was spent and no die was thrown.
    expect(rng.snapshot()).toEqual(before);
  });

  it('lands on an ally the caster named as willing', () => {
    const out = unwrap(
      resolveSpell(
        world(),
        WIZARD,
        { spellId: 'mage-armor', targets: [ALLY], slotLevel: 1, willing: [ALLY] },
        supply(),
      ),
      'Mage Armor on a willing ally',
    );
    expect(out.events.some((event) => event.type === 'spell-cast')).toBe(true);
    expect(world(out.events).creatures[ALLY]!.armorClasses).not.toHaveLength(0);
  });
});

// — the symmetry the other eight stated facts already keep ————————————————

describe('a fact a spell does not ask for is refused rather than ignored', () => {
  it('refuses a willing list on a spell that prints neither clause', () => {
    const out = resolveSpell(
      world(),
      WIZARD,
      { spellId: 'fire-bolt', targets: [GOBLIN], willing: [GOBLIN] },
      supply(),
    );
    expect(refusal(out)).toBe('no_willing_clause');
  });

  /** An empty list is as much an answer to a question nobody asked as a full one. */
  it('refuses an empty willing list on the same spell', () => {
    const out = resolveSpell(
      world(),
      WIZARD,
      { spellId: 'fire-bolt', targets: [GOBLIN], willing: [] },
      supply(),
    );
    expect(refusal(out)).toBe('no_willing_clause');
  });

  /** Consent is said about a creature this casting is aimed at, or about nobody. */
  it('refuses a named creature that is not a target of this casting', () => {
    const out = resolveSpell(
      world(),
      WIZARD,
      { spellId: 'mage-armor', targets: [ALLY], slotLevel: 1, willing: [ALLY, GOBLIN] },
      supply(),
    );
    expect(refusal(out)).toBe('willing_not_a_target');
  });

  it('refuses the same creature named twice', () => {
    const out = resolveSpell(
      world(),
      WIZARD,
      { spellId: 'mage-armor', targets: [ALLY], slotLevel: 1, willing: [ALLY, ALLY] },
      supply(),
    );
    expect(refusal(out)).toBe('duplicate_willing_target');
  });

  it('refuses a creature the engine has never heard of', () => {
    const out = resolveSpell(
      world(),
      WIZARD,
      { spellId: 'mage-armor', targets: [ALLY], slotLevel: 1, willing: [id('nobody')] },
      supply(),
    );
    expect(refusal(out)).toBe('unknown_creature');
  });
});

// — the fact crosses the seam a held casting opens ————————————————————————

describe('a casting held open settles with the consent it was declared with', () => {
  /**
   * The ninth stated fact across the seam the other eight already cross: a
   * settlement takes no fresh request, so a Levitate declared over a willing
   * ally must not settle by asking the ally to save. It fails silently if the
   * declaration drops it — a Constitution save is a perfectly plausible
   * outcome of this spell, and the only thing that says it should not have
   * been rolled is the word the caster said a round ago.
   */
  it('lifts a willing ally with no save when the declaration is settled', () => {
    const declared = unwrap(
      resolveSpell(
        world(),
        WIZARD,
        { spellId: 'levitate', targets: [ALLY], slotLevel: 2, willing: [ALLY], hold: true },
        supply('declare', 40),
      ),
      'declaring Levitate over a willing ally',
    );
    expect(saves(declared)).toHaveLength(0);

    const pending = pendingCastingsOf(world(declared.events));
    expect(pending).toHaveLength(1);
    expect(pending[0]!.willing).toEqual([ALLY]);

    const settled = unwrap(
      resolveDeclaredCast(world(declared.events), declared.castingId!, supply('settle', 40)),
      'settling it',
    );
    expect(saves(settled)).toHaveLength(0);
    expect(height(world([...declared.events, ...settled.events]), ALLY)).toBe(20);
  });

  /**
   * And an **empty** list is the same casting as no list at all, which is
   * where this fact parts company with `fought`: neither consent clause
   * insists on an answer, so "nobody consented" and "nobody was named" cannot
   * be two different records — see `willingFor`.
   */
  it('records nothing for a declaration that named nobody willing', () => {
    const declared = unwrap(
      resolveSpell(
        world(),
        WIZARD,
        { spellId: 'levitate', targets: [GOBLIN], slotLevel: 2, willing: [], hold: true },
        supply('declare-empty', 40),
      ),
      'declaring Levitate over a goblin',
    );
    expect(pendingCastingsOf(world(declared.events))[0]!.willing).toBeUndefined();
  });
});

// — and the catalogue says the clause where the book prints it ————————————

describe('the catalogue writes the consent clause where the SRD prints it', () => {
  /**
   * The spells that print "a willing creature" as their target rule, out of
   * the book's own text rather than out of a list somebody typed here: each is
   * expected to carry `targets.willing`, and every definition that carries it
   * is expected to print the word.
   */
  it('marks every level 0–3 definition whose target rule says so', () => {
    const printed = [
      'arcanists-magic-aura',
      'barkskin',
      'darkvision',
      'dragons-breath',
      'fly',
      'gaseous-form',
      'guidance',
      'haste',
      'heroism',
      'jump',
      'mage-armor',
      'nondetection',
      'protection-from-energy',
      'protection-from-evil-and-good',
      'resistance',
      'spider-climb',
      'warding-bond',
      'water-breathing',
      'water-walk',
    ];
    for (const spellId of printed) {
      const definition = SPELL_DEFINITIONS.find((d) => d.id === spellId);
      expect(definition, spellId).toBeDefined();
      expect(definition!.targets.willing, spellId).toBe(true);
    }
  });

  /** And SRD Levitate is the save, not the target rule. */
  it('gives Levitate the save an unwilling creature makes and no consent gate', () => {
    const levitate = SPELL_DEFINITIONS.find((d) => d.id === 'levitate')!;
    expect(levitate.targets.willing).toBeUndefined();
    expect(
      levitate.effects.some(
        (effect) => effect.kind === 'save' && effect.unlessWilling === true,
      ),
    ).toBe(true);
  });
});
