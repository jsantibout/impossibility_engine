import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap } from '@ie/shared';
import {
  checkCharacter,
  createCharacter,
  createRng,
  createRollIssuer,
  fold,
  pactSlotKey,
  remaining,
  resolveSpell,
  type CharacterChoices,
  type GameEvent,
  type Rng,
} from '@ie/engine';

/**
 * SRD Pact of the Chain, the first of the two Pacts:
 *
 * > "You learn the _Find Familiar_ spell and can cast it as a Magic action
 * > without expending a spell slot. When you cast the spell, you choose one of
 * > the normal forms for your familiar or one of the following special forms:
 * > **Imp, Pseudodragon, Quasit, Skeleton, Sphinx of Wonder, Sprite,** or
 * > **Venomous Snake**."
 *
 * Two sentences and two primitives, both about the **route** rather than about
 * the spell: a Wizard who prepared Find Familiar still takes the hour and is
 * still offered only the Beasts. `GrantedSpell.castingTime` is the first and
 * `GrantedSpell.widensForm` is the second.
 *
 * The SRD 5.2.1 text prints **seven** special forms. A Slaad Tadpole appears in
 * other printings of this invocation and is not in this one, and there is no
 * `slaad-tadpole` in this bestiary; the seven below are each a stat block the
 * SRD publishes.
 */

const WHO = asCharacterId('kael');
const FIEND = 'warlock:eldritch-invocations';

/** The seven the sentence prints, in the order it prints them. */
const SPECIAL_FORMS = [
  'imp',
  'pseudodragon',
  'quasit',
  'skeleton',
  'sphinx-of-wonder',
  'sprite',
  'venomous-snake',
] as const;

const base = (over: Partial<CharacterChoices> = {}): CharacterChoices => ({
  name: 'Kael',
  classId: 'warlock',
  level: 5,
  speciesId: 'human',
  backgroundId: 'sage',
  abilities: {
    method: 'standard-array',
    assignment: { str: 8, dex: 14, con: 13, int: 12, wis: 10, cha: 15 },
  },
  abilityIncreases: { con: 2, int: 1 },
  classSkills: ['arcana', 'deception'],
  languages: ['Draconic', 'Goblin'],
  alignment: 'Neutral Evil',
  subclassId: 'fiend-patron',
  cantrips: ['eldritch-blast', 'chill-touch', 'poison-spray'],
  spellbook: [],
  preparedSpells: ['hex', 'charm-person', 'hold-person', 'hypnotic-pattern', 'mind-spike', 'fear'],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: ['leather-armor'],
  hitPoints: { method: 'fixed' },
  featureChoices: { 'human:skillful': ['perception'] },
  feats: {
    // **Not** Find Familiar through the feat: two routes to one spell is a
    // question `chooseRoute` refuses, and what is under test is the Pact's.
    'sage:magic-initiate-wizard': {
      featId: 'magic-initiate',
      spellList: 'wizard',
      spellcastingAbility: 'int',
      cantrips: ['fire-bolt', 'light'],
      levelOneSpell: 'magic-missile',
    },
    'human:versatile': { featId: 'alert' },
    'warlock:ability-score-improvement': { featId: 'savage-attacker' },
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
  ...over,
});

/** A Warlock 5 holding the Pact and four invocations that ask nothing. */
const chained = (over: Partial<CharacterChoices> = {}): CharacterChoices =>
  base({
    featureChoices: {
      'human:skillful': ['perception'],
      [FIEND]: [
        'Pact of the Chain',
        'Armor of Shadows',
        'Eldritch Mind',
        "Devil's Sight",
        'Fiendish Vigor',
      ],
    },
    ...over,
  });

/** The same Warlock without the Pact, for the half of every claim that is a contrast. */
const unchained = (): CharacterChoices =>
  base({
    featureChoices: {
      'human:skillful': ['perception'],
      [FIEND]: [
        'Misty Visions',
        'Armor of Shadows',
        'Eldritch Mind',
        "Devil's Sight",
        'Fiendish Vigor',
      ],
    },
  });

/**
 * The same Warlock who reaches Find Familiar through Magic Initiate rather
 * than through the Pact: the contrast that says both terms are the route's.
 */
const throughTheFeat = (): CharacterChoices =>
  base({
    featureChoices: {
      'human:skillful': ['perception'],
      [FIEND]: [
        'Misty Visions',
        'Armor of Shadows',
        'Eldritch Mind',
        "Devil's Sight",
        'Fiendish Vigor',
      ],
    },
    feats: {
      ...base().feats,
      'sage:magic-initiate-wizard': {
        featId: 'magic-initiate',
        spellList: 'wizard',
        spellcastingAbility: 'int',
        cantrips: ['fire-bolt', 'light'],
        levelOneSpell: 'find-familiar',
      },
    },
  });

const codes = (choices: CharacterChoices): readonly string[] =>
  checkCharacter(SRD_CONTENT, choices).map((problem) => problem.code);

const supply = (seed: string) => ({
  issuer: createRollIssuer(seed),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

/** The Warlock, a room to stand in, and a fight nobody else is in yet. */
const table = (choices: CharacterChoices): GameEvent[] => [
  ...(unwrap(createCharacter(SRD_CONTENT, choices, WHO), 'creation') as GameEvent[]),
  { type: 'scene-set', extent: { width: 400, depth: 400, height: 40 } },
  { type: 'landmark-added', name: 'the well', at: { x: 100, y: 100, z: 0 } },
  { type: 'creature-placed', id: WHO, placement: { from: { landmark: 'the well' }, feet: 0 } },
];

const castFamiliar = (
  log: readonly GameEvent[],
  form: string,
  seed = 'chain',
): ReturnType<typeof resolveSpell> =>
  resolveSpell(
    fold('seed', log),
    WHO,
    { spellId: 'find-familiar', targets: [WHO], form, choice: 'Fey' },
    supply(seed),
  );

describe('Pact of the Chain', () => {
  it('is an invocation a Warlock 1 may take, and prints no Prerequisite', () => {
    expect(codes(chained())).toEqual([]);
  });

  /**
   * "and can cast it **as a Magic action** without expending a spell slot."
   * Find Familiar prints an hour and the Ritual tag; the route prints an
   * Action, and the slot is not touched.
   */
  it('casts Find Familiar as a Magic action, with no slot spent', () => {
    const log = table(chained());
    const cast = unwrap(castFamiliar(log, 'imp'), 'find familiar');

    const spellCast = cast.events.find(
      (event): event is Extract<GameEvent, { type: 'spell-cast' }> => event.type === 'spell-cast',
    );
    expect(spellCast?.castingTime).toBe('action');
    expect(spellCast?.slot).toBeNull();

    const after = fold('seed', [...log, ...cast.events]);
    expect(remaining(after.creatures[WHO]!.resources, pactSlotKey(3))).toBe(2);
    // And no pending casting: an hour would have left one waiting on the clock.
    expect(Object.keys(after.pendingCastings)).toEqual([]);
  });

  /** "You learn the _Find Familiar_ spell" — and a Warlock who did not, has not. */
  it('is the whole of a Warlock’s claim on the spell', () => {
    const cast = castFamiliar(table(unchained()), 'bat');
    expect(cast.ok).toBe(false);
    expect(cast.ok ? '' : cast.code).toBe('spell_not_available');
  });

  /**
   * And the hour is still the spell's. The same Warlock reaching Find Familiar
   * through Magic Initiate instead casts it the way the book prints it: a long
   * casting that leaves a pending record rather than resolving in a breath.
   */
  it('leaves the printed hour alone for whoever casts it another way', () => {
    const log = table(throughTheFeat());
    // The feat prices its level 1 spell two ways, so the payment is named —
    // which has nothing to do with how long the casting takes.
    const cast = unwrap(
      resolveSpell(
        fold('seed', log),
        WHO,
        {
          spellId: 'find-familiar',
          targets: [WHO],
          form: 'bat',
          choice: 'Fey',
          payment: 'free-casting',
        },
        supply('feat'),
      ),
      'the feat’s route',
    );
    const declared = cast.events.find(
      (event): event is Extract<GameEvent, { type: 'spell-declared' }> =>
        event.type === 'spell-declared',
    );
    expect(declared?.casting.castingTime).toBe('long');
    expect(Object.keys(fold('seed', [...log, ...cast.events]).pendingCastings)).toHaveLength(1);
  });

  /** "or one of the following special forms" — each of the seven, by name. */
  it.each(SPECIAL_FORMS)('summons a %s, which Find Familiar does not print', (form) => {
    const log = table(chained());
    const cast = unwrap(castFamiliar(log, form), `familiar ${form}`);
    const arrived = cast.events.find(
      (event): event is Extract<GameEvent, { type: 'creature-added' }> =>
        event.type === 'creature-added',
    );
    expect(arrived).toBeDefined();
  });

  /** And the spell's own list is still the spell's: a Bat is still a familiar. */
  it('keeps the forms the spell prints', () => {
    const log = table(chained());
    expect(unwrap(castFamiliar(log, 'bat'), 'bat').events.length).toBeGreaterThan(0);
  });

  /** A form on neither list is refused, and the refusal names both. */
  it('refuses a form off both lists', () => {
    const log = table(chained());
    const cast = castFamiliar(log, 'ogre');
    expect(cast.ok).toBe(false);
    if (cast.ok) return;
    expect(cast.code).toBe('form_not_offered');
    expect(cast.reason).toContain('imp');
    expect(cast.reason).toContain('bat');
  });

  /** And a Warlock without the Pact is offered only what the spell prints. */
  it('offers the seven to nobody else', () => {
    const cast = castFamiliar(table(throughTheFeat()), 'imp');
    expect(cast.ok).toBe(false);
    expect(cast.ok ? '' : cast.code).toBe('form_not_offered');
  });
});
