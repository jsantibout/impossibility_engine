import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, isErr, expect as unwrap, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng } from './dice.js';
import { fold, type GameEvent } from './events.js';
import { spellSlotKey } from './resources.js';
import { createRollIssuer } from './rolls.js';
import { declaredCasting } from './spellcasting.js';
import { declareFalling, reactionOpportunities, resolveSpell } from './commands.js';

/**
 * SRD Feather Fall's casting time: "Reaction, which you take when **you or a
 * creature you can see within 60 feet of you** falls."
 *
 * The window opened on anybody's declared fall and asked nothing about who was
 * looking, so a mage could catch a climber they had declared they could not
 * see. The trigger is now read as it is printed: the caster's own fall, or a
 * fall the caster sees within sixty feet. Sight is the declared fact `canSee`
 * answers everywhere else, so a fall nobody has said the caster can see is a
 * fact to establish rather than a refusal.
 *
 * And the minute: the owner's ruling of 2026-09-27 is that the spell "reads
 * only whether the landing falls inside the spell's minute", which the ward
 * already does, so the printed rate of descent is the table's.
 */

const id = (s: string) => asCharacterId(s);
const MAGE = id('mage');
const CLIMBER = id('climber');
const FAR = id('far climber');

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 5,
  abilities: { str: 14, dex: 10, con: 14, int: 16, wis: 12, cha: 10 },
  skills: {},
  saveProficiencies: ['con'],
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
  maxHp: 40,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side: 'party',
});

/** A mage, a climber thirty feet off and another ninety feet off; nobody has said who sees whom. */
const ROOM: readonly GameEvent[] = [
  added(MAGE),
  added(CLIMBER),
  added(FAR),
  {
    type: 'resource-pool-declared',
    id: MAGE,
    pool: { key: spellSlotKey(1), label: 'level 1 spell slot', max: 3, recovers: 'long-rest' },
  },
  {
    type: 'spellcasting-declared',
    id: MAGE,
    spellcasting: declaredCasting({ ability: 'int', prepared: ['feather-fall'] }),
  },
  { type: 'scene-set', extent: { width: 300, depth: 300, height: 200 } },
  { type: 'creature-placed', id: MAGE, placement: { from: { sceneCenter: true }, feet: 0 } },
  { type: 'creature-placed', id: CLIMBER, placement: { from: { creature: MAGE }, feet: 30, bearing: 0 } },
  { type: 'creature-placed', id: FAR, placement: { from: { creature: MAGE }, feet: 90, bearing: 180 } },
];

const seen = (to: CharacterId, yes: boolean): GameEvent => ({
  type: 'sight-declared',
  from: MAGE,
  to,
  seen: yes,
});

const supply = () => ({
  issuer: createRollIssuer('r'),
  rng: createRng('feather'),
  content: SRD_CONTENT,
});

const falls = (log: readonly GameEvent[], who: CharacterId): readonly GameEvent[] => [
  ...log,
  ...unwrap(declareFalling(fold('s', log), who), 'a fall'),
];

const cast = (log: readonly GameEvent[], targets: readonly CharacterId[]) =>
  resolveSpell(fold('s', log), MAGE, { spellId: 'feather-fall', targets: [...targets], slotLevel: 1 }, supply());

const offers = (log: readonly GameEvent[]) =>
  reactionOpportunities(fold('s', log), SRD_CONTENT)
    .filter((chance) => chance.id === 'feather-fall')
    .map((chance) => chance.against);

describe('Feather Fall answers a fall its caster can see', () => {
  it('is refused for a fall the caster has been declared not to see, and spends nothing', () => {
    const log = falls([...ROOM, seen(CLIMBER, false)], CLIMBER);
    const refused = cast(log, [CLIMBER]);
    expect(isErr(refused)).toBe(true);
    if (isErr(refused)) {
      expect(refused.kind).toBe('refusal');
      expect(refused.code).toBe('no_trigger');
    }
    expect(fold('s', log).creatures[MAGE]?.resources.pools[spellSlotKey(1)]?.spent).toBe(0);
  });

  it('asks whether the caster can see a fall nobody has said anything about', () => {
    const asked = cast(falls(ROOM, CLIMBER), [CLIMBER]);
    expect(isErr(asked)).toBe(true);
    if (isErr(asked)) {
      expect(asked.kind).toBe('needs-context');
      expect(asked.code).toBe('falling_unseen');
      expect(asked.requests?.map((request) => [request.kind, request.subject])).toEqual([
        ['visibility', CLIMBER],
      ]);
    }
  });

  it('casts on a fall the caster sees', () => {
    expect(cast(falls([...ROOM, seen(CLIMBER, true)], CLIMBER), [CLIMBER]).ok).toBe(true);
  });

  it('casts on the caster’s own fall, which nobody has to see', () => {
    expect(cast(falls(ROOM, MAGE), [MAGE]).ok).toBe(true);
  });

  /**
   * "a creature you can see **within 60 feet of you**": a fall seen ninety feet
   * off opens nothing, so it cannot carry an unseen fall beside the caster.
   */
  it('is not opened by a fall the caster sees beyond sixty feet', () => {
    const log = falls(falls([...ROOM, seen(FAR, true), seen(CLIMBER, false)], FAR), CLIMBER);
    const refused = cast(log, [CLIMBER]);
    expect(isErr(refused)).toBe(true);
    if (isErr(refused)) expect(refused.code).toBe('no_trigger');
  });

  /**
   * The trigger and the targets are two questions: one fall the caster sees
   * opens the window, and the spell's own sentence — "Choose up to five falling
   * creatures within range" — asks nothing about sight of the others.
   */
  it('takes an unseen faller once a seen fall has opened the window', () => {
    const near = id('near climber');
    const log = falls(
      falls(
        [
          ...ROOM,
          added(near),
          { type: 'creature-placed', id: near, placement: { from: { creature: MAGE }, feet: 20, bearing: 90 } },
          seen(CLIMBER, true),
          seen(near, false),
        ],
        CLIMBER,
      ),
      near,
    );
    expect(cast(log, [near]).ok).toBe(true);
  });

  it('offers the window only against a fall the caster could be answering', () => {
    expect(offers(falls([...ROOM, seen(CLIMBER, false)], CLIMBER))).toEqual([]);
    expect(offers(falls([...ROOM, seen(CLIMBER, true)], CLIMBER))).toEqual([CLIMBER]);
    expect(offers(falls([...ROOM, seen(FAR, true)], FAR))).toEqual([]);
    // Undeclared sight is homework rather than a refusal, so the offer stands
    // and the casting asks.
    expect(offers(falls(ROOM, CLIMBER))).toEqual([CLIMBER]);
  });
});
