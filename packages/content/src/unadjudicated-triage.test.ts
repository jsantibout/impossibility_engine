import { describe, expect, it } from 'vitest';
import { FEATURE_SHAPES } from '../scripts/missing-feature-shapes.js';
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
 * So this file is the reading. **Gate G1 found it written in the wrong place**
 * — a test file no generator imports — and the reading is now in
 * `TRACKED_ADJUDICATED`, where `spellShapesOf` counts it; what stays here is
 * the four-way sort, held against the map entry by entry. Five lists, because
 * conflating any two of these outcomes is the defect being closed:
 *
 * | | |
 * |---|---|
 * | {@link FILED} | a sentence that is a **debt** — a mechanism over state the engine authoritatively holds, filed against the shape that blocks it |
 * | {@link HANDOVERS} | a paragraph whose every mechanical word is about something the engine holds nothing of — an object, a language, a thing somebody learns |
 * | {@link LIGHT} | the six this pass filed as handovers and G1 re-filed as debts, because there had been no id for light to file them against |
 * | {@link EXECUTES} | a spell whose debt is no longer owed: the shape it named is built, and the definition writes it |
 * | {@link NEEDS_A_DECISION} | a debt whose shape exists in the **item** vocabulary and could not be named from this one without widening a type |
 *
 * `docs/design/content.md` is where that line is drawn and it is drawn by the
 * reader rather than by a marker: *a table fact that a rule then reads is a
 * debt; a table fact nothing reads afterwards is a handover.* Objects,
 * corpses, extradimensional spaces and knowledge have no reader in this engine
 * and will not grow one by being listed; a creature's type, an ongoing casting,
 * Difficult Terrain, the action economy and a bonus on a roll all have one
 * today. **Light was on the first list and belongs on the second**, which is
 * the sort this pass got wrong: the glossary maps Dim Light to Lightly
 * Obscured and Darkness to Heavily Obscured, and every sight question in the
 * book reads it afterwards.
 *
 * **Not one shape id below is new.** Each is already in {@link MISSING_SHAPES}
 * with a citation, and three of them named the very spell filed against them —
 * `a-creature-fact-an-effect-overrides` named Arcanist's Magic Aura,
 * `a-cap-on-how-many-castings-run-at-once` named the sentence Prestidigitation
 * prints with a number in it, and `a-rider-on-a-later-weapon-attack` named
 * Magic Weapon. All three shapes have since been built and all three spells
 * have moved to {@link EXECUTES}, which is the list working rather than the
 * claim weakening: a shape whose own description names one spell is a shape a
 * batch can finish.
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
  knock: ['an-effect-that-suppresses-other-magic'],
  nondetection: ['an-effect-that-suppresses-other-magic'],
  'speak-with-plants': ['difficult-terrain-an-area-creates'],
  'tiny-hut': [
    'a-barrier-that-blocks-passage',
    'a-casting-ended-by-a-trigger',
    'an-effect-that-suppresses-other-magic',
  ],
};

/**
 * And the spells the same reading found nothing but fiction in.
 *
 * These are the honest occupants of the ledger's last column. What records
 * the reading is now **two** things and it used to be one: the definition's
 * own `unmodelled` list, and — since gate G1 — a `TRACKED_ADJUDICATED` entry
 * saying `'table'`, anchored to a sentence of the book.
 *
 * **The second is the whole of what G1 changed and why this list shrank.**
 * While the reading lived only here, `spellShapesOf` read
 * `TRACKED_ADJUDICATED[id] ?? []` and saw nothing, so the report printed
 * thirty-four spells as finished business on the strength of a test file no
 * generator imports. A reading nothing measures is indistinguishable from a
 * paragraph nobody opened, which is the defect this file was opened to close
 * and did not — because it closed it in the wrong place.
 */
const HANDOVERS: readonly string[] = [
  'alarm',
  'arcane-lock',
  'clairvoyance',
  'comprehend-languages',
  'create-food-and-water',
  'create-or-destroy-water',
  'detect-evil-and-good',
  'detect-magic',
  'detect-poison-and-disease',
  'druidcraft',
  'elementalism',
  'find-traps',
  'floating-disk',
  'identify',
  'illusory-script',
  'locate-animals-or-plants',
  'locate-object',
  'mage-hand',
  'mending',
  'message',
  'purify-food-and-drink',
  'rope-trick',
  // Re-read on 2026-09-24 and moved off {@link FILED}: the entry that filed
  // it said the Influence action had no spender, and `takeInfluence` has been
  // one since. That command never narrowed by the target's creature type, so
  // an Influence attempt on a Beast was always legal and always rolled and
  // there was never anything for the spell to widen. What it buys is
  // comprehension, which is speech, which the engine holds none of.
  'speak-with-animals',
  'speak-with-dead',
  'tongues',
  'water-breathing',
  'water-walk',
];

/**
 * The six this reading got wrong, and the id that did not exist to file them.
 *
 * Every one of them was in {@link HANDOVERS}. Each prints a light level or a
 * degree of obscurement, which is a rule the glossary states and the engine
 * has no room for at all — `senses.test.ts` says outright that it holds no
 * Bright, Dim or Darkness — so each is a **debt** and not a handover. What
 * made the mistake easy to commit is that there was nowhere to record the
 * truth: a case-insensitive search of `missing-shapes.ts` for *light* or
 * *obscur* returned notes and no shape id, so the only filing available said
 * the table owns it.
 *
 * `light-and-obscurement-the-scene-holds` is that id, and
 * `docs/design/light-and-sight.md` is the design behind it.
 *
 * **Three of the six have left, and the list records the departure rather
 * than shrinking quietly** — see {@link LIGHT_EXECUTED}. P3-S built the shape,
 * so Darkness, Daylight and Fog Cloud each resolve the patch that is the
 * whole of what they do and are no longer tracked at all. What is left here
 * is the three whose light comes from a **thing**: a touched object, an
 * everburning flame on one, four floating motes. The engine holds no objects,
 * so a patch has nowhere to hang, which is the residue the shape's own
 * description names.
 */
// Empty since 2026-09-23: the last three left the day a casting's light could
// be carried by its bearer or moved with its motes. See `LIGHT_EXECUTED`.
const LIGHT: readonly string[] = [];

/**
 * The three that left, kept as a list so the arithmetic stays checkable.
 *
 * Each is **executed** now rather than handed over or in debt, which is the
 * third outcome this file already has a shape for in {@link EXECUTES} — and
 * it is kept separate from that one because the reason differs: Expeditious
 * Retreat's debt was stale on the day it was written, and these three were
 * true readings that a later batch made false.
 */
const LIGHT_EXECUTED: readonly string[] = [
  'continual-flame',
  'dancing-lights',
  'darkness',
  'daylight',
  'fog-cloud',
  'light',
];

/**
 * The ones whose debt is no longer owed — see the block below, which drives
 * the first.
 *
 * A list rather than a sentence, because it is a third outcome of the same
 * reading and the arithmetic has to add up to forty-five.
 *
 * Expeditious Retreat's debt was **stale**: the shape it named had already
 * been built when this pass read it. Magic Weapon's was **paid**, which is the
 * outcome this list was always going to have to hold: it waited on
 * `a-rider-on-a-later-weapon-attack` and named itself in that shape's own
 * description, the `weapon-rider` grant was built, and the definition writes
 * the whole of it — the plus on both rolls and the two bands a higher slot
 * buys. What is left of its paragraph is that a weapon's magicality is not a
 * fact the engine holds, which trips no marker and is nobody's debt.
 */
// Darkvision joined the two the day a casting could confer a sense, and
// Prestidigitation the day `maxRunning` gave a cap of three somewhere to be
// counted — its debt was owed and is now paid, which is the outcome this list
// was always going to have to hold more of.
const EXECUTES: readonly string[] = [
  // The day a sourced grant could put a creature type over another creature's
  // own, and `typeMagicSees` could say which readers believe it.
  'arcanists-magic-aura',
  'darkvision',
  'expeditious-retreat',
  // **And the shortest round trip this file has recorded.** Gentle Repose came
  // onto {@link FILED} on 2026-09-24, off {@link HANDOVERS}, because
  // `healing-that-raises-the-dead` had been built and the sentence this spell
  // prints widens exactly the window `revive` reads. The `preserves` mark is
  // that debt paid: the casting's own running span comes back out of the time
  // since `Vitals.diedAt`, and what is left of the paragraph — the decay, the
  // Undead, and remains that are not a creature — is the table's.
  'gentle-repose',
  'magic-weapon',
  // And the one the area-standing track finished: the +10 on Dexterity
  // (Stealth) checks of whoever is in the aura is derived from the scene on
  // every read, which is both shapes this pass filed it against.
  'pass-without-trace',
  'prestidigitation',
  // And the one that came here through {@link NEEDS_A_DECISION} rather than
  // straight off {@link FILED}: the decision was the shape of the record, the
  // shape was then built, and the Attunement a Remove Curse breaks is the
  // engine's now.
  'remove-curse',
];

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
 * **Gate G1 took the decision this list was left waiting for.**
 * `TrackedAdjudication.why` took `'table' | 'engine' | ShapeId`, and that id is
 * an `ItemShapeId`. Filing it meant widening the field to `ItemBlockerId` — one
 * union of two vocabularies that every guard over both maps then has to be
 * re-read against — or minting a second id in `MISSING_SHAPES` for one gap,
 * which is the duplication the item vocabulary was split out to avoid. The
 * first was taken and the guards were re-read; what stays here is the record
 * that it was a decision about the shape of the record and not a reading of a
 * paragraph.
 *
 * A list of one rather than a comment, because a comment is what the ledger
 * already could not count.
 */
const NEEDS_A_DECISION: readonly string[] = [];

/**
 * **And the decision was taken, and then the debt was paid.**
 *
 * G1 widened `TrackedAdjudication.why` to reach the item vocabulary, which is
 * what let Remove Curse be filed at all; the `end-attunement` effect is what
 * settled it. The spell is executed now — the Attunement the caster names is
 * broken, an object the target is not attuned to is refused before a slot is
 * spent — so it is in {@link EXECUTES} with the others, and this list is empty
 * rather than gone: a record of a finding kept where the next reader will meet
 * it, exactly as {@link LIGHT} is.
 */

describe('the forty-five unadjudicated spells are read', () => {
  it('accounts for every one of them exactly once', () => {
    const read = [
      ...Object.keys(FILED),
      ...HANDOVERS,
      ...LIGHT,
      ...LIGHT_EXECUTED,
      ...EXECUTES,
      ...NEEDS_A_DECISION,
    ];
    // **Forty-six, and the extra one is Darkness.** The forty-five were the
    // tracked spells nobody had read; Darkness arrived out of `BLOCKED_ON` in
    // the same pass, was filed as a handover on the same wrong reading, and is
    // the spell the light shape was found on. Counting it out to keep the
    // round number would be the omission this file exists to end.
    //
    // **The total does not move when a spell is finished**, which is what
    // {@link LIGHT_EXECUTED} is for: three of the six left `LIGHT` when P3-S
    // built the shape, and they are added back here rather than subtracted,
    // because the claim this arithmetic makes is about *readings* and every
    // one of the forty-six was still read.
    expect(read).toHaveLength(46);
    expect(new Set(read).size).toBe(46);
    expect(LIGHT_EXECUTED).toContain('darkness');
  });

  it('names them in an order two branches can both append to', () => {
    expect(Object.keys(FILED)).toEqual([...Object.keys(FILED)].sort());
    expect(HANDOVERS).toEqual([...HANDOVERS].sort());
    expect(LIGHT).toEqual([...LIGHT].sort());
  });

  it.each(Object.entries(FILED))('files %s against the shapes it waits on', (spellId, shapes) => {
    const entries = TRACKED_ADJUDICATED[spellId] ?? [];
    expect(entries.length, `${spellId} has no adjudication`).toBeGreaterThan(0);
    // **The shapes, and a `'table'` entry is not one.** A spell can print a
    // debt in one sentence and fiction in the next — Gentle Repose does, and
    // so does Magic Mouth — and this list is what each one *waits on*, which a
    // handover is not. A spell whose every entry says `'table'` still fails:
    // the filtered list is empty and the shapes are not.
    const waits = entries.filter((entry) => entry.why !== 'table');
    expect([...new Set(waits.map((entry) => entry.why))].sort(), spellId).toEqual([...shapes]);
    expect(misanchoredAdjudications(spellId), spellId).toEqual([]);
    const known = [...Object.keys(MISSING_SHAPES), ...Object.keys(FEATURE_SHAPES)];
    for (const shape of shapes) expect(known, spellId).toContain(shape);
  });

  /**
   * The reading, written where a generator reads it rather than where a
   * reviewer does.
   *
   * Four claims per spell now, and the first two are where P3-S6 changed this
   * file: the definition **hands its text over** and prints **no debt at all**,
   * the map carries an entry, and every clause of that entry says the table
   * owns it. A spell that turns out to carry a debt has to come here and leave
   * this list, which is what Gentle Repose just did.
   *
   * It read `unmodelled` before, and that was the contradiction: a spell whose
   * every clause the map calls the table's, printing its clauses on the list
   * `docs/design/content.md` defines as "a debt: the blocker map ranks it, and
   * one day somebody pays it by building the shape". Both statements could not
   * be true, and the ledger believed the first while `COVERAGE.md` counted the
   * second.
   */
  it.each(HANDOVERS.map((s) => [s] as const))('records %s as read and handed over', (spellId) => {
    const definition = SPELL_DEFINITIONS.find((d) => d.id === spellId);
    expect(definition, `${spellId} has no definition`).toBeDefined();
    expect((definition?.dmDecides ?? []).length, `${spellId} hands nothing over`).toBeGreaterThan(0);
    expect((definition?.unmodelled ?? []), `${spellId} still files a debt`).toEqual([]);

    const entries = TRACKED_ADJUDICATED[spellId] ?? [];
    expect(entries.length, `${spellId} is unread after all`).toBeGreaterThan(0);
    expect([...new Set(entries.map((entry) => entry.why))], spellId).toEqual(['table']);
    expect(misanchoredAdjudications(spellId), spellId).toEqual([]);
  });

  /**
   * And the six the first reading filed wrong, each with a clause naming the
   * shape that did not exist on the day it was read — all six have since
   * left, so the emptiness is the claim: nothing in the tracked map is filed
   * against the light shape any more, and the list stays so the arithmetic
   * below can still be read off it.
   */
  it('files nothing against the light shape any more', () => {
    expect(LIGHT).toEqual([]);
    const stillFiled = Object.entries(TRACKED_ADJUDICATED)
      .filter(([, entries]) =>
        entries.some((entry) => entry.why === 'light-and-obscurement-the-scene-holds'),
      )
      .map(([spellId]) => spellId);
    expect(stillFiled).toEqual([]);
  });

  /**
   * And the three the shape finished, from the other end: each is executed,
   * each has left the tracked map altogether, and what it hands over is a
   * thing rather than a light.
   */
  it.each(LIGHT_EXECUTED.map((s) => [s] as const))('executes %s rather than tracking it', (spellId) => {
    const definition = SPELL_DEFINITIONS.find((d) => d.id === spellId);
    expect(definition, `${spellId} has no definition`).toBeDefined();
    // A patch over the area, or a light the casting's target carries — the
    // second is how Light and Continual Flame shed without an object to hang on.
    expect(
      definition?.areaLight ??
        definition?.areaObscurement ??
        definition?.effects.find((effect) => effect.kind === 'light'),
      `${spellId} lays no patch, so nothing of it is resolved`,
    ).toBeDefined();
    expect(TRACKED_ADJUDICATED[spellId], `${spellId} is tracked again`).toBeUndefined();
  });

  /** And there is exactly one id for it, which is what there was none of. */
  it('gives light and obscurement one id in the spell vocabulary', () => {
    expect(Object.keys(MISSING_SHAPES).filter((shape) => /light|obscur/i.test(shape))).toEqual([
      'light-and-obscurement-the-scene-holds',
    ]);
  });

  /**
   * And the finding that was left for somebody with the authority to take it,
   * now taken.
   *
   * Asserted as facts rather than as prose: the shape is real, it belongs to
   * the other vocabulary, this one still does not hold it, and the spell names
   * it from here. All four stay true together, which is what keeps the
   * widening from quietly becoming a second copy of the id.
   */
  it('files Remove Curse nowhere any more, because the shape was built', () => {
    // Nothing is waiting on the decision: the list is empty, and the spell it
    // held is executed rather than tracked.
    expect(NEEDS_A_DECISION).toEqual([]);
    expect(TRACKED_ADJUDICATED['remove-curse']).toBeUndefined();
    expect(EXECUTES).toContain('remove-curse');
    // And the widening that made the filing possible is not undone by the
    // spell leaving: the id is still the item vocabulary's, still not this
    // one's, and four cursed items still sit on it.
    expect(Object.keys(ITEM_SHAPES)).toContain('what-ends-attunement-besides-a-command');
    expect(Object.keys(MISSING_SHAPES)).not.toContain('what-ends-attunement-besides-a-command');
  });
});

/**
 * Darkness, executed — and the spell this file used to hold up as the one
 * held back by a decision rather than by a transcription.
 *
 * The decision was the Sphere, and P3-S took it: light is on the lattice, so
 * a template that resolved nothing now resolves a patch of magical darkness
 * and three of the four quoted clauses go with it. `packages/content/src/
 * spells.ts` says which and why. One is left, and it is the object.
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

  /**
   * **It resolves no *effect* and it is no longer silent.** The clause this
   * file used to assert — that four or more sentences were handed over — is
   * down to one, and the sentence that replaced them is the Sphere: an area
   * with a light level over it, which is a thing `lightAt` reads at every
   * question about who can see whom.
   */
  it('darkens its own Sphere, and hands over only the object', () => {
    expect(definition?.effects).toEqual([]);
    expect(definition?.area).toEqual({ kind: 'sphere', radius: 15, origin: 'point' });
    expect(definition?.areaLight).toEqual({ level: 'darkness' });
    expect(definition?.unmodelled ?? []).toHaveLength(1);
    expect((definition?.unmodelled ?? [])[0]).toContain('object');
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

  /**
   * **Both clauses of the sentence now, and they are two different members.**
   * "You take the Dash action" is an extra action handed over once, as the
   * casting resolves, narrowed to the one action the book names; "you can
   * take that action again as a Bonus Action" is the standing price. The
   * first was the residue this spell carried until `grants` existed.
   */
  it('writes the allowance the SRD prints, and the free Dash beside it', () => {
    expect(definition.effects).toEqual([
      { kind: 'action-rule', rule: { kind: 'grants', at: 'casting', only: ['dash'] } },
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
