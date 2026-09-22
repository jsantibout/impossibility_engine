import { describe, expect, it } from 'vitest';
import { SRD_CONTENT, SPELL_DEFINITIONS } from '@ie/content';
import { asCharacterId, expect as unwrap, isErr, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from '@ie/engine';
import {
  createRng,
  createRollIssuer,
  declaredCasting,
  fold,
  resolveSpell,
  resolveTurn,
  spellSlotKey,
  takeDash,
  type GameEvent,
  type GameState,
  type Rng,
} from '@ie/engine';
import {
  ITEM_SHAPES,
  MISSING_SHAPES,
  TRACKED_ADJUDICATED,
  misanchoredAdjudications,
} from '../scripts/missing-shapes.js';

/**
 * The forty-five tracked spells in level 1–5 reach that nobody had read.
 *
 * `LEDGER.md` prints three populations and a fourth column — *waits on none* —
 * and the fourth is the one that lies. An entry missing from
 * `TRACKED_ADJUDICATED` says **nothing**: it is what a spell looks like the
 * day its definition lands and it is what a spell looks like after somebody
 * has read every sentence and found no debt, and the ledger printed both as
 * finished business. Forty-five of the fifty-two spells in that column had no
 * entry at all, which is why the audit before this one called them done.
 *
 * So this file is the reading, written down where the report can count it. Four
 * lists, because conflating any two of these outcomes is the defect being
 * closed:
 *
 * | | |
 * |---|---|
 * | {@link FILED} | a sentence that is a **debt** — a mechanism over state the engine authoritatively holds, filed against the shape that blocks it |
 * | {@link HANDOVERS} | a paragraph whose every mechanical word is about something the engine holds nothing of — an object, a light, a language, a thing somebody learns |
 * | {@link EXECUTES} | a spell whose debt turned out to be **stale**: the shape it named has since been built, and the definition writes it |
 * | {@link NEEDS_A_DECISION} | a debt whose shape exists in the **item** vocabulary and cannot be named from this one without widening a type |
 *
 * `docs/design/content.md` is where that line is drawn and it is drawn by the
 * reader rather than by a marker: *a table fact that a rule then reads is a
 * debt; a table fact nothing reads afterwards is a handover.* Objects, light,
 * corpses, extradimensional spaces and knowledge have no reader in this engine
 * and will not grow one by being listed; a creature's type, an ongoing casting,
 * Difficult Terrain, the action economy and a bonus on a roll all have one
 * today.
 *
 * **Not one shape id below is new.** Each is already in {@link MISSING_SHAPES}
 * with a citation, and three of them name the very spell filed against them —
 * `a-creature-fact-an-effect-overrides` names Arcanist's Magic Aura,
 * `a-rider-on-a-later-weapon-attack` names Magic Weapon, and
 * `a-cap-on-how-many-castings-run-at-once` names the sentence Prestidigitation
 * prints with a number in it.
 */

/**
 * The spells this pass found a debt in, and the shapes each one waits on.
 *
 * Written out rather than derived, for the reason every other list in this
 * package is: a spell joining or leaving it is somebody's reading, and it
 * should have to say so here.
 */
const FILED: Readonly<Record<string, readonly string[]>> = {
  'animate-dead': ['a-stat-block-created-mid-fight', 'a-target-rule-the-format-cannot-state'],
  'arcanists-magic-aura': ['a-creature-fact-an-effect-overrides'],
  darkvision: ['senses-beyond-declared-sight'],
  knock: ['an-effect-that-suppresses-other-magic'],
  'magic-weapon': ['a-rider-on-a-later-weapon-attack'],
  nondetection: ['an-effect-that-suppresses-other-magic'],
  'pass-without-trace': [
    'a-bonus-narrowed-to-a-skill',
    'a-standing-effect-derived-from-where-a-creature-stands',
  ],
  prestidigitation: ['a-cap-on-how-many-castings-run-at-once'],
  'speak-with-animals': ['an-action-a-spell-compels-or-forbids'],
  'speak-with-plants': ['difficult-terrain-an-area-creates'],
  'tiny-hut': [
    'a-barrier-that-blocks-passage',
    'a-casting-ended-by-a-trigger',
    'an-effect-that-suppresses-other-magic',
  ],
};

/**
 * And the spells the same reading finished: every mechanical word in them is
 * about something outside this engine, and no shape is waiting to be built.
 *
 * These are the honest occupants of the ledger's fourth column. What records
 * the reading for one of them is its definition's own `unmodelled` list, which
 * is why that is asserted here rather than taken on trust — an empty one would
 * be a spell nobody read wearing the same face as a spell somebody finished,
 * which is the whole complaint this file answers.
 */
const HANDOVERS: readonly string[] = [
  'alarm',
  'arcane-lock',
  'clairvoyance',
  'comprehend-languages',
  'continual-flame',
  'create-food-and-water',
  'create-or-destroy-water',
  'dancing-lights',
  'daylight',
  'detect-evil-and-good',
  'detect-magic',
  'detect-poison-and-disease',
  'druidcraft',
  'elementalism',
  'find-traps',
  'floating-disk',
  'fog-cloud',
  'gentle-repose',
  'identify',
  'illusory-script',
  'light',
  'locate-animals-or-plants',
  'locate-object',
  'mage-hand',
  'mending',
  'message',
  'purify-food-and-drink',
  'rope-trick',
  'speak-with-dead',
  'tongues',
  'water-breathing',
  'water-walk',
];

/**
 * And the one whose debt was stale — see the block below, which drives it.
 *
 * A list of one rather than a sentence, because it is a third outcome of the
 * same reading and the arithmetic has to add up to forty-five.
 */
const EXECUTES: readonly string[] = ['expeditious-retreat'];

/**
 * And the one the reading found a debt in that this vocabulary cannot name.
 *
 * SRD Remove Curse: "If the object is a cursed magic item, its curse remains,
 * but the spell breaks its owner's Attunement to the object so it can be
 * removed or discarded." Its `unmodelled` called Attunement unmodelled and that
 * is false — `CreatureState.attuned` holds it, `attuneItem` writes it, and
 * `attuned` and `attunement-ended` are both events the fold applies — so this
 * is a table fact a rule then reads, which is a debt.
 *
 * **The shape exists and names this spell by name.** `ITEM_SHAPES`'
 * `what-ends-attunement-besides-a-command` is "an attunement that ends, or
 * refuses to end, for a reason no command gives", and its own description
 * finishes on "armour that cannot be doffed until a Remove Curse lands". Four
 * cursed items already sit on it.
 *
 * **It cannot be filed from here, and inventing a way is not a reading.**
 * `TrackedAdjudication.why` takes `'table' | 'engine' | ShapeId`, and that id is
 * an `ItemShapeId`. Filing it means widening the field to `ItemBlockerId` — one
 * union of two vocabularies that every guard over both maps would then have to
 * be re-read against — or minting a second id in `MISSING_SHAPES` for one gap,
 * which is the duplication the item vocabulary was split out to avoid. Either
 * is a decision about the shape of the record rather than a reading of a
 * paragraph, so the finding is written down and the decision is left.
 *
 * A list of one rather than a comment, because a comment is what the ledger
 * already could not count.
 */
const NEEDS_A_DECISION: readonly string[] = ['remove-curse'];

describe('the forty-five unadjudicated spells are read', () => {
  it('accounts for every one of them exactly once', () => {
    const read = [...Object.keys(FILED), ...HANDOVERS, ...EXECUTES, ...NEEDS_A_DECISION];
    expect(read).toHaveLength(45);
    expect(new Set(read).size).toBe(45);
  });

  it('names them in an order two branches can both append to', () => {
    expect(Object.keys(FILED)).toEqual([...Object.keys(FILED)].sort());
    expect(HANDOVERS).toEqual([...HANDOVERS].sort());
  });

  it.each(Object.entries(FILED))('files %s against the shapes it waits on', (spellId, shapes) => {
    const entries = TRACKED_ADJUDICATED[spellId] ?? [];
    expect(entries.length, `${spellId} has no adjudication`).toBeGreaterThan(0);
    expect([...new Set(entries.map((entry) => entry.why))].sort(), spellId).toEqual([...shapes]);
    expect(misanchoredAdjudications(spellId), spellId).toEqual([]);
    for (const shape of shapes) expect(Object.keys(MISSING_SHAPES), spellId).toContain(shape);
  });

  it.each(HANDOVERS.map((s) => [s] as const))('leaves %s waiting on nothing', (spellId) => {
    expect(TRACKED_ADJUDICATED[spellId], `${spellId} is filed after all`).toBeUndefined();
    const definition = SPELL_DEFINITIONS.find((d) => d.id === spellId);
    expect(definition, `${spellId} has no definition`).toBeDefined();
    expect((definition?.unmodelled ?? []).length, spellId).toBeGreaterThan(0);
  });

  /**
   * And the finding that is left for somebody with the authority to take it.
   *
   * Asserted as facts rather than as prose: the shape is real and belongs to
   * the other vocabulary, this one does not hold it, and the spell is filed
   * against nothing in the meantime. All three have to change together on the
   * day the decision is taken, which is what keeps this from being a note.
   */
  it('leaves Remove Curse read, unfiled, and said so', () => {
    for (const spellId of NEEDS_A_DECISION) {
      expect(TRACKED_ADJUDICATED[spellId], spellId).toBeUndefined();
    }
    expect(Object.keys(ITEM_SHAPES)).toContain('what-ends-attunement-besides-a-command');
    expect(Object.keys(MISSING_SHAPES)).not.toContain('what-ends-attunement-besides-a-command');
  });
});

/**
 * Darkness, tracked — the last spell in `BLOCKED_ON` held back by a decision
 * rather than by a transcription.
 *
 * Four of its five clauses are handovers the map already recorded, and the
 * fifth was filed `expressible`. `packages/content/src/spells.ts` says why the
 * Sphere is still quoted to the table rather than pinned as a `SpellArea`, and
 * it is the argument Daylight and Fog Cloud already make one spell along.
 */
describe('Darkness is cast rather than refused', () => {
  const definition = SRD_CONTENT.spell('darkness');

  it('is the spell the book prints, field by field', () => {
    expect(definition).not.toBeNull();
    expect(definition?.level).toBe(2);
    expect(definition?.school).toBe('evocation');
    expect(definition?.castingTime).toBe('action');
    expect(definition?.concentration).toBe(true);
    expect(definition?.durationSeconds).toBe(600);
    expect(definition?.range).toEqual({ kind: 'ranged', feet: 60 });
  });

  it('resolves nothing and says so', () => {
    expect(definition?.effects).toEqual([]);
    expect((definition?.unmodelled ?? []).length).toBeGreaterThan(3);
  });
});

// — Expeditious Retreat, executed on no engine change ————————————————————————
//
// The one spell of the forty-five whose debt was **stale**. Its `unmodelled`
// said "nothing lets a spell reach the action economy except by naming a
// condition", and `ActionRule` has been the ninth sourced grant since IE-046:
// `allows` moves a named action to a cheaper slot, `STATABLE_PRICES` holds
// `dash` out of a Bonus Action, and `takeDash` takes the price and refuses one
// the map does not hold. So the Bonus Action Dash is transcription, and what is
// left is the *free* Dash the casting itself grants — an extra action rather
// than an existing one governed, which is Haste's residue under the same shape.

const id = (s: string): CharacterId => asCharacterId(s);
const WIZARD = id('wizard');

const sheet = (): CharacterSheet => ({
  level: 5,
  abilities: { str: 10, dex: 14, con: 12, int: 18, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'int',
});

const SETUP: readonly GameEvent[] = [
  {
    type: 'creature-added',
    id: WIZARD,
    name: 'wizard',
    sheet: sheet(),
    maxHp: 30,
    diesAtZero: false,
    creatureType: 'Humanoid',
    side: 'party',
  },
  {
    type: 'spellcasting-declared',
    id: WIZARD,
    spellcasting: declaredCasting({
      ability: 'int',
      classId: 'wizard',
      cantrips: [],
      prepared: ['expeditious-retreat'],
    }),
  },
  {
    type: 'resource-pool-declared',
    id: WIZARD,
    pool: {
      key: spellSlotKey(1),
      label: 'level 1 spell slot',
      max: 4,
      recovers: 'long-rest',
    },
  },
  { type: 'scene-set', extent: { width: 200, depth: 200, height: 40 } },
  { type: 'creature-placed', id: WIZARD, placement: { from: { sceneCenter: true }, feet: 0 } },
  { type: 'combat-started', combatants: [{ id: WIZARD, initiative: 20, speed: 30 }] },
];

const supply = () => ({
  issuer: createRollIssuer('retreat'),
  rng: createRng('retreat') as Rng,
  content: SRD_CONTENT,
});

const after = (events: readonly GameEvent[]): GameState => fold('seed', events);

describe('Expeditious Retreat moves the Dash to a Bonus Action', () => {
  const definition = SRD_CONTENT.spell('expeditious-retreat')!;

  it('writes the allowance the SRD prints', () => {
    expect(definition.effects).toEqual([
      { kind: 'action-rule', rule: { kind: 'allows', action: 'dash', from: 'bonus-action' } },
    ]);
  });

  /** Without the casting, a Bonus Action buys no Dash — so the rule is doing it. */
  it('refuses a Bonus Action Dash before the spell is cast', () => {
    expect(isErr(takeDash(after(SETUP), WIZARD, {}, { from: 'bonus-action' }))).toBe(true);
  });

  /**
   * On a **later** turn, because the casting is itself a Bonus Action: the SRD
   * prints "Casting Time: Bonus Action", so the turn the spell goes up on has
   * none left and the allowance is spent from the next one onwards.
   */
  it('allows one while the casting runs', () => {
    const cast = unwrap(
      resolveSpell(
        after(SETUP),
        WIZARD,
        { spellId: 'expeditious-retreat', targets: [WIZARD], slotLevel: 1 },
        supply(),
      ),
      'the retreat',
    );
    const running = [
      ...SETUP,
      ...cast.events,
      ...unwrap(resolveTurn(after([...SETUP, ...cast.events]), supply()), 'the next turn').events,
    ];
    const dashed = unwrap(
      takeDash(after(running), WIZARD, {}, { from: 'bonus-action' }),
      'the Bonus Action Dash',
    );
    const budget = after([...running, ...dashed]).combat?.budgets.wizard;
    // The Bonus Action is gone and the Action is still there, which is the
    // whole of what the allowance buys.
    expect(budget?.bonusAction).toBe(false);
    expect(budget?.action).toBe(true);
  });
});
