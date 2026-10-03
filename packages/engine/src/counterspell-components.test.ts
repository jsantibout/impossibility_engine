import { SRD_CONTENT } from '@ie/content';
import { describe, expect, it } from 'vitest';
import { asCharacterId, isErr, expect as unwrap, type CharacterId, type Result } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import {
  addCreature,
  awardItems,
  beginCombat,
  castPrintedLine,
  declareCreatureSide,
  declareSightBetween,
  equipItem,
  placeCreatureInScene,
  reactionOpportunities,
  resolveSpell,
  setScene,
} from './commands.js';
import { createRng, type Rng } from './dice.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { adaptMonster } from './monster.js';
import { createRollIssuer } from './rolls.js';
import { declaredCasting } from './spellcasting.js';

/**
 * SRD Counterspell: "**Casting Time:** Reaction, which you take when you see a
 * creature within 60 feet of yourself casting a spell with Verbal, Somatic, or
 * Material components."
 *
 * The qualifier was never checked, because every SRD spell prints a component.
 * **A casting may still have none**: seventeen stat blocks cast "requiring no
 * spell components" — a Dust Mephit's Sleep, an Imp's Invisibility, a Giant
 * Owl's Clairvoyance — and SRD "Spells Cast from Items" says a spell cast from
 * an item "requires no components unless the item's description notes
 * otherwise". The parser now carries the clause (`waives`), the route a casting
 * goes through says what it waives, and a casting with nothing left to see or
 * hear is pinned `componentless` on the record the window reads. A line that
 * waives only the Material component — a Drider's Darkness — still opens it.
 */

const id = (s: string): CharacterId => asCharacterId(s);
const WIZARD = id('wizard');
const CASTER = id('caster');

const supply = (state: GameState, seed = 'counter') => ({
  issuer: createRollIssuer('r', state.rollsIssued),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

const sheet = (): CharacterSheet => ({
  level: 5,
  abilities: { str: 10, dex: 14, con: 12, int: 18, wis: 12, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'int',
  weaponProficiencies: ['simple'],
});

/** A room, a wizard holding Counterspell, and a caster of the given block twenty feet off. */
function room(block: string, quiet = false): GameEvent[] {
  const log: GameEvent[] = [];
  const step = (produce: (state: GameState) => Result<readonly GameEvent[] | { readonly events: readonly GameEvent[] }>) => {
    const out = unwrap(produce(fold('counter', log)), 'step');
    log.push(...('events' in out ? out.events : out));
  };
  log.push(
    {
      type: 'creature-added',
      id: WIZARD,
      name: WIZARD,
      sheet: sheet(),
      maxHp: 40,
      diesAtZero: false,
      creatureType: 'Humanoid',
      side: 'party',
    },
    {
      type: 'spellcasting-declared',
      id: WIZARD,
      spellcasting: declaredCasting({ ability: 'int', classId: 'wizard', prepared: ['counterspell'] }),
    },
    {
      type: 'resource-pool-declared',
      id: WIZARD,
      pool: { key: 'spell-slot:3', label: 'level 3', max: 2, recovers: 'long-rest' },
    },
  );
  step((s) => addCreature(s, SRD_CONTENT, CASTER, block));
  step((s) => setScene(s, { width: 200, depth: 200, height: 40 }));
  log.push({ type: 'landmark-added', name: 'the hall', at: { x: 100, y: 100, z: 0 } });
  step((s) => placeCreatureInScene(s, WIZARD, { from: { landmark: 'the hall' }, feet: 0 }));
  step((s) => placeCreatureInScene(s, CASTER, { from: { creature: WIZARD }, feet: 20, bearing: 0 }));
  step((s) => declareCreatureSide(s, CASTER, 'foes'));
  step((s) => declareSightBetween(s, WIZARD, CASTER, true));
  step((s) => declareSightBetween(s, CASTER, WIZARD, true));
  // And, where asked, an SRD Silence laid over the caster before the fight:
  // "no sound can be created within or pass through" the Sphere.
  if (quiet) {
    log.push(
      {
        type: 'spellcasting-declared',
        id: WIZARD,
        spellcasting: declaredCasting({
          ability: 'int',
          classId: 'wizard',
          prepared: ['counterspell', 'silence'],
        }),
      },
      {
        type: 'resource-pool-declared',
        id: WIZARD,
        pool: { key: 'spell-slot:2', label: 'level 2', max: 2, recovers: 'long-rest' },
      },
    );
    step((s) =>
      resolveSpell(
        s,
        WIZARD,
        { spellId: 'silence', targets: [], at: { x: 100, y: 120, z: 0 }, slotLevel: 2 } as never,
        supply(s),
      ),
    );
  }
  step((s) =>
    beginCombat(s, [
      { id: CASTER, initiative: 20, speed: 30 },
      { id: WIZARD, initiative: 10, speed: 30 },
    ]),
  );
  return log;
}

/** The caster takes the block's line, held open, and the state it leaves. */
function heldLine(
  block: string,
  line: string,
  spell: string,
  casting: Record<string, unknown>,
  quiet = false,
) {
  const log = room(block, quiet);
  const out = unwrap(
    castPrintedLine(
      fold('counter', log),
      CASTER,
      { line, spell, casting: { ...casting, hold: true } as never },
      supply(fold('counter', log)),
    ),
    line,
  );
  return { log: [...log, ...out.events], castingId: out.castingId! };
}

const counterspellOffered = (state: GameState): boolean =>
  reactionOpportunities(state, SRD_CONTENT).some(
    (chance) => chance.reactor === WIZARD && chance.id === 'counterspell',
  );

const counter = (log: readonly GameEvent[]) =>
  resolveSpell(
    fold('counter', log),
    WIZARD,
    { spellId: 'counterspell', targets: [CASTER], slotLevel: 3 },
    supply(fold('counter', log)),
  );

describe('the components a line waives reach the route', () => {
  it('carries the clause onto every route the line opens', () => {
    const mephit = adaptMonster(SRD_CONTENT.monsterById('dust-mephit')!, CASTER);
    expect(mephit.spellcasting!.granted[0]!.waives).toEqual(['material', 'somatic', 'verbal']);
    const drider = adaptMonster(SRD_CONTENT.monsterById('drider')!, CASTER);
    expect(
      drider.spellcasting!.granted.filter((grant) => grant.spellId === 'darkness')[0]!.waives,
    ).toEqual(['material']);
    // A Spellcasting line's own list, as well as a cast line's.
    const couatl = adaptMonster(SRD_CONTENT.monsterById('couatl')!, CASTER);
    expect(
      couatl.spellcasting!.granted.find((grant) => grant.spellId === 'detect-magic')!.waives,
    ).toEqual(['material', 'somatic', 'verbal']);
  });
});

describe('SRD Counterspell sees only a casting with components', () => {
  const MEPHIT_SLEEP = SRD_CONTENT.monsterById('dust-mephit')!.actions.find(
    (line) => line.casts !== undefined,
  )!.name;
  const DRIDER_MAGIC = SRD_CONTENT.monsterById('drider')!.bonusActions.find(
    (line) => line.casts !== undefined,
  )!.name;

  it('opens no window on a Dust Mephit’s Sleep, cast requiring no spell components', () => {
    const { log, castingId } = heldLine('dust-mephit', MEPHIT_SLEEP, 'sleep', {
      at: { x: 100, y: 100, z: 0 },
      targets: [WIZARD],
    });
    const state = fold('counter', log);
    expect(state.pendingCastings[castingId]?.componentless).toBe(true);
    expect(counterspellOffered(state)).toBe(false);
    const refused = counter(log);
    expect(isErr(refused) && refused.code).toBe('no_trigger');
  });

  it('opens it on a Drider’s Darkness, which waives the Material component and nothing else', () => {
    const { log, castingId } = heldLine('drider', DRIDER_MAGIC, 'darkness', {
      at: { x: 100, y: 110, z: 0 },
    });
    const state = fold('counter', log);
    expect(state.pendingCastings[castingId]?.componentless).toBeUndefined();
    expect(counterspellOffered(state)).toBe(true);
    expect(isErr(counter(log))).toBe(false);
  });

  it('opens no window on a spell cast from an item, which requires no components', () => {
    const log = room('commoner');
    const awarded = [
      ...log,
      ...unwrap(
        awardItems(fold('counter', log), supply(fold('counter', log)), CASTER, [{ id: 'wand-of-fireballs' }], 'the hoard'),
        'award',
      ),
    ];
    const worn = [
      ...awarded,
      ...unwrap(equipItem(fold('counter', awarded), SRD_CONTENT, CASTER, 'wand-of-fireballs'), 'equip'),
      { type: 'attuned', id: CASTER, item: 'wand-of-fireballs' } as GameEvent,
    ];
    const declared = unwrap(
      resolveSpell(
        fold('counter', worn),
        CASTER,
        {
          spellId: 'fireball',
          targets: [],
          at: { x: 100, y: 160, z: 0 },
          item: 'wand-of-fireballs',
          hold: true,
        } as never,
        supply(fold('counter', worn)),
      ),
      'fireball from the wand',
    );
    const state = fold('counter', [...worn, ...declared.events]);
    expect(state.pendingCastings[declared.castingId!]?.componentless).toBe(true);
    expect(counterspellOffered(state)).toBe(false);
  });
});

/**
 * SRD Silence: a creature in the Sphere cannot cast a spell with a Verbal
 * component. The road that waives every component waives that one too (E-L1),
 * so a Dust Mephit's Sleep is cast in the silence; a Drider's Darkness waives
 * only its Material component, and its Verbal one is still stopped.
 */
describe('SRD Silence reads what the road waives', () => {
  const MEPHIT_SLEEP = SRD_CONTENT.monsterById('dust-mephit')!.actions.find(
    (line) => line.casts !== undefined,
  )!.name;
  const DRIDER_MAGIC = SRD_CONTENT.monsterById('drider')!.bonusActions.find(
    (line) => line.casts !== undefined,
  )!.name;

  it('lets a casting with no Verbal component left be made in the Sphere', () => {
    const { log, castingId } = heldLine(
      'dust-mephit',
      MEPHIT_SLEEP,
      'sleep',
      { at: { x: 100, y: 100, z: 0 }, targets: [WIZARD] },
      true,
    );
    expect(fold('counter', log).pendingCastings[castingId]).toBeDefined();
  });

  it('stops one whose Verbal component the line does not waive', () => {
    const log = room('drider', true);
    const refused = castPrintedLine(
      fold('counter', log),
      CASTER,
      { line: DRIDER_MAGIC, spell: 'darkness', casting: { at: { x: 100, y: 110, z: 0 } } as never },
      supply(fold('counter', log)),
    );
    expect(isErr(refused) && refused.code).toBe('silenced');
  });
});
