import { SRD_CONTENT } from '@ie/content';
import { describe, expect, it } from 'vitest';
import {
  asCharacterId,
  isErr,
  expect as unwrap,
  type CharacterId,
  type Result,
} from '@ie/shared';
import type { CatalogueItem } from './catalogue.js';
import type { CharacterSheet } from './character.js';
import { extendContent, type Content } from './content.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { declaredCasting, type SpellcastingState } from './spellcasting.js';
import type { Point } from './positioning.js';
import {
  awardItems,
  chargesLeft,
  damageCreature,
  equipItem,
  ongoingSpellOf,
  owedAreaEffectsOf,
  resolveDeclaredCast,
  resolveSpell,
  resolveTurn,
  unequipItem,
} from './commands.js';

/**
 * A charge buys a casting, and the casting is a real one.
 *
 * SRD "Spells Cast from Items" settles the shape in one sentence: "The spell
 * uses its normal casting time, range, and duration, and **the user of the
 * item must concentrate if the spell requires Concentration**." So a wand
 * casting Web goes down the path a Wizard's Web goes down — a casting id, a
 * `spell-cast`, the Concentration the definition asks for, an ongoing record
 * Dispel Magic can find, and an area that goes on catching people on later
 * turns — rather than being a second resolver wearing an item's name.
 *
 * The three things that are the *item's* rather than the wielder's are each a
 * separate claim, and each has its own case below:
 *
 * | | SRD | Where it lives |
 * |---|---|---|
 * | the charge | "expend 1 charge" | the item's pool, spent inside the casting's own batch |
 * | the level | "the lowest possible spell and caster level" | the grant, raised by the charges where the line says so |
 * | the numbers | "(save DC 15)" / "using your spell save DC" | a field on the grant, then a rule in the resolver |
 *
 * **What is not here is the charge surviving a refusal.** That claim belongs
 * with the other "a refused command leaves nothing behind" claims, which is
 * `invariants.test.ts`, and it is made there over the same wand.
 */

const id = (s: string) => asCharacterId(s);
const WIELDER = id('wielder');
const VICTIM = id('victim');

const WAND = 'wand-of-fireballs';
const WEB_WAND = 'wand-of-web';
const STAFF = 'staff-of-fire';
const CAPE = 'cape-of-the-mountebank';
/** The homebrew below: a wand with no bracket, no printed DC, and Web behind it. */
const PLAIN = 'wand-of-the-plain-web';

/**
 * A level 11 wizard's numbers, so every DC below is arithmetic rather than a
 * recalled constant: Proficiency Bonus 4, Intelligence 20 (+5).
 */
const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 11,
  abilities: { str: 10, dex: 10, con: 10, int: 20, wis: 16, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'int',
  weaponProficiencies: ['simple', 'martial'],
  ...over,
});

const PROFICIENCY = 4;
const WIZARD_DC = 8 + PROFICIENCY + 5;

const supply = (seed = 'wand', flat = -40, content: Content = SRD_CONTENT) => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content,
  bonuses: [{ source: 'the fixture', flat }],
});

const HERE: Point = { x: 200, y: 200, z: 0 };
const THERE: Point = { x: 240, y: 200, z: 0 };
/** Web forms a Cube, and a Cube has to be pointed somewhere. */
const ALONG: Point = { x: 300, y: 200, z: 0 };
/** Inside the 20-foot Cube laid from `THERE` along +x, which spans 240 to 260. */
const INSIDE: Point = { x: 250, y: 200, z: 0 };

const added = (who: CharacterId, over: Partial<CharacterSheet> = {}): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(over),
  maxHp: 300,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side: who === WIELDER ? 'party' : 'foes',
});

/** One spellcasting ability, which is every single-classed caster. */
const WIZARDLY: SpellcastingState = declaredCasting({
  ability: 'int',
  classId: 'wizard',
  prepared: ['fireball', 'web'],
});

/**
 * Two spellcasting abilities, which is what SRD's middle sentence is about.
 *
 * Built by hand rather than through `declaredCasting`, which makes one entry:
 * the fact under test is a creature with *two*, and there is no other way to
 * say so.
 */
const TWO_MINDED: SpellcastingState = {
  classes: [
    { classId: 'wizard', ability: 'int', cantrips: [], prepared: [], slotKind: 'spell' },
    { classId: 'cleric', ability: 'wis', cantrips: [], prepared: [], slotKind: 'spell' },
  ],
  granted: [],
};

const casting = (what: SpellcastingState): GameEvent => ({
  type: 'spellcasting-declared',
  id: WIELDER,
  spellcasting: what,
});

const SCENE: readonly GameEvent[] = [
  { type: 'scene-set', extent: { width: 900, depth: 900, height: 60 } },
  { type: 'landmark-added', name: 'here', at: HERE },
  { type: 'landmark-added', name: 'there', at: THERE },
  { type: 'landmark-added', name: 'along', at: ALONG },
  { type: 'landmark-added', name: 'in the web', at: INSIDE },
  { type: 'creature-placed', id: WIELDER, placement: { from: { landmark: 'here' }, feet: 0 } },
  { type: 'creature-placed', id: VICTIM, placement: { from: { landmark: 'in the web' }, feet: 0 } },
  { type: 'sight-declared', from: WIELDER, to: VICTIM, seen: true },
  { type: 'sight-declared', from: VICTIM, to: WIELDER, seen: true },
];

const run = (
  log: readonly GameEvent[],
  command: (s: GameState) => Result<readonly GameEvent[]>,
): readonly GameEvent[] => [...log, ...unwrap(command(fold('seed', log)), 'command')];

/**
 * What the DM found, handed over.
 *
 * `awardItems` rather than a hand-written `items-gained`, which this file used
 * to write: a hand-written gain is a line with no record, and a copy with no
 * record has no charge pool — nothing declares one for it, since the equip
 * stopped doing so the day an award command existed to do it properly.
 */
const awarded = (
  log: readonly GameEvent[],
  itemId: string,
  content: Content = SRD_CONTENT,
): readonly GameEvent[] =>
  run(log, (s) =>
    awardItems(s, supply('the-hoard', -40, content), WIELDER, [{ id: itemId }], 'the hoard'),
  );

/**
 * Owned, in hand and — where the item's line prints the bracket — attuned to.
 *
 * The attunement arrives as its own event rather than through `attuneItem`,
 * which needs a Short Rest and a prerequisite check of its own:
 * `attunement.test.ts` owns that command, and what is under test here is what
 * the attunement *gates*.
 */
const holding = (
  itemId: string,
  over: {
    readonly spellcasting?: SpellcastingState;
    readonly attune?: boolean;
    readonly content?: Content;
    /** What the wielder's own sheet says, where that is the thing under test. */
    readonly sheet?: Partial<CharacterSheet>;
  } = {},
): readonly GameEvent[] => {
  const content = over.content ?? SRD_CONTENT;
  const base = awarded(
    [
      added(WIELDER, over.sheet ?? {}),
      added(VICTIM),
      ...(over.spellcasting === undefined ? [] : [casting(over.spellcasting)]),
      ...SCENE,
    ],
    itemId,
    content,
  );
  const equipped = run(base, (s) => equipItem(s, content, WIELDER, itemId));
  const needsAttunement = content.item(itemId)?.attunement !== undefined;
  return !needsAttunement || over.attune === false
    ? equipped
    : [...equipped, { type: 'attuned', id: WIELDER, item: itemId }];
};

const left = (
  log: readonly GameEvent[],
  itemId: string,
  content: Content = SRD_CONTENT,
): number => chargesLeft(fold('seed', log), content, WIELDER, itemId);

const castOf = (events: readonly GameEvent[]) =>
  events.find((e) => e.type === 'spell-cast') as Extract<GameEvent, { type: 'spell-cast' }> | undefined;

describe('a wand casts, and what it casts is a casting', () => {
  it('spends the charge, writes a spell-cast, and says no slot paid for it', () => {
    const log = holding(WAND, { spellcasting: WIZARDLY });
    const out = unwrap(
      resolveSpell(
        fold('seed', log),
        WIELDER,
        { spellId: 'fireball', targets: [], at: THERE, item: WAND, charges: 1 },
        supply(),
      ),
      'the wand casting Fireball',
    );

    const cast = castOf(out.events);
    // SRD: it "doesn't expend any of the user's spell slots", and the log says
    // which of the reasons for skipping one this was.
    expect(cast?.slotless).toBe('magic-item');
    expect(cast?.slot).toBeNull();
    expect(cast?.level).toBe(3);
    expect(cast?.route).toBe(`item:${WAND}`);
    expect(out.castingId).toBe('cast:1');

    // The charge went, and it went inside this casting's own batch.
    expect(left([...log, ...out.events], WAND)).toBe(6);
    expect(
      out.events.filter((e) => e.type === 'resource-spent' && e.key === `${WAND}:charges@item:1`),
    ).toHaveLength(1);

    // And the spell actually happened: Fireball called for a save.
    expect(out.outcomes.map((o) => o.target)).toContain(VICTIM);
  });

  /**
   * SRD Wand of Fireballs: "For 1 charge, you cast the level 3 version of the
   * spell. You can increase the spell's level by 1 for each additional charge
   * you expend." The one thing about a casting from an item that the *wielder*
   * decides, and the level reaches the log rather than being worked out again.
   */
  it.each([
    [1, 3],
    [2, 4],
    [3, 5],
  ])('casts at a level the charges decide: %i charges is level %i', (charges, level) => {
    const log = holding(WAND, { spellcasting: WIZARDLY });
    const out = unwrap(
      resolveSpell(
        fold('seed', log),
        WIELDER,
        { spellId: 'fireball', targets: [], at: THERE, item: WAND, charges },
        supply(`charges-${charges}`),
      ),
      `the wand at ${charges} charges`,
    );
    expect(castOf(out.events)?.level).toBe(level);
    expect(left([...log, ...out.events], WAND)).toBe(7 - charges);
  });

  it('spends the price the item prints when the caster names no count', () => {
    const log = holding(WEB_WAND, { spellcasting: WIZARDLY });
    const out = unwrap(
      resolveSpell(
        fold('seed', log),
        WIELDER,
        { spellId: 'web', targets: [], at: THERE, towards: ALONG, item: WEB_WAND },
        supply('default-charge'),
      ),
      'the wand casting Web',
    );
    expect(left([...log, ...out.events], WEB_WAND)).toBe(6);
  });

  /** A count the item's line does not offer is refused, never rounded. */
  it('refuses a charge count the item does not print', () => {
    const log = holding(WAND, { spellcasting: WIZARDLY });
    const tooMany = resolveSpell(
      fold('seed', log),
      WIELDER,
      { spellId: 'fireball', targets: [], at: THERE, item: WAND, charges: 4 },
      supply(),
    );
    expect(isErr(tooMany) && tooMany.code).toBe('bad_charges');

    const fixed = resolveSpell(
      fold('seed', holding(WEB_WAND, { spellcasting: WIZARDLY })),
      WIELDER,
      { spellId: 'web', targets: [], at: THERE, towards: ALONG, item: WEB_WAND, charges: 2 },
      supply(),
    );
    expect(isErr(fixed) && fixed.code).toBe('bad_charges');
  });

  it('refuses a charge count with no item to spend it from', () => {
    const out = resolveSpell(
      fold('seed', holding(WAND, { spellcasting: WIZARDLY })),
      WIELDER,
      { spellId: 'fireball', targets: [], at: THERE, charges: 2 },
      supply(),
    );
    expect(isErr(out) && out.code).toBe('charges_without_an_item');
  });

  it('refuses an item that casts nothing, and one that casts something else', () => {
    const log = holding('chain-shirt', { spellcasting: WIZARDLY });
    const nothing = resolveSpell(
      fold('seed', log),
      WIELDER,
      { spellId: 'fireball', targets: [], at: THERE, item: 'chain-shirt' },
      supply(),
    );
    expect(isErr(nothing) && nothing.code).toBe('item_casts_nothing');

    const other = resolveSpell(
      fold('seed', holding(WEB_WAND, { spellcasting: WIZARDLY })),
      WIELDER,
      { spellId: 'fireball', targets: [], at: THERE, item: WEB_WAND },
      supply(),
    );
    expect(isErr(other) && other.code).toBe('item_casts_nothing');
    expect(isErr(other) && other.reason).toContain('Web');
  });

  /**
   * SRD: it "doesn't expend any of the user's spell slots", and the level is
   * the item's. So every other way of saying how a casting is paid for is
   * refused rather than quietly dropped — the answer a Ritual handed a slot
   * already gets.
   */
  it.each([
    ['a slot level', { slotLevel: 4 }],
    ['a payment', { payment: 'slot' as const }],
    ['a stated slotless reason', { slotless: 'innate' as const }],
    ['a Ritual', { ritual: true as const }],
  ])('refuses %s beside the item', (_name, extra) => {
    const out = resolveSpell(
      fold('seed', holding(WAND, { spellcasting: WIZARDLY })),
      WIELDER,
      { spellId: 'fireball', targets: [], at: THERE, item: WAND, ...extra },
      supply(),
    );
    expect(isErr(out) && out.code).toBe('item_pays_no_slot');
  });

  /**
   * **Attunement gates the route, not merely the pool.** A wand in an
   * unattuned hand gives nothing, so it does not get as far as the charge.
   */
  it('refuses an unattuned hand, with no charge gone', () => {
    const log = holding(WAND, { spellcasting: WIZARDLY, attune: false });
    const out = resolveSpell(
      fold('seed', log),
      WIELDER,
      { spellId: 'fireball', targets: [], at: THERE, item: WAND, charges: 1 },
      supply(),
    );
    expect(isErr(out) && out.code).toBe('not_attuned');
    expect(left(log, WAND)).toBe(7);
  });

  it('refuses an item nobody is holding, and one the catalogue has never heard of', () => {
    const owned: readonly GameEvent[] = [
      ...awarded([added(WIELDER), added(VICTIM), casting(WIZARDLY), ...SCENE], WAND),
      { type: 'attuned', id: WIELDER, item: WAND },
    ];
    const inTheBag = resolveSpell(
      fold('seed', owned),
      WIELDER,
      { spellId: 'fireball', targets: [], at: THERE, item: WAND },
      supply(),
    );
    expect(isErr(inTheBag) && inTheBag.code).toBe('not_equipped');

    const unknown = resolveSpell(
      fold('seed', holding(WAND, { spellcasting: WIZARDLY })),
      WIELDER,
      { spellId: 'fireball', targets: [], at: THERE, item: 'wand-of-nothing-at-all' },
      supply(),
    );
    expect(isErr(unknown) && unknown.code).toBe('unknown_item');
  });

  it('refuses an empty wand as a value', () => {
    let log = holding(WAND, { spellcasting: WIZARDLY });
    for (let spent = 0; spent < 2; spent += 1) {
      log = [
        ...log,
        ...unwrap(
          resolveSpell(
            fold('seed', log),
            WIELDER,
            { spellId: 'fireball', targets: [], at: THERE, item: WAND, charges: 3 },
            supply(`drain-${spent}`),
          ),
          'draining the wand',
        ).events,
      ];
    }
    expect(left(log, WAND)).toBe(1);

    const out = resolveSpell(
      fold('seed', log),
      WIELDER,
      { spellId: 'fireball', targets: [], at: THERE, item: WAND, charges: 3 },
      supply('empty'),
    );
    expect(isErr(out) && out.code).toBe('exhausted');
    expect(left(log, WAND)).toBe(1);
  });
});

/**
 * **The case the whole decision rests on.**
 *
 * A wand casting Web is not a charge spent and an area conjured beside it: it
 * is a casting, so it does everything a casting does. SRD's sentence is the
 * only authority the engine needs — "the user of the item must concentrate if
 * the spell requires Concentration" — and everything else follows from Web's
 * own definition rather than from anything the item says.
 *
 * *(The brief named the Staff of Fire's Wall of Fire for this. The catalogue
 * has no definition of that spell: `blocked-on.test.ts` records it as blocked
 * on a wall — an area shape the engine does not hold — and on damage with
 * neither an attack roll nor a save. The Wand of Web is the same claim on a
 * spell the engine can actually resolve, and it proves one thing more, because
 * the wand prints its own DC.)*
 */
describe('a wand casting Web does everything a casting does', () => {
  const conjured = (seed = 'webbing') => {
    const log = holding(WEB_WAND, { spellcasting: WIZARDLY });
    const out = unwrap(
      resolveSpell(
        fold('seed', log),
        WIELDER,
        { spellId: 'web', targets: [], at: THERE, towards: ALONG, item: WEB_WAND },
        supply(seed),
      ),
      'the wand casting Web',
    );
    return { log: [...log, ...out.events], castingId: out.castingId };
  };

  it('starts the Concentration the definition asks for', () => {
    const { log, castingId } = conjured();
    const state = fold('seed', log);
    expect(state.creatures[WIELDER]?.concentration?.castingId).toBe(castingId);
    expect(castOf(log)?.concentration).toBe(true);
  });

  /**
   * SRD: "You lose Concentration on an effect the moment you start casting a
   * spell that requires Concentration." A wand is no exception, which is the
   * half that a charge-and-an-effect implementation would have got wrong.
   */
  it('drops the Concentration its wielder was already holding', () => {
    const first = conjured('first');
    const out = unwrap(
      resolveSpell(
        fold('seed', first.log),
        WIELDER,
        { spellId: 'web', targets: [], at: HERE, towards: ALONG, item: WEB_WAND },
        supply('second'),
      ),
      'a second casting from the same wand',
    );
    expect(
      out.events.some(
        (e) =>
          e.type === 'concentration-ended' &&
          e.castingId === first.castingId &&
          e.reason === 'another-concentration-effect',
      ),
    ).toBe(true);
    const after = fold('seed', [...first.log, ...out.events]);
    expect(after.creatures[WIELDER]?.concentration?.castingId).toBe(out.castingId);
  });

  /**
   * The record Dispel Magic reads, with the shape and the clause pinned on it.
   * Without this a wand's Web would be a spell nothing could find, end or
   * stand in.
   */
  it('leaves an ongoing record carrying its area, its trigger and its numbers', () => {
    const { log, castingId } = conjured();
    const record = ongoingSpellOf(fold('seed', log), castingId);
    expect(record?.spellId).toBe('web');
    expect(record?.area).toEqual({ kind: 'cube', size: 20, origin: 'point' });
    expect(record?.areaTrigger?.at).toBe('start-of-turn');
    expect(record?.origin).toEqual(THERE);
    // The wand's DC, pinned at the casting. See the printed-numbers case below.
    expect(record?.numbers.saveDc).toBe(13);
    // SRD: "The spell is cast at the lowest possible spell and caster level."
    expect(record?.numbers.casterLevel).toBe(1);
    expect(record?.level).toBe(2);
  });

  /**
   * And a later turn raises the debt **through** the record, which is the
   * assertion that says the area is a real one: the webbing catches whoever
   * starts a turn in it, on the casting the wand made.
   */
  it('goes on catching people on a later turn', () => {
    const { log, castingId } = conjured();
    const fighting: readonly GameEvent[] = [
      ...log,
      {
        type: 'combat-started',
        combatants: [
          { id: WIELDER, initiative: 20, speed: 30 },
          { id: VICTIM, initiative: 10, speed: 30 },
        ],
      },
    ];

    const turn = unwrap(resolveTurn(fold('seed', fighting), supply('boundary')), 'the turn');
    const settled = turn.events.filter(
      (e) => e.type === 'area-effect-settled' && e.castingId === castingId,
    );
    expect(settled.length, 'the webbing caught the creature standing in it').toBeGreaterThan(0);
    // Nothing is left owing: the boundary raised it and settled it.
    expect(owedAreaEffectsOf(fold('seed', [...fighting, ...turn.events]))).toEqual([]);
  });
});

/**
 * A casting an item made and a Counterspell was offered, settled later.
 *
 * SRD Counterspell answers "a creature in the process of casting a spell", and
 * a wand's casting is a casting — so it may be held open exactly as a wizard's
 * is. That opens the one gap an item route has that no class route has: the
 * route is a fact about an *object*, and the object can leave the hand between
 * the declaration and the settlement.
 *
 * A class casting re-derives its route at settlement because the caster's
 * sheet cannot have changed underneath it. An item's cannot be re-derived at
 * all, so the declaration writes its numbers down — and this is the case that
 * says so, by putting the wand away before the spell lands.
 */
describe('a casting held open outlives the wand that made it', () => {
  const declared = () => {
    const log = holding(WEB_WAND, { spellcasting: WIZARDLY });
    const out = unwrap(
      resolveSpell(
        fold('seed', log),
        WIELDER,
        { spellId: 'web', targets: [], at: THERE, towards: ALONG, item: WEB_WAND, hold: true },
        supply('declared'),
      ),
      'declaring the wand casting',
    );
    return { log: [...log, ...out.events], castingId: out.castingId };
  };

  it('pins the item’s numbers on the declaration', () => {
    const { log, castingId } = declared();
    const pending = fold('seed', log).pendingCastings[castingId];
    expect(pending?.route).toBe(`item:${WEB_WAND}`);
    expect(pending?.numbers?.saveDc).toBe(13);
    expect(pending?.numbers?.casterLevel).toBe(1);
    // And the charge is already gone: the declaration is the casting.
    expect(left(log, WEB_WAND)).toBe(6);
  });

  /**
   * And the *ability* beside them, which is the half a pinned
   * `CastingNumbers` cannot carry.
   *
   * SRD Dispel Magic rolls "an ability check using your spellcasting ability",
   * and the ability decides the roll's modes and which conditions fail it
   * outright — so it is not a number and the numbers cannot stand in for it.
   * Nor can the wielder's *sheet*: a Fighter whose only spellcasting is a
   * feat's has a null `spellcastingAbility` and an ability all the same, and
   * reading the sheet would refuse a casting whose charge had already gone.
   */
  it('pins the ability too, for the wielder whose sheet does not carry one', () => {
    const dispeller: CatalogueItem = {
      id: 'wand-of-unweaving',
      name: 'Wand of Unweaving',
      kind: 'wand',
      weightLb: 1,
      costCp: null,
      armor: null,
      weapon: null,
      contents: [],
      grants: [
        { kind: 'pool', key: 'wand-of-unweaving:charges', label: 'Wand of Unweaving charges', uses: 3, recovers: 'dawn' },
        { kind: 'casts', spell: 'dispel-magic', charges: 1, saveDc: 15 },
      ],
    };
    const content = unwrap(extendContent(SRD_CONTENT, { items: [dispeller] }), 'the dispelling wand');

    // A wielder who casts through a feat and nothing else: the sheet says they
    // have no spellcasting ability, and the feat says they have Wisdom.
    const byFeat: SpellcastingState = {
      classes: [],
      granted: [
        {
          spellId: 'nothing-in-particular',
          source: 'sage:magic-initiate',
          ability: 'wis',
          freeCastPool: null,
          slotCasting: false,
        },
      ],
    };
    const log = holding('wand-of-unweaving', {
      content,
      spellcasting: byFeat,
      sheet: { spellcastingAbility: null },
    });

    const declared = unwrap(
      resolveSpell(
        fold('seed', log),
        WIELDER,
        { spellId: 'dispel-magic', targets: [VICTIM], item: 'wand-of-unweaving', hold: true },
        supply('unweave', -40, content),
      ),
      'declaring the dispel',
    );
    const after = [...log, ...declared.events];
    expect(fold('seed', after).pendingCastings[declared.castingId]?.ability).toBe('wis');

    // And it settles, rather than refusing a casting whose charge is gone.
    const settled = resolveDeclaredCast(
      fold('seed', after),
      declared.castingId,
      supply('settling-dispel', -40, content),
    );
    expect(isErr(settled) ? `${settled.code}: ${settled.reason}` : 'ok').toBe('ok');
  });

  it('settles with them after the wand has left the hand', () => {
    const { log, castingId } = declared();
    const dropped = run([...log], (s) => unequipItem(s, SRD_CONTENT, WIELDER, WEB_WAND));
    expect(fold('seed', dropped).creatures[WIELDER]?.equipped).toEqual([]);

    const settled = unwrap(
      resolveDeclaredCast(fold('seed', dropped), castingId, supply('settling')),
      'settling a casting whose wand is put away',
    );
    const record = ongoingSpellOf(fold('seed', [...dropped, ...settled.events]), castingId);
    expect(record?.numbers.saveDc).toBe(13);
    expect(record?.area).toEqual({ kind: 'cube', size: 20, origin: 'point' });
  });
});

/**
 * The numbers: the item's, then the wielder's.
 *
 * SRD prints a rule once and no item restates it — "A magic item may require
 * the user to use their own spellcasting ability when casting a spell from the
 * item. If the user has more than one spellcasting ability, the user chooses
 * which one to use with the item. If the user doesn't have a spellcasting
 * ability, their spellcasting ability modifier is +0 for the item, and the
 * user's Proficiency Bonus applies." So the printed number is a field on the
 * grant and the fallback is a rule in the resolver, and all four cases are
 * here because an implementation can get any one of them right alone.
 */
describe('the numbers are the item’s, then the wielder’s', () => {
  /**
   * A homebrew wand: no bracket, no printed DC, and Web behind it.
   *
   * Every SRD item that defers to the wielder also demands attunement by a
   * class that has a spellcasting ability, so the two fallbacks that need a
   * wielder *without* one cannot be reached through the book's own catalogue.
   * This is the smallest item that reaches them, and it goes in through
   * `extendContent` — the same door homebrew always uses.
   */
  const HOMEBREW: CatalogueItem = {
    id: PLAIN,
    name: 'Wand of the Plain Web',
    kind: 'wand',
    weightLb: 1,
    costCp: null,
    armor: null,
    weapon: null,
    contents: [],
    grants: [
      { kind: 'pool', key: `${PLAIN}:charges`, label: 'Wand of the Plain Web charges', uses: 7, recovers: 'dawn' },
      { kind: 'casts', spell: 'web', charges: 1 },
    ],
  };

  const WITH_HOMEBREW: Content = unwrap(
    extendContent(SRD_CONTENT, { items: [HOMEBREW] }),
    'the homebrew wand',
  );

  const plainWeb = (spellcasting: SpellcastingState | undefined, source?: string) => {
    const log = holding(PLAIN, { content: WITH_HOMEBREW, ...(spellcasting === undefined ? {} : { spellcasting }) });
    return {
      log,
      out: resolveSpell(
        fold('seed', log),
        WIELDER,
        {
          spellId: 'web',
          targets: [],
          at: THERE,
          towards: ALONG,
          item: PLAIN,
          ...(source === undefined ? {} : { source }),
        },
        supply('plain', -40, WITH_HOMEBREW),
      ),
    };
  };

  const dcOf = (log: readonly GameEvent[], events: readonly GameEvent[], castingId: string): number => {
    const record = ongoingSpellOf(fold('seed', [...log, ...events]), castingId);
    if (record === null) throw new Error('no ongoing record');
    return record.numbers.saveDc;
  };

  /**
   * **The printed DC wins over the wielder**, which is the half a resolver
   * that simply asked the sheet would get wrong every time. An archmage
   * holding a Wand of Web still lays webbing at DC 13, four below her own.
   */
  it('uses the number the item prints, however good its holder is', () => {
    const log = holding(WEB_WAND, { spellcasting: WIZARDLY });
    const out = unwrap(
      resolveSpell(
        fold('seed', log),
        WIELDER,
        { spellId: 'web', targets: [], at: THERE, towards: ALONG, item: WEB_WAND },
        supply('printed'),
      ),
      'the wand casting Web',
    );
    expect(dcOf(log, out.events, out.castingId)).toBe(13);
    expect(WIZARD_DC).toBe(17);
  });

  /**
   * And the same wand casting Fireball rolls the printed save rather than the
   * wizard's — asserted off the save the casting actually called for, because
   * Fireball leaves nothing running to read a number off.
   */
  it('saves against the printed DC even where nothing is left running', () => {
    const log = holding(WAND, { spellcasting: WIZARDLY });
    const out = unwrap(
      resolveSpell(
        fold('seed', log),
        WIELDER,
        { spellId: 'fireball', targets: [], at: THERE, item: WAND, charges: 1 },
        supply('printed-fireball'),
      ),
      'the wand casting Fireball',
    );
    const saves = out.outcomes.flatMap((outcome) => (outcome.save === undefined ? [] : [outcome.save]));
    expect(saves.length).toBeGreaterThan(0);
    for (const save of saves) expect(save.dc).toBe(15);
  });

  /** SRD Staff of Fire: "using your spell save DC" — so it is the wielder's. */
  it('uses the wielder’s own DC where the item’s line says to', () => {
    const log = holding(STAFF, { spellcasting: WIZARDLY });
    const out = unwrap(
      resolveSpell(
        fold('seed', log),
        WIELDER,
        { spellId: 'fireball', targets: [], at: THERE, item: STAFF },
        supply('staff'),
      ),
      'the staff casting Fireball',
    );
    const saves = out.outcomes.flatMap((outcome) => (outcome.save === undefined ? [] : [outcome.save]));
    expect(saves.length).toBeGreaterThan(0);
    for (const save of saves) expect(save.dc).toBe(WIZARD_DC);
    // And its own table's price, three charges rather than the wand's one.
    expect(left([...log, ...out.events], STAFF)).toBe(7);
  });

  /**
   * "If the user has more than one spellcasting ability, the user chooses" —
   * so the engine refuses rather than picking, in the shape `chooseRoute`
   * already refuses two classes that prepared one spell, and through the same
   * `source` field.
   */
  it('refuses to choose between two spellcasting abilities, and names them', () => {
    const { out } = plainWeb(TWO_MINDED);
    expect(isErr(out) && out.code).toBe('class_required');
    expect(isErr(out) && out.reason).toContain('class:wizard');
    expect(isErr(out) && out.reason).toContain('class:cleric');
  });

  it('takes the one the caller names, and refuses one that supplies none', () => {
    const chosen = plainWeb(TWO_MINDED, 'class:cleric');
    const out = unwrap(chosen.out, 'naming the cleric half');
    // Wisdom 16 is +3, so 8 + 4 + 3 rather than the wizard's 17.
    expect(dcOf(chosen.log, out.events, out.castingId)).toBe(8 + PROFICIENCY + 3);

    const wrong = plainWeb(TWO_MINDED, 'class:bard');
    expect(isErr(wrong.out) && wrong.out.code).toBe('source_does_not_supply');
  });

  /**
   * **A printed DC does not settle the whole question**, and this is the case
   * that says so.
   *
   * SRD gives the item the DC and the *spell* the modifier: "regains a number
   * of Hit Points equal to 2d8 plus your spellcasting ability modifier" is
   * Cure Wounds' sentence, and a wand that prints a save DC has said nothing
   * about it. So a wielder with two abilities is asked which even there —
   * without that, the same wand would heal for the wielder's modifier in one
   * hand and for nothing in another, on the strength of how many casting
   * classes they happened to have.
   */
  it('asks which ability where the spell adds its modifier, printed DC or not', () => {
    const mender: CatalogueItem = {
      ...HOMEBREW,
      id: 'wand-of-mending',
      name: 'Wand of Mending',
      grants: [
        { kind: 'pool', key: 'wand-of-mending:charges', label: 'Wand of Mending charges', uses: 3, recovers: 'dawn' },
        // A printed DC, which Cure Wounds never reads, beside a spell that
        // does read the wielder's modifier.
        { kind: 'casts', spell: 'cure-wounds', charges: 1, saveDc: 15 },
      ],
    };
    const content = unwrap(extendContent(SRD_CONTENT, { items: [mender] }), 'the mending wand');
    const heal = (spellcasting: SpellcastingState, source?: string) => {
      const log = [
        ...holding('wand-of-mending', { content, spellcasting }),
        // Hurt, so there is room for the healing to land in: a creature at its
        // maximum regains nothing and the two abilities would tie at zero.
        ...unwrap(
          damageCreature(
            fold('seed', holding('wand-of-mending', { content, spellcasting })),
            WIELDER,
            { amount: 100, source: 'the fixture' },
          ),
          'hurting the wielder',
        ),
      ];
      return {
        log,
        out: resolveSpell(
          fold('seed', log),
          WIELDER,
          {
            spellId: 'cure-wounds',
            // Range: Touch, so the wielder heals themselves — which is the
            // ordinary use anyway and keeps the geometry out of the claim.
            targets: [WIELDER],
            item: 'wand-of-mending',
            ...(source === undefined ? {} : { source }),
          },
          supply('mending', -40, content),
        ),
      };
    };

    const asked = heal(TWO_MINDED);
    expect(isErr(asked.out) && asked.out.code).toBe('class_required');
    expect(chargesLeft(fold('seed', asked.log), content, WIELDER, 'wand-of-mending')).toBe(3);

    // Named, it heals for that ability's modifier: Wisdom 16 is +3.
    const named = unwrap(heal(TWO_MINDED, 'class:cleric').out, 'naming the cleric half');
    const wisdom = named.outcomes[0]?.healed ?? 0;
    const intellect = unwrap(heal(WIZARDLY).out, 'a single-classed wizard').outcomes[0]?.healed ?? 0;
    // Same wand, same seed, same 2d8 — so the whole difference is +5 against +3.
    expect(intellect - wisdom).toBe(2);
  });

  /**
   * **A number the item printed settles that number and no other**, which is
   * why the question is asked per number rather than over the grant.
   *
   * An item that prints a save DC and casts a spell *attack* has deferred the
   * attack modifier as surely as one that prints nothing at all, and one that
   * prints an attack bonus and casts a saving-throw spell has deferred the DC.
   * Before this, both took the fallback silently: a two-ability wielder rolled
   * at a flat Proficiency Bonus where a single-classed one rolled at their own
   * modifier, with nothing said.
   */
  it.each([
    // A printed DC, a spell that attacks: the attack modifier is the deferred
    // number, and Guiding Bolt is what reads it.
    ['a printed DC beside a spell attack', 'guiding-bolt', { saveDc: 15 }],
    // And the mirror: a printed attack bonus beside a spell that only saves.
    ['a printed attack bonus beside a saving throw', 'web', { attackBonus: 9 }],
    // SRD Bane is a `buff` that a Charisma save resists, so the DC is read by
    // a kind that mostly does not read one. Which of the two a `buff` is comes
    // off the same field the resolver branches on, and nothing else says.
    ['a buff the target saves against', 'bane', {}],
  ])('asks which ability for %s', (_name, spell, printed) => {
    const half: CatalogueItem = {
      ...HOMEBREW,
      id: 'wand-of-half-measures',
      name: 'Wand of Half Measures',
      grants: [
        { kind: 'pool', key: 'wand-of-half-measures:charges', label: 'Wand of Half Measures charges', uses: 3, recovers: 'dawn' },
        { kind: 'casts', spell, charges: 1, ...printed },
      ],
    };
    const content = unwrap(extendContent(SRD_CONTENT, { items: [half] }), 'the half-printed wand');
    const log = holding('wand-of-half-measures', { content, spellcasting: TWO_MINDED });
    const out = resolveSpell(
      fold('seed', log),
      WIELDER,
      {
        spellId: spell,
        // Web picks its own targets out of a Cube it has to be pointed at;
        // the other two are aimed at a creature.
        targets: spell === 'web' ? [] : [VICTIM],
        ...(spell === 'web' ? { at: THERE, towards: ALONG } : {}),
        item: 'wand-of-half-measures',
      },
      supply('half', -40, content),
    );
    expect(isErr(out) && out.code).toBe('class_required');
    expect(chargesLeft(fold('seed', log), content, WIELDER, 'wand-of-half-measures')).toBe(3);
  });

  /**
   * And the wands that really do ask nothing still ask nothing — which is the
   * other direction of the same table, and the one a rule that simply erred
   * towards asking would break.
   *
   * Two shapes: an item that printed every number its spell reads, and an item
   * that printed none because its spell reads none. SRD Bless is the second —
   * a `buff` with no ability, so nobody rolls against a DC and there is no
   * number for the wielder to supply — and it sits one field away from Bane,
   * which does.
   */
  it.each([
    ['printed every number read', WAND, 'fireball'],
    ['casts a spell that reads none', 'wand-of-benediction', 'bless'],
  ])('asks nothing of a two-ability wielder where the item %s', (_name, item, spell) => {
    const blessing: CatalogueItem = {
      ...HOMEBREW,
      id: 'wand-of-benediction',
      name: 'Wand of Benediction',
      grants: [
        { kind: 'pool', key: 'wand-of-benediction:charges', label: 'Wand of Benediction charges', uses: 3, recovers: 'dawn' },
        { kind: 'casts', spell: 'bless', charges: 1 },
      ],
    };
    const content = unwrap(extendContent(SRD_CONTENT, { items: [blessing] }), 'the blessing wand');
    const log = holding(item, { content, spellcasting: TWO_MINDED });
    const out = resolveSpell(
      fold('seed', log),
      WIELDER,
      spell === 'bless'
        ? { spellId: spell, targets: [WIELDER], item }
        : { spellId: spell, targets: [], at: THERE, item, charges: 1 },
      supply('no-question', -40, content),
    );
    expect(isErr(out) ? `${out.code}: ${out.reason}` : 'ok').toBe('ok');
  });

  /**
   * "If the user doesn't have a spellcasting ability, their spellcasting
   * ability modifier is +0 for the item, and the user's Proficiency Bonus
   * applies." A creature that casts nothing of its own picks the wand up and
   * it still works — at 8 + 4 + 0.
   */
  it('gives a wielder with no spellcasting +0 and their Proficiency Bonus', () => {
    const { log, out: result } = plainWeb(undefined);
    const out = unwrap(result, 'a wand in a hand that casts nothing');
    expect(dcOf(log, out.events, out.castingId)).toBe(8 + PROFICIENCY);
    const record = ongoingSpellOf(fold('seed', [...log, ...out.events]), out.castingId);
    expect(record?.numbers.attackModifier).toBe(PROFICIENCY);
    expect(record?.numbers.spellcastingModifier).toBe(0);
  });

  /**
   * And the one thing "+0" cannot answer: SRD Dispel Magic rolls "an ability
   * check using your spellcasting ability", and an ability is not a number —
   * it decides the roll's modes and which conditions fail it outright. So a
   * wielder who has none is refused, **before the charge goes**, rather than
   * halfway through a resolution that has already taken it.
   */
  it('refuses a casting that must roll with an ability the wielder has not got', () => {
    const dispeller: CatalogueItem = {
      ...HOMEBREW,
      id: 'wand-of-unweaving',
      name: 'Wand of Unweaving',
      grants: [
        { kind: 'pool', key: 'wand-of-unweaving:charges', label: 'Wand of Unweaving charges', uses: 3, recovers: 'dawn' },
        { kind: 'casts', spell: 'dispel-magic', charges: 1, saveDc: 15 },
      ],
    };
    const content = unwrap(extendContent(SRD_CONTENT, { items: [dispeller] }), 'the dispelling wand');
    const log = holding('wand-of-unweaving', { content });
    const out = resolveSpell(
      fold('seed', log),
      WIELDER,
      { spellId: 'dispel-magic', targets: [VICTIM], item: 'wand-of-unweaving' },
      supply('unweave', -40, content),
    );
    expect(isErr(out) && out.code).toBe('no_spellcasting_ability');
    expect(chargesLeft(fold('seed', log), content, WIELDER, 'wand-of-unweaving')).toBe(3);
  });
});

/**
 * A per-day property is a pool of one, and nothing else about it is special.
 *
 * SRD Cape of the Mountebank prints no charge count at all — "This property
 * can't be used again until the next dawn" — which is the same economy with
 * every number set to one. It is also the only casting item in the catalogue
 * with no attunement bracket, so it is the one a creature of any sort can pick
 * up and use.
 */
describe('a per-day item is the same mechanism with one charge', () => {
  it('casts once, and refuses the second time', () => {
    const log = holding(CAPE);
    const first = unwrap(
      resolveSpell(
        fold('seed', log),
        WIELDER,
        {
          spellId: 'dimension-door',
          targets: [WIELDER],
          item: CAPE,
          teleportTo: { from: { landmark: 'there' }, feet: 0 },
        },
        supply('cape'),
      ),
      'the cape casting Dimension Door',
    );
    expect(castOf(first.events)?.slotless).toBe('magic-item');
    expect(left([...log, ...first.events], CAPE)).toBe(0);

    const again = resolveSpell(
      fold('seed', [...log, ...first.events]),
      WIELDER,
      {
        spellId: 'dimension-door',
        targets: [WIELDER],
        item: CAPE,
        teleportTo: { from: { landmark: 'here' }, feet: 0 },
      },
      supply('cape-again'),
    );
    expect(isErr(again) && again.code).toBe('exhausted');
  });
});

/**
 * Two castings from one wand are two commands, and a command id that stands
 * for one of them may not stand for the other.
 *
 * The fingerprint is the *request*, so the item and the charge count are part
 * of it by construction — but "by construction" is exactly the kind of claim
 * that stops being true when somebody normalises a field out of the identity,
 * as `anchoring` already is. Two castings that differ only in the charge count
 * are a level 3 Fireball and a level 5 one.
 */
describe('a command id stands for one casting from one item', () => {
  const fireball = (charges: number, item = WAND) => ({
    spellId: 'fireball',
    targets: [] as readonly CharacterId[],
    at: THERE,
    item,
    charges,
    commandId: 'one-wave',
  });

  it('is a no-op on an honest retry', () => {
    const log = holding(WAND, { spellcasting: WIZARDLY });
    const first = unwrap(
      resolveSpell(fold('seed', log), WIELDER, fireball(2), supply('retry')),
      'the first casting',
    );
    const after = [...log, ...first.events];

    const retry = unwrap(
      resolveSpell(fold('seed', after), WIELDER, fireball(2), supply('retry')),
      'the retry',
    );
    expect(retry.events).toEqual([]);
    expect(retry.castingId).toBe(first.castingId);
    expect(left(after, WAND)).toBe(5);
  });

  it('refuses the same id for a different charge count', () => {
    const log = holding(WAND, { spellcasting: WIZARDLY });
    const first = unwrap(
      resolveSpell(fold('seed', log), WIELDER, fireball(1), supply('one')),
      'the first casting',
    );
    const out = resolveSpell(
      fold('seed', [...log, ...first.events]),
      WIELDER,
      fireball(3),
      supply('two'),
    );
    expect(isErr(out) && out.code).toBe('command_id_reused');
  });

  it('refuses the same id for a different item', () => {
    const log = awarded(holding(WAND, { spellcasting: WIZARDLY }), STAFF);
    const armed = [
      ...run(log, (s) => equipItem(s, SRD_CONTENT, WIELDER, STAFF)),
      { type: 'attuned', id: WIELDER, item: STAFF } as GameEvent,
    ];
    const first = unwrap(
      resolveSpell(fold('seed', armed), WIELDER, fireball(3), supply('wand')),
      'the wand casting',
    );
    const out = resolveSpell(
      fold('seed', [...armed, ...first.events]),
      WIELDER,
      fireball(3, STAFF),
      supply('staff'),
    );
    expect(isErr(out) && out.code).toBe('command_id_reused');
  });
});
