import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import {
  asCharacterId,
  isErr,
  expect as unwrap,
  type Ability,
  type CharacterId,
} from '@ie/shared';
import { fold, type GameEvent, type GameState } from './events.js';
import { remaining } from './resources.js';
import { activateFeature, endFeature, extendFeature, resolveTurn, castSpell } from './commands.js';
import { createCharacter, type CharacterChoices } from './creation.js';
import { defensesOf, effectiveConditions, rollModesFor } from './standing.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';

/**
 * The Advantage and Disadvantage reaching a saving throw, read the way every
 * roll in the engine now reads it: one query, one gatherer, one predicate.
 */
const saveModes = (state: GameState, who: CharacterId, ability: Ability) =>
  rollModesFor(state, { family: 'saving-throw', roller: who, ability }).modes;


/**
 * Rage: a feature a creature turns on, pays for, and can lose.
 *
 * The first *activated* feature, and it needs every part of that shape at
 * once — which is why it is the one that earns the mechanism rather than a
 * guess about what a mechanism might need:
 *
 * | SRD | What it asks for |
 * |---|---|
 * | "You can enter it as a Bonus Action if you aren't wearing Heavy armor" | an action cost and a prerequisite |
 * | "the number of times shown... in the Rages column" | a pool, sized by level |
 * | "Resistance to Bludgeoning, Piercing, and Slashing damage" | a defence that holds only while it runs |
 * | "Advantage on Strength checks and Strength saving throws" | a modifier that holds only while it runs |
 * | "You can't maintain Concentration, and you can't cast spells" | a refusal while it runs |
 * | "lasts until the end of your next turn" | a turn-anchored deadline |
 * | "ends early if you don Heavy armor or have the Incapacitated condition" | two ways out that nobody commands |
 * | "you can extend the Rage for another round" | a deadline that can be pushed |
 * | "up to 10 minutes" | a cap the extension cannot pass |
 */

const id = (s: string) => asCharacterId(s);
const GRUM = id('grum');
const FOE = id('foe');

const barbarian = (over: Partial<CharacterChoices> = {}): CharacterChoices => ({
  name: 'Grum',
  classId: 'barbarian',
  level: 3,
  speciesId: 'human',
  backgroundId: 'sage',
  abilities: {
    method: 'standard-array',
    assignment: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 },
  },
  abilityIncreases: { con: 2, wis: 1 },
  classSkills: ['athletics', 'survival'],
  languages: ['Dwarvish', 'Orc'],
  alignment: 'Chaotic Neutral',
  subclassId: 'path-of-the-berserker',
  cantrips: [],
  spellbook: [],
  preparedSpells: [],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: [],
  hitPoints: { method: 'fixed' },
  featureChoices: { 'human:skillful': ['perception'], 'barbarian:primal-knowledge': ['intimidation'] },
  feats: {
    'sage:magic-initiate-wizard': {
      featId: 'magic-initiate',
      spellList: 'wizard',
      spellcastingAbility: 'int',
      cantrips: ['mage-hand', 'light'],
      levelOneSpell: 'find-familiar',
    },
    'human:versatile': { featId: 'alert' },
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
  ...over,
});

const made = (over: Partial<CharacterChoices> = {}): readonly GameEvent[] =>
  unwrap(createCharacter(SRD_CONTENT,barbarian(over), GRUM), 'create') as GameEvent[];

const base = (over: Partial<CharacterChoices> = {}): GameState => fold('seed', made(over));

const RAGE = 'barbarian:rage';

/** Turn it on, and hand back the longer log. */
const raging = (log: readonly GameEvent[] = made()): readonly GameEvent[] => [
  ...log,
  ...unwrap(activateFeature(fold('seed', log), GRUM, { feature: RAGE }, SRD_CONTENT), 'rage'),
];

const supply = () => ({ issuer: createRollIssuer('r'), rng: createRng('turn') as Rng, content: SRD_CONTENT });

describe('turning it on costs what the SRD says it costs', () => {
  /** SRD: "the number of times shown for your Barbarian level in the Rages column." */
  it('declares a pool sized by the class table', () => {
    // A level 3 Barbarian has three Rages.
    expect(remaining(base().creatures.grum!.resources, 'rage')).toBe(3);
  });

  it('spends a use to enter it', () => {
    const after = fold('seed', raging());
    expect(remaining(after.creatures.grum!.resources, 'rage')).toBe(2);
    expect(after.creatures.grum!.activeFeatures).toContain(RAGE);
  });

  it('refuses when there are none left', () => {
    const spent: readonly GameEvent[] = [
      ...made(),
      { type: 'resource-spent', id: GRUM, key: 'rage', amount: 3 },
    ];
    const out = activateFeature(fold('seed', spent), GRUM, { feature: RAGE }, SRD_CONTENT);
    expect(isErr(out)).toBe(true);
    if (isErr(out)) expect(out.code).toBe('exhausted');
  });

  /** SRD: "if you aren't wearing Heavy armor". */
  it('refuses in Heavy armour', () => {
    const armoured: readonly GameEvent[] = [
      ...made(),
      { type: 'items-gained', id: GRUM, items: [{ id: 'ring-mail', quantity: 1 }], source: 'loot' },
      { type: 'item-equipped', id: GRUM, item: 'ring-mail', armor: SRD_CONTENT.item('ring-mail')?.armor ?? null },
    ];
    const out = activateFeature(fold('seed', armoured), GRUM, { feature: RAGE }, SRD_CONTENT);
    expect(isErr(out)).toBe(true);
    if (isErr(out)) expect(out.code).toBe('heavy_armor');
  });

  it('refuses to start twice', () => {
    const out = activateFeature(fold('seed', raging()), GRUM, { feature: RAGE }, SRD_CONTENT);
    expect(isErr(out)).toBe(true);
    if (isErr(out)) expect(out.code).toBe('already_active');
  });

  /** SRD: "You can enter it as a Bonus Action." */
  it('spends the Bonus Action in combat, and refuses a second one', () => {
    const fighting: readonly GameEvent[] = [
      ...made(),
      {
        type: 'creature-added',
        id: FOE,
        name: 'foe',
        sheet: base().creatures.grum!.sheet,
        maxHp: 20,
        diesAtZero: true,
      },
      {
        type: 'combat-started',
        combatants: [
          { id: GRUM, initiative: 20, speed: 30 },
          { id: FOE, initiative: 10, speed: 30 },
        ],
      },
    ];
    const first = unwrap(activateFeature(fold('seed', fighting), GRUM, { feature: RAGE }, SRD_CONTENT), 'rage');
    const after = [...fighting, ...first];
    expect(fold('seed', after).combat?.budgets.grum?.bonusAction).toBe(false);

    const ended = unwrap(endFeature(fold('seed', after), GRUM, { feature: RAGE }), 'end');
    const out = activateFeature(fold('seed', [...after, ...ended]), GRUM, { feature: RAGE }, SRD_CONTENT);
    expect(isErr(out)).toBe(true);
    if (isErr(out)) expect(out.code).toBe('no_bonus_action');
  });

  it('is a no-op on a retried command id', () => {
    const first = unwrap(
      activateFeature(base(), GRUM, { feature: RAGE, commandId: 'r1' }, SRD_CONTENT),
      'first',
    );
    const log = [...made(), ...first];
    const retry = unwrap(
      activateFeature(fold('seed', log), GRUM, { feature: RAGE, commandId: 'r1' }, SRD_CONTENT),
      'retry',
    );
    expect(retry).toEqual([]);
    expect(remaining(fold('seed', log).creatures.grum!.resources, 'rage')).toBe(2);
  });
});

describe('what Rage does, it does only while it is running', () => {
  /** SRD: "You have Resistance to Bludgeoning, Piercing, and Slashing damage." */
  it('grants the three physical resistances', () => {
    const before = defensesOf(base(), GRUM);
    expect(before.bludgeoning).toBeUndefined();

    const during = defensesOf(fold('seed', raging()), GRUM);
    expect(during.bludgeoning).toEqual({ resistant: true });
    expect(during.piercing).toEqual({ resistant: true });
    expect(during.slashing).toEqual({ resistant: true });
    expect(during.fire).toBeUndefined();
  });

  /** SRD: "You have Advantage on Strength checks and Strength saving throws." */
  it('grants Advantage on Strength saves and on nothing else', () => {
    const during = fold('seed', raging());
    expect(saveModes(during, GRUM, 'str')).toEqual([{ source: 'Rage', mode: 'advantage' }]);
    expect(saveModes(during, GRUM, 'dex')).toHaveLength(1); // Danger Sense, at level 3
    expect(saveModes(during, GRUM, 'wis')).toEqual([]);
  });

  it('takes all of it away again when it ends', () => {
    const log = raging();
    const ended = [...log, ...unwrap(endFeature(fold('seed', log), GRUM, { feature: RAGE }), 'end')];
    expect(defensesOf(fold('seed', ended), GRUM).bludgeoning).toBeUndefined();
    expect(saveModes(fold('seed', ended), GRUM, 'str')).toEqual([]);
  });

  /** SRD: "You can't maintain Concentration, and you can't cast spells." */
  it('refuses to cast while it runs', () => {
    const out = castSpell(fold('seed', raging()), GRUM, {
      spell: 'Fire Bolt',
      level: 0,
    });
    expect(isErr(out)).toBe(true);
    if (isErr(out)) expect(out.code).toBe('raging');
  });

  it('casts again once it is over', () => {
    const log = raging();
    const ended = [...log, ...unwrap(endFeature(fold('seed', log), GRUM, { feature: RAGE }), 'end')];
    expect(isErr(castSpell(fold('seed', ended), GRUM, { spell: 'Fire Bolt', level: 0 }))).toBe(false);
  });
});

describe('two ways out that nobody commands', () => {
  /** SRD: "ends early if you... have the Incapacitated condition." */
  it('ends when the barbarian is Incapacitated', () => {
    const stunned = fold('seed', [
      ...raging(),
      { type: 'condition-applied', id: GRUM, condition: 'stunned', source: 'a spell' },
    ]);
    expect(stunned.creatures.grum!.activeFeatures).not.toContain(RAGE);
    expect(defensesOf(stunned, GRUM).bludgeoning).toBeUndefined();
  });

  /** SRD: "ends early if you don Heavy armor." */
  it('ends when Heavy armour goes on', () => {
    const armoured = fold('seed', [
      ...raging(),
      { type: 'items-gained', id: GRUM, items: [{ id: 'ring-mail', quantity: 1 }], source: 'loot' },
      { type: 'item-equipped', id: GRUM, item: 'ring-mail', armor: SRD_CONTENT.item('ring-mail')?.armor ?? null },
    ]);
    expect(armoured.creatures.grum!.activeFeatures).not.toContain(RAGE);
  });

  /** And it stays gone: nothing brings it back when the armour comes off. */
  it('does not come back when the armour comes off', () => {
    const off = fold('seed', [
      ...raging(),
      { type: 'items-gained', id: GRUM, items: [{ id: 'ring-mail', quantity: 1 }], source: 'loot' },
      { type: 'item-equipped', id: GRUM, item: 'ring-mail', armor: SRD_CONTENT.item('ring-mail')?.armor ?? null },
      { type: 'item-unequipped', id: GRUM, item: 'ring-mail' },
    ]);
    expect(off.creatures.grum!.activeFeatures).not.toContain(RAGE);
  });
});

describe('the deadline, and pushing it', () => {
  const fighting = (): readonly GameEvent[] => [
    ...made(),
    {
      type: 'creature-added',
      id: FOE,
      name: 'foe',
      sheet: base().creatures.grum!.sheet,
      maxHp: 20,
      diesAtZero: true,
    },
    {
      type: 'combat-started',
      combatants: [
        { id: GRUM, initiative: 20, speed: 30 },
        { id: FOE, initiative: 10, speed: 30 },
      ],
    },
  ];

  /** SRD: "The Rage lasts until the end of your next turn." */
  it('lapses at the end of the barbarian’s next turn', () => {
    const log = raging(fighting());
    let current = log;
    // Grum's turn, then the foe's, then Grum's again, then its end.
    for (let n = 0; n < 3; n += 1) {
      current = [...current, ...unwrap(resolveTurn(fold('seed', current), supply()), 'turn').events];
    }
    expect(fold('seed', current).creatures.grum!.activeFeatures).not.toContain(RAGE);
  });

  /** SRD: "you can extend the Rage for another round." */
  it('survives the boundary when it is extended', () => {
    let current = raging(fighting());
    current = [...current, ...unwrap(resolveTurn(fold('seed', current), supply()), 'turn').events];
    current = [...current, ...unwrap(resolveTurn(fold('seed', current), supply()), 'turn').events];
    // Back on Grum's turn: extend before it lapses.
    current = [
      ...current,
      ...unwrap(extendFeature(fold('seed', current), GRUM, { feature: RAGE, by: 'attack' }), 'extend'),
    ];
    current = [...current, ...unwrap(resolveTurn(fold('seed', current), supply()), 'turn').events];
    expect(fold('seed', current).creatures.grum!.activeFeatures).toContain(RAGE);
  });

  /** SRD: "Take a Bonus Action to extend your Rage" — and only that one costs. */
  it('spends a Bonus Action only when that is how it was extended', () => {
    // A round on, so the Bonus Action entering the Rage spent is back.
    let started = raging(fighting());
    for (let n = 0; n < 2; n += 1) {
      started = [...started, ...unwrap(resolveTurn(fold('seed', started), supply()), 'turn').events];
    }
    expect(fold('seed', started).combat?.budgets.grum?.bonusAction).toBe(true);

    // The attack route costs nothing; only "Take a Bonus Action to extend your
    // Rage" does, which is the one of the three that says so.
    const byAttack = unwrap(
      extendFeature(fold('seed', started), GRUM, { feature: RAGE, by: 'attack' }),
      'attack',
    );
    expect(byAttack.some((e) => e.type === 'bonus-action-spent')).toBe(false);

    const byBonusAction = unwrap(
      extendFeature(fold('seed', started), GRUM, { feature: RAGE, by: 'bonus-action' }),
      'bonus action',
    );
    expect(byBonusAction.some((e) => e.type === 'bonus-action-spent')).toBe(true);
    expect(
      fold('seed', [...started, ...byBonusAction]).combat?.budgets.grum?.bonusAction,
    ).toBe(false);
  });

  it('refuses to extend something that is not running', () => {
    const out = extendFeature(base(), GRUM, { feature: RAGE, by: 'attack' });
    expect(isErr(out)).toBe(true);
    if (isErr(out)) expect(out.code).toBe('not_active');
  });

  /**
   * SRD: "You can maintain a Rage for up to 10 minutes."
   *
   * The sentence the sheet has always carried and nothing has ever read.
   * `capSeconds` was pinned at creation for the express purpose of bounding
   * this, and every extension replaced the deadline without ever looking at
   * it — so a Barbarian could hold a Rage for a week.
   *
   * The ceiling is pinned onto **the activation**, at the moment it begins,
   * as the clock reading it may not be maintained past. Every later extension
   * carries that same reading across rather than deriving a fresh one, which
   * is the difference between a bound and a thing that moves whenever it is
   * approached — and it is read back out of the log, never out of the book.
   */
  describe('the ten minutes it may be maintained for', () => {
    const later = (log: readonly GameEvent[], seconds: number): readonly GameEvent[] => [
      ...log,
      { type: 'time-advanced', seconds, reason: 'the fight dragged on' },
    ];

    const capOf = (log: readonly GameEvent[]) => {
      const timer = fold('seed', log).timers[`feature|${GRUM}|${RAGE}`];
      return timer?.target.kind === 'feature' ? timer.target.cap : undefined;
    };

    it('pins the ceiling onto the activation, from the number on the sheet', () => {
      expect(capOf(raging(fighting()))).toEqual({ seconds: 600, until: 600 });
    });

    it('extends while the ten minutes are still running', () => {
      const out = extendFeature(fold('seed', later(raging(fighting()), 594)), GRUM, {
        feature: RAGE,
        by: 'attack',
      });
      expect(isErr(out)).toBe(false);
    });

    it('refuses the extension once they are up, naming the cap and where it came from', () => {
      const out = extendFeature(fold('seed', later(raging(fighting()), 600)), GRUM, {
        feature: RAGE,
        by: 'attack',
      });
      expect(isErr(out)).toBe(true);
      if (isErr(out)) {
        expect(out.code).toBe('cap_reached');
        // The cap itself, in the units the SRD prints it in ...
        expect(out.reason).toContain('10 minutes');
        // ... and where the number came from, which is the sheet and not the book.
        expect(out.reason).toContain('sheet');
      }
    });

    it('refuses the Bonus Action route too, and spends nothing doing it', () => {
      const log = later(raging(fighting()), 600);
      const before = fold('seed', log).combat?.budgets.grum?.bonusAction;
      const out = extendFeature(fold('seed', log), GRUM, { feature: RAGE, by: 'bonus-action' });
      expect(isErr(out)).toBe(true);
      // A refusal is a value and carries no events, so the Bonus Action is still there.
      expect(fold('seed', log).combat?.budgets.grum?.bonusAction).toBe(before);
    });

    /**
     * The test the whole mechanism turns on. A ceiling re-derived at each
     * extension is pushed out by the very act of approaching it, and would
     * never be reached however long the Rage ran.
     */
    it('carries the ceiling across an extension rather than pushing it out', () => {
      const midway = later(raging(fighting()), 300);
      const extended: readonly GameEvent[] = [
        ...midway,
        ...unwrap(
          extendFeature(fold('seed', midway), GRUM, { feature: RAGE, by: 'attack' }),
          'extend',
        ),
      ];
      expect(capOf(extended)).toEqual({ seconds: 600, until: 600 });

      const out = extendFeature(fold('seed', later(extended, 300)), GRUM, {
        feature: RAGE,
        by: 'attack',
      });
      expect(isErr(out)).toBe(true);
    });

    /**
     * A log written against a book that said one minute is still bounded by
     * one minute, whatever this year's catalogue says. The fold opens no
     * catalogue, and neither does the command that reads the bound back out.
     */
    it('is bounded by the cap its own log pinned, not by the catalogue', () => {
      const pinnedShort: readonly GameEvent[] = [
        ...fighting(),
        { type: 'resource-spent', id: GRUM, key: 'rage', amount: 1 },
        { type: 'feature-activated', id: GRUM, feature: RAGE },
        {
          type: 'effect-scheduled',
          target: { kind: 'feature', on: GRUM, feature: RAGE, cap: { seconds: 60, until: 60 } },
          deadline: { kind: 'turn-end', of: GRUM, count: 2 },
        },
      ];

      const inside = extendFeature(fold('seed', later(pinnedShort, 54)), GRUM, {
        feature: RAGE,
        by: 'attack',
      });
      expect(isErr(inside)).toBe(false);

      const past = extendFeature(fold('seed', later(pinnedShort, 60)), GRUM, {
        feature: RAGE,
        by: 'attack',
      });
      expect(isErr(past)).toBe(true);
      if (isErr(past)) {
        expect(past.reason).toContain('1 minute');
        expect(past.reason).not.toContain('10 minutes');
      }
    });

    /**
     * Nothing that was unbounded becomes bounded by accident: a feature whose
     * record carries no `capSeconds` is extended for as long as anybody likes,
     * exactly as it was before there was a cap to read.
     */
    it('leaves a feature with no pinned cap exactly as it was', () => {
      const UNCAPPED = id('kes');
      const sheet = base().creatures.grum!.sheet;
      const uncapped: readonly GameEvent[] = [
        ...made(),
        {
          type: 'creature-added',
          id: UNCAPPED,
          name: 'Kes',
          sheet: {
            ...sheet,
            activated: [
              {
                feature: 'test:stance',
                name: 'Stance',
                action: 'bonus-action',
                pool: null,
                lasts: 'end-of-next-turn',
              },
            ],
          },
          maxHp: 20,
          diesAtZero: true,
        },
        {
          type: 'combat-started',
          combatants: [
            { id: UNCAPPED, initiative: 20, speed: 30 },
            { id: GRUM, initiative: 10, speed: 30 },
          ],
        },
        { type: 'feature-activated', id: UNCAPPED, feature: 'test:stance' },
      ];

      const out = extendFeature(fold('seed', later(uncapped, 6000)), UNCAPPED, {
        feature: 'test:stance',
        by: 'attack',
      });
      expect(isErr(out)).toBe(false);
    });

    /**
     * A second Rage is a second ten minutes.
     *
     * The ceiling is carried across an *extension*, which is the same
     * activation continuing. A fresh activation is not, and the timer left
     * standing by a dismissal is close enough to one to be mistaken for it:
     * `feature-ended` drops the feature and leaves the deadline to lapse on
     * its own, so for a round there is a stale record of the Rage that was.
     * Entering a new one while it stands must read the sheet, not that.
     */
    it('starts the ten minutes again when the feature is entered afresh', () => {
      let current = raging(fighting());
      current = [
        ...current,
        ...unwrap(endFeature(fold('seed', current), GRUM, { feature: RAGE }), 'dismiss'),
        { type: 'time-advanced', seconds: 500, reason: 'the party walked on' },
      ];
      // Round the order back to Grum, whose Bonus Action is his again — and
      // whose lapsed Rage's timer has not reached its own deadline yet.
      for (let n = 0; n < 2; n += 1) {
        current = [...current, ...unwrap(resolveTurn(fold('seed', current), supply()), 'turn').events];
      }
      expect(capOf(current)).toEqual({ seconds: 600, until: 600 });

      current = [
        ...current,
        ...unwrap(activateFeature(fold('seed', current), GRUM, { feature: RAGE }, SRD_CONTENT), 'again'),
      ];
      const now = fold('seed', current).elapsed;
      expect(now).toBeGreaterThan(0);
      expect(capOf(current)).toEqual({ seconds: 600, until: now + 600 });
    });

    it('extends once under one command id however many times it is asked', () => {
      const log = later(raging(fighting()), 300);
      const first = unwrap(
        extendFeature(fold('seed', log), GRUM, { feature: RAGE, by: 'attack', commandId: 'once' }),
        'first',
      );
      const again = unwrap(
        extendFeature(fold('seed', [...log, ...first]), GRUM, {
          feature: RAGE,
          by: 'attack',
          commandId: 'once',
        }),
        'again',
      );
      expect(again).toEqual([]);
    });
  });
});

describe('it replays and survives a reload', () => {
  it('folds to the same state twice', () => {
    const log = raging();
    expect(fold('seed', log)).toEqual(fold('seed', log));
  });

  it('replays prefix by prefix', () => {
    const log = raging();
    for (let n = 0; n <= log.length; n += 1) {
      expect(fold('seed', log.slice(0, n))).toEqual(fold('seed', log.slice(0, n)));
    }
  });

  it('survives JSON', () => {
    const state = fold('seed', raging());
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });
});

/**
 * Mindless Rage, whose requirement is somebody else's feature.
 *
 * SRD Path of the Berserker, level 6: "You have Immunity to the Charmed and
 * Frightened conditions **while your Rage is active**." It is the Berserker's
 * feature and what it needs switched on is the *Barbarian's* Rage — which is
 * why a requirement names the feature rather than meaning "whichever one
 * granted me". That distinction was wrong in the first draft and right only
 * because this feature exists to catch it.
 */
describe('a feature whose condition is another feature', () => {
  const berserker = (): readonly GameEvent[] =>
    made({
      level: 6,
      feats: {
        ...barbarian().feats,
        'barbarian:ability-score-improvement': { featId: 'savage-attacker' },
      },
    });

  const charmed = (log: readonly GameEvent[]): readonly GameEvent[] => [
    ...log,
    { type: 'condition-applied', id: GRUM, condition: 'charmed', source: 'a hag' },
    { type: 'condition-applied', id: GRUM, condition: 'frightened', source: 'a dragon' },
  ];

  it('does nothing while the Rage is off', () => {
    const state = fold('seed', charmed(berserker()));
    expect(effectiveConditions(state, GRUM).conditions).toContain('charmed');
    expect(effectiveConditions(state, GRUM).conditions).toContain('frightened');
  });

  it('suppresses both the moment the Rage starts', () => {
    const state = fold('seed', raging(charmed(berserker())));
    expect(state.creatures.grum!.activeFeatures).toContain(RAGE);
    expect(effectiveConditions(state, GRUM).conditions).not.toContain('charmed');
    expect(effectiveConditions(state, GRUM).conditions).not.toContain('frightened');
    // Recorded, not removed: the SRD's other sentence would remove them, and
    // the feature's note says it does not.
    expect(state.creatures.grum!.conditions.conditions).toContain('charmed');
  });

  it('gives them back when the Rage ends', () => {
    const log = raging(charmed(berserker()));
    const ended = [...log, ...unwrap(endFeature(fold('seed', log), GRUM, { feature: RAGE }), 'end')];
    expect(effectiveConditions(fold('seed', ended), GRUM).conditions).toContain('charmed');
  });

  /** A level 3 Berserker has no Mindless Rage, and raging suppresses nothing. */
  it('is not granted before its level', () => {
    const state = fold('seed', raging(charmed(made())));
    expect(effectiveConditions(state, GRUM).conditions).toContain('charmed');
  });
});
