import { SPELL_DEFINITIONS, SRD_CONTENT } from '@ie/content';
import { describe, expect, it } from 'vitest';
import {
  asCharacterId,
  expect as unwrap,
  isErr,
  isNeedsContext,
  type CharacterId,
} from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { spellSlotKey } from './resources.js';
import { declaredCasting } from './spellcasting.js';
import { checkSpellDefinitionValue } from './spell-schema.js';
import { hasCondition } from './conditions.js';
import { obscurementAt, terrainAt, type Point } from './positioning.js';
import { extendContent } from './content.js';
import type { SpellDefinition } from './spell-definitions.js';
import {
  advanceTime,
  declareEnding,
  pendingCastingsOf,
  resolveDeclaredCast,
  resolveSpell,
  settleAreaEffects,
  triggerGlyph,
} from './commands.js';

/**
 * The table's word that a printed cause happened.
 *
 * > SRD Web: "If the webs aren't anchored between two solid masses (such as
 * > walls or trees) or layered across a floor, wall, or ceiling, the web
 * > collapses on itself, and the spell ends at the start of your next turn."
 * > SRD Suggestion: "if the suggested activity can be completed in a shorter
 * > time, the spell ends for the target upon completing it."
 * > SRD Glyph of Warding: "If the surface or object is moved more than 10 feet
 * > from where you cast this spell, the glyph is broken, and the spell ends
 * > without being triggered."
 *
 * Three facts only the room holds — what a web is strung between, whether an
 * errand is done, how far a chest was carried — and three endings the engine
 * owes once somebody says so. The phrase is the spell's, pinned on its record;
 * a phrase the record does not print is refused, so the word cannot end a
 * casting the book never said it ends.
 */

const id = (s: string) => asCharacterId(s);
const WEAVER = id('weaver');
const GOBLIN = id('goblin');
const BARD = id('bard');
const OGRE = id('ogre');
const TROLL = id('troll');
const WIZARD = id('wizard');

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 5,
  abilities: { str: 10, dex: 10, con: 10, int: 18, wis: 10, cha: 18 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'int',
  ...over,
});

/** A Wisdom and a Dexterity nobody saves with. */
const DOOMED: Partial<CharacterSheet> = {
  abilities: { str: 10, dex: 1, con: 10, int: 10, wis: 1, cha: 10 },
};

const added = (who: CharacterId, side: string, over: Partial<CharacterSheet> = {}): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(over),
  maxHp: 40,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side,
});

const casts = (who: CharacterId, prepared: readonly string[], levels: readonly number[]): readonly GameEvent[] => [
  {
    type: 'spellcasting-declared',
    id: who,
    spellcasting: declaredCasting({ ability: 'int', prepared: [...prepared] }),
  },
  ...levels.map(
    (level): GameEvent => ({
      type: 'resource-pool-declared',
      id: who,
      pool: { key: spellSlotKey(level), label: `level ${level}`, max: 3, recovers: 'long-rest' },
    }),
  ),
];

const ROOM: readonly GameEvent[] = [
  added(WEAVER, 'party'),
  added(BARD, 'party'),
  added(WIZARD, 'party'),
  added(GOBLIN, 'foes', DOOMED),
  added(OGRE, 'foes', DOOMED),
  added(TROLL, 'foes', DOOMED),
  ...casts(WEAVER, ['web'], [2]),
  ...casts(BARD, ['suggestion', 'twin-suggestion'], [2]),
  ...casts(WIZARD, ['glyph-of-warding'], [3]),
  { type: 'scene-set', extent: { width: 300, depth: 300, height: 40 } },
  { type: 'landmark-added', name: 'the loom', at: { x: 100, y: 100, z: 0 } },
  { type: 'landmark-added', name: 'the web', at: { x: 130, y: 100, z: 0 } },
  { type: 'creature-placed', id: WEAVER, placement: { from: { landmark: 'the loom' }, feet: 0 } },
  { type: 'creature-placed', id: GOBLIN, placement: { from: { landmark: 'the web' }, feet: 0 } },
  { type: 'creature-placed', id: BARD, placement: { from: { landmark: 'the loom' }, feet: 10, bearing: 0 } },
  { type: 'creature-placed', id: WIZARD, placement: { from: { landmark: 'the loom' }, feet: 10, bearing: 180 } },
  { type: 'creature-placed', id: OGRE, placement: { from: { creature: BARD }, feet: 20, bearing: 0 } },
  { type: 'creature-placed', id: TROLL, placement: { from: { creature: BARD }, feet: 20, bearing: 270 } },
  { type: 'sight-declared', from: BARD, to: OGRE, seen: true },
  { type: 'sight-declared', from: BARD, to: TROLL, seen: true },
];

/** SRD Suggestion for two, so one target can finish its errand and the other not. */
const TWIN_SUGGESTION: SpellDefinition = {
  ...SRD_CONTENT.spell('suggestion')!,
  id: 'twin-suggestion',
  name: 'Twin Suggestion',
  targets: { count: 2 },
};
const CONTENT = unwrap(extendContent(SRD_CONTENT, { spells: [TWIN_SUGGESTION] }), 'the homebrew');

const supply = (seed = 'word', flat?: number) => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: CONTENT,
  ...(flat === undefined ? {} : { bonuses: [{ source: 'the fixture', flat }] }),
});

const state = (log: readonly GameEvent[]): GameState => fold('seed', log);

const WEB_AT: Point = { x: 120, y: 100, z: 0 };
const WEB_TOWARDS: Point = { x: 140, y: 100, z: 0 };
const IN_THE_WEB: Point = { x: 130, y: 100, z: 0 };

const COMBAT: GameEvent = {
  type: 'combat-started',
  combatants: [
    { id: WEAVER, initiative: 20, speed: 30 },
    { id: GOBLIN, initiative: 10, speed: 30 },
  ],
};

/** The web spun in the fight, and the goblin's turn begun inside it, Restrained. */
const webbed = () => {
  const start = [...ROOM, COMBAT];
  const spun = unwrap(
    resolveSpell(
      state(start),
      WEAVER,
      { spellId: 'web', targets: [], at: WEB_AT, towards: WEB_TOWARDS, slotLevel: 2 },
      supply(),
    ),
    'the web',
  );
  const round = [...start, ...spun.events, { type: 'turn-advanced' } as GameEvent];
  const caught = unwrap(settleAreaEffects(state(round), supply('stuck', -40)), 'the goblin’s start');
  const log = [...round, ...caught.events];
  return { log, castingId: spun.castingId! };
};

describe('the definitions print the table’s word', () => {
  const definition = (spellId: string) => SPELL_DEFINITIONS.find((one) => one.id === spellId)!;

  it('writes the three phrases the book prints', () => {
    expect(definition('web').endsEarly).toEqual([
      {
        on: 'the-table-declares',
        what: 'the webs are not anchored',
        ends: 'casting',
        at: 'start-of-casters-next-turn',
      },
    ]);
    expect(definition('suggestion').endsEarly).toContainEqual({
      on: 'the-table-declares',
      what: 'the suggested activity is complete',
      ends: 'target',
    });
    expect(definition('glyph-of-warding').endsEarly).toEqual([
      {
        on: 'the-table-declares',
        what: 'the surface or object is moved more than 10 feet',
        ends: 'casting',
      },
    ]);
  });

  it('refuses a phrase on another cause, a deferral anywhere else, and the cause without its phrase', () => {
    const web = definition('web');
    const codes = (endsEarly: unknown): readonly string[] =>
      checkSpellDefinitionValue({ ...web, endsEarly }).map((one) => one.code);

    expect(codes([{ on: 'target-attacks', ends: 'casting', what: 'it swung' }])).toContain(
      'bad_end_trigger_what',
    );
    expect(codes([{ on: 'the-table-declares', ends: 'casting' }])).toContain('bad_end_trigger_what');
    expect(codes([{ on: 'the-table-declares', ends: 'casting', what: '  ' }])).toContain(
      'bad_end_trigger_what',
    );
    expect(
      codes([{ on: 'target-attacks', ends: 'casting', at: 'start-of-casters-next-turn' }]),
    ).toContain('bad_end_trigger_at');
    expect(
      codes([{ on: 'the-table-declares', ends: 'casting', what: 'x', at: 'end-of-next-turn' }]),
    ).toContain('bad_end_trigger_at');
    // A deferral moves the casting's own deadline, so it cannot end one target.
    expect(
      codes([{ on: 'the-table-declares', ends: 'target', what: 'x', at: 'start-of-casters-next-turn' }]),
    ).toContain('bad_end_trigger_at');
    expect(checkSpellDefinitionValue(web)).toEqual([]);
  });
});

describe('Web: the webs are not anchored', () => {
  it('runs until the start of the caster’s next turn, and then its terrain, fog and Restrained go', () => {
    const { log, castingId } = webbed();
    const before = state(log);
    expect(hasCondition(before.creatures[GOBLIN]!.conditions, 'restrained')).toBe(true);

    const said = unwrap(
      declareEnding(before, castingId, { what: 'the webs are not anchored' }),
      'the table’s word',
    );
    expect(said.map((event) => event.type)).toEqual(['effect-scheduled']);
    const collapsing = state([...log, ...said]);
    // Still standing for the rest of the goblin's turn.
    expect(collapsing.ongoing[castingId]).toBeDefined();
    expect(hasCondition(collapsing.creatures[GOBLIN]!.conditions, 'restrained')).toBe(true);
    expect(obscurementAt(collapsing, IN_THE_WEB).degree).toBe('lightly');

    const next = state([...log, ...said, { type: 'turn-advanced' }]);
    expect(next.ongoing[castingId]).toBeUndefined();
    expect(hasCondition(next.creatures[GOBLIN]!.conditions, 'restrained')).toBe(false);
    expect(terrainAt(next, IN_THE_WEB).patches).toEqual([]);
    expect(obscurementAt(next, IN_THE_WEB).degree).toBeNull();
  });

  it('asks for a fight when there is no turn for the collapse to wait on', () => {
    const spun = unwrap(
      resolveSpell(
        state(ROOM),
        WEAVER,
        { spellId: 'web', targets: [], at: WEB_AT, towards: WEB_TOWARDS, slotLevel: 2 },
        supply(),
      ),
      'the web',
    );
    const out = declareEnding(state([...ROOM, ...spun.events]), spun.castingId!, {
      what: 'the webs are not anchored',
    });
    expect(isNeedsContext(out)).toBe(true);
  });

  it('refuses a phrase the spell does not print', () => {
    const { log, castingId } = webbed();
    const out = declareEnding(state(log), castingId, { what: 'the webs are on fire' });
    expect(isErr(out) && out.code).toBe('not_its_cause');
  });
});

describe('Suggestion: the suggested activity is complete', () => {
  const suggested = () => {
    const out = unwrap(
      resolveSpell(
        state(ROOM),
        BARD,
        { spellId: 'twin-suggestion', targets: [OGRE, TROLL], slotLevel: 2 },
        supply(),
      ),
      'the suggestion',
    );
    return { log: [...ROOM, ...out.events], castingId: out.castingId! };
  };

  it('ends it on the target that finished, and the other stays Charmed', () => {
    const { log, castingId } = suggested();
    const before = state(log);
    expect(hasCondition(before.creatures[OGRE]!.conditions, 'charmed')).toBe(true);
    expect(hasCondition(before.creatures[TROLL]!.conditions, 'charmed')).toBe(true);

    const said = unwrap(
      declareEnding(before, castingId, { what: 'the suggested activity is complete', on: OGRE }),
      'the ogre fetched the key',
    );
    expect(said).toEqual([{ type: 'spell-ended', castingId, on: OGRE, reason: 'spent' }]);
    const after = state([...log, ...said]);
    expect(hasCondition(after.creatures[OGRE]!.conditions, 'charmed')).toBe(false);
    expect(hasCondition(after.creatures[TROLL]!.conditions, 'charmed')).toBe(true);
    expect(after.ongoing[castingId]).toBeDefined();
  });

  it('ends SRD Suggestion itself on the ogre that finished its errand', () => {
    const cast = unwrap(
      resolveSpell(state(ROOM), BARD, { spellId: 'suggestion', targets: [OGRE], slotLevel: 2 }, supply()),
      'Suggestion',
    );
    const log = [...ROOM, ...cast.events];
    expect(hasCondition(state(log).creatures[OGRE]!.conditions, 'charmed')).toBe(true);
    const said = unwrap(
      declareEnding(state(log), cast.castingId!, { what: 'the suggested activity is complete', on: OGRE }),
      'the ogre fetched the key',
    );
    const after = state([...log, ...said]);
    expect(hasCondition(after.creatures[OGRE]!.conditions, 'charmed')).toBe(false);
  });

  it('asks which creature finished, and refuses one the casting is not on', () => {
    const { log, castingId } = suggested();
    const nobody = declareEnding(state(log), castingId, { what: 'the suggested activity is complete' });
    expect(isErr(nobody) && nobody.code).toBe('ending_names_a_creature');
    const stranger = declareEnding(state(log), castingId, {
      what: 'the suggested activity is complete',
      on: GOBLIN,
    });
    expect(isErr(stranger) && stranger.code).toBe('no_effect_there');
  });

  it('refuses a creature on an ending that is the whole casting’s', () => {
    const { log, castingId } = webbed();
    const out = declareEnding(state(log), castingId, { what: 'the webs are not anchored', on: GOBLIN });
    expect(isErr(out) && out.code).toBe('ending_names_no_creature');
  });
});

describe('Glyph of Warding: the surface is moved', () => {
  const inscribed = () => {
    const declared = unwrap(
      resolveSpell(
        state(ROOM),
        WIZARD,
        {
          spellId: 'glyph-of-warding',
          targets: [],
          at: { x: 100, y: 95, z: 0 },
          slotLevel: 3,
          damageType: 'fire',
        },
        supply('ink'),
      ),
      'the glyph declared',
    );
    let log: GameEvent[] = [...ROOM, ...declared.events];
    const castingId = pendingCastingsOf(state(log))[0]!.castingId;
    log = [...log, ...unwrap(advanceTime(state(log), 3600, 'the hour'), 'the hour')];
    log = [...log, ...unwrap(resolveDeclaredCast(state(log), castingId, supply('settle')), 'inscribed').events];
    return { log, castingId };
  };

  it('ends the casting, and the DM can no longer fire the rune', () => {
    const { log, castingId } = inscribed();
    expect(state(log).ongoing[castingId]).toBeDefined();

    const said = unwrap(
      declareEnding(state(log), castingId, { what: 'the surface or object is moved more than 10 feet' }),
      'the chest carried off',
    );
    const after = [...log, ...said];
    expect(state(after).ongoing[castingId]).toBeUndefined();

    const fired = triggerGlyph(state(after), { castingId }, supply('boom'));
    expect(isErr(fired) && fired.code).toBe('not_ongoing');
  });

  it('refuses a casting that is not running', () => {
    const out = declareEnding(state(ROOM), 'cast:99', { what: 'the surface or object is moved more than 10 feet' });
    expect(isErr(out) && out.code).toBe('not_ongoing');
  });
});
