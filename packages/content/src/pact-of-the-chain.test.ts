import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap, type CharacterId } from '@ie/shared';
import {
  checkCharacter,
  checkContent,
  createCharacter,
  createRng,
  createRollIssuer,
  fold,
  orderSummonsAttack,
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

  /**
   * The rows the validators grew with the two terms.
   *
   * A casting time the vocabulary has no word for would be preferred over the
   * definition's and price the casting against a slot of the action economy
   * that does not exist; a form naming no stat block would refuse every
   * familiar the sentence offered, at the table rather than here; and a
   * widening of nothing offers what the spell already offered.
   */
  it('refuses the shapes the two new fields can be written wrong in', () => {
    const grants = (): readonly { readonly kind: string }[] => {
      const warlock = SRD_CONTENT.classes.find((one) => one.id === 'warlock')!;
      const feature = warlock.features.find((one) => one.id === FIEND)!;
      return feature.grants as readonly { readonly kind: string }[];
    };
    const index = grants().findIndex(
      (grant) => grant.kind === 'spells' && (grant as { widensForm?: unknown }).widensForm !== undefined,
    );
    const at = `classes[warlock].features[0].grants[${index}]`;

    const rewritten = (over: Record<string, unknown>): readonly string[] => {
      const warlock = JSON.parse(
        JSON.stringify(SRD_CONTENT.classes.find((one) => one.id === 'warlock')),
      ) as { features: { id: string; grants: Record<string, unknown>[] }[] };
      const feature = warlock.features.find((one) => one.id === FIEND)!;
      feature.grants[index] = { ...feature.grants[index], ...over };
      // The bestiary is handed over too, because a form naming a stat block is
      // checked against one and a catalogue holding none judges nothing.
      return checkContent({ classes: [warlock as never], monsters: SRD_CONTENT.monsters }).map(
        (problem) => `${problem.code} @ ${problem.field}`,
      );
    };

    expect(rewritten({ castingTime: 'a while' })).toContain(`bad_casting_time @ ${at}.castingTime`);
    // And the one of the four a route may not state: the field carries no
    // seconds, so a route that made a casting long would never complete.
    expect(rewritten({ castingTime: 'long' })).toContain(`bad_casting_time @ ${at}.castingTime`);
    expect(rewritten({ widensForm: [] })).toContain(`widens_no_form @ ${at}.widensForm`);
    expect(rewritten({ widensForm: [''] })).toContain(`widens_no_form @ ${at}.widensForm[0]`);
    expect(rewritten({ widensForm: ['slaad-tadpole'] })).toContain(
      `unknown_monster @ ${at}.widensForm[0]`,
    );
    // And the catalogue as it stands says none of them. Filtered, because a
    // class judged on its own holds no spells — see the same note in
    // `pact-of-the-blade.test.ts`.
    expect(
      rewritten({}).filter(
        (said) =>
          !said.startsWith('unknown_granted_spell') && !said.startsWith('unknown_free_casting'),
      ),
    ).toEqual([]);
  });
});

/**
 * "Additionally, when you take the Attack action, you can forgo one of your own
 * attacks to allow your familiar to make one attack of its own with its
 * Reaction."
 *
 * Two prices in one sentence, and the sentence is also the permission that
 * overrides Find Familiar's own "A familiar can't attack".
 */
describe('the attack a Warlock forgoes', () => {
  const OGRE = asCharacterId('ogre');
  /** What the casting called the creature it raised: `<casting id>:<block>`. */
  const impIn = (log: readonly GameEvent[]): CharacterId => {
    const arrived = log.find(
      (event): event is Extract<GameEvent, { type: 'creature-added' }> =>
        event.type === 'creature-added' && event.id.endsWith(':imp'),
    );
    if (arrived === undefined) throw new Error('no familiar arrived');
    return arrived.id;
  };

  /** The Warlock, an ogre, a fight, a familiar, and the Attack action taken. */
  const fought = (): GameEvent[] => {
    const start: GameEvent[] = [
      ...(unwrap(createCharacter(SRD_CONTENT, chained(), WHO), 'creation') as GameEvent[]),
      {
        type: 'creature-added',
        id: OGRE,
        name: 'an ogre',
        maxHp: 200,
        diesAtZero: true,
        creatureType: 'Giant',
        sheet: {
          level: 1,
          abilities: { str: 19, dex: 8, con: 16, int: 5, wis: 7, cha: 7 },
          skills: {},
          saveProficiencies: [],
          armor: null,
          shield: null,
          armorTraining: { light: false, medium: false, heavy: false, shields: false },
          baseSpeed: 40,
          spellcastingAbility: null,
          // Armour Class 1, so the sting lands and the log has damage in it.
          stated: { armorClass: 1, proficiencyBonus: 2, initiative: -1 },
        },
      },
      { type: 'scene-set', extent: { width: 400, depth: 400, height: 40 } },
      { type: 'landmark-added', name: 'the well', at: { x: 100, y: 100, z: 0 } },
      { type: 'creature-placed', id: WHO, placement: { from: { landmark: 'the well' }, feet: 0 } },
      {
        type: 'creature-placed',
        id: OGRE,
        placement: { from: { creature: WHO }, feet: 5, bearing: 90 },
      },
    ];
    // The familiar, summoned before the fight so it has a rung of its own.
    const summoned = unwrap(castFamiliar(start, 'imp', 'the imp'), 'find familiar').events;
    const imp = impIn(summoned);
    return [
      ...start,
      ...summoned,
      { type: 'creature-placed', id: imp, placement: { from: { creature: OGRE }, feet: 5 } },
      {
        type: 'combat-started',
        combatants: [
          { id: WHO, initiative: 20, speed: 30 },
          { id: imp, initiative: 15, speed: 20 },
          { id: OGRE, initiative: 1, speed: 40 },
        ],
      },
    ];
  };

  const order = (log: readonly GameEvent[], over: Record<string, unknown> = {}) =>
    orderSummonsAttack(
      fold('seed', log),
      WHO,
      { feature: FIEND, summons: impIn(log), target: OGRE, commandId: 'sting', ...over },
      supply('sting'),
    );

  it('buys the familiar one attack of its own, at its Reaction', () => {
    const log = fought();
    const before = fold('seed', log);
    // Nothing taken yet: the Attack action is the Warlock's to take.
    expect(before.combat?.budgets[WHO]?.attacksRemaining).toBeNull();
    expect(before.combat?.budgets[impIn(log)]?.reaction).toBe(true);

    const out = unwrap(order(log), 'the sting');
    const after = fold('seed', [...log, ...out.events]);

    // **Both prices paid.** A Warlock 5 makes one attack in an Attack action,
    // so the attack forgone here is that one: the Action is spent and nothing
    // is left of it. And the Imp's Reaction is gone.
    expect(after.combat?.budgets[WHO]?.action).toBe(false);
    expect(after.combat?.budgets[WHO]?.attacksRemaining).toBe(0);
    expect(after.combat?.budgets[impIn(log)]?.reaction).toBe(false);
    expect(
      out.events.some((event) => event.type === 'damage-taken' && event.id === OGRE),
    ).toBe(true);
  });

  /** And a second order in the same turn has no attack left to give up. */
  it('is refused a second time in one Attack action', () => {
    const log = fought();
    const once = unwrap(order(log), 'the sting');
    const again = order([...log, ...once.events], { commandId: 'again' });
    expect(again.ok).toBe(false);
    expect(again.ok ? '' : again.code).toBe('no_attacks_left');
  });

  /**
   * SRD Find Familiar: "A familiar can't attack." The Pact's sentence is the
   * permission that overrides it, and nothing else does: the Imp still may not
   * take the Attack action on its own turn.
   */
  it('is the only door a familiar attacks through', () => {
    const log = fought();
    const imp = fold('seed', log).creatures[impIn(log)];
    expect(imp?.actionRules.map((rule) => rule.label)).toContain('Find Familiar');
    expect(unwrap(order(log), 'the sting').events.length).toBeGreaterThan(0);
  });

  /** "with its Reaction" — and a familiar that has spent one has none to give. */
  it('is refused when the familiar has already taken its Reaction', () => {
    const log = fought();
    const spent = [...log, { type: 'reaction-spent', id: impIn(log) }] as GameEvent[];
    const out = order(spent);
    expect(out.ok).toBe(false);
    expect(out.ok ? '' : out.code).toBe('no_reaction');
  });

  /**
   * "when you take the Attack action" — and a Warlock who has already spent
   * their Action on something else cannot take it.
   */
  it('is refused when the Action has gone elsewhere', () => {
    const log = [...fought(), { type: 'action-spent', id: WHO }] as GameEvent[];
    const out = order(log);
    expect(out.ok).toBe(false);
    expect(out.ok ? '' : out.code).toBe('no_action');
  });

  /** "**your** familiar" — and the ogre is nobody's. */
  it('is refused for a creature the Warlock did not summon', () => {
    const out = order(fought(), { summons: OGRE });
    expect(out.ok).toBe(false);
    expect(out.ok ? '' : out.code).toBe('not_your_summons');
  });

  /** And a Warlock who never took the Pact has no such sentence. */
  it('is not offered to a Warlock who took something else', () => {
    const log = [
      ...(unwrap(createCharacter(SRD_CONTENT, unchained(), WHO), 'creation') as GameEvent[]),
    ];
    const out = orderSummonsAttack(
      fold('seed', log),
      WHO,
      { feature: FIEND, summons: OGRE, target: OGRE, commandId: 'nope' },
      supply('nope'),
    );
    expect(out.ok).toBe(false);
    expect(out.ok ? '' : out.code).toBe('no_such_feature');
  });
});
