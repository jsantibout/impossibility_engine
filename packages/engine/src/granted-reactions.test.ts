import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, isErr, expect as unwrap, type CharacterId } from '@ie/shared';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer, type RollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { createCharacter, type CharacterChoices } from './creation.js';
import { extendContent, parseClassDefinition, type Content } from './content.js';
import {
  advanceTime,
  conferReaction,
  resolveTest,
  takeTestReaction,
} from './commands.js';
import { remaining } from './resources.js';
import { offersForTest } from './reactions.js';

/**
 * A die one creature hands another, and the tenth family of sourced grant.
 *
 * The Bard's pool was counted, recovered and spent by two later features
 * before anything could do the thing the feature is named for. What was
 * missing was **not** "a resource one creature hands to another": nothing is
 * handed over. The Bard's own use is spent at the moment of conferral, and
 * what the ally holds afterwards is a grant with a source and a deadline —
 * the ninth family's shape exactly, carrying a Reaction instead of a bonus.
 *
 * Which makes the die an `intervene` in the `test-rolled` window, the same
 * mechanism Peerless Skill already spends the pool through: a number added
 * **after a test is seen to fail**, chosen by whoever holds it, costing no
 * Reaction. It is not the one-shot roll modifier, which is a mode applied
 * before a roll with nobody choosing.
 *
 * Two honest limits, asserted here rather than left to be discovered:
 *
 * - `D20TestKind` is an ability check or a saving throw, and `offersForTest`
 *   is reached from the standalone declared test. A spell-forced save settles
 *   atomically and an attack roll never opens the window, so the SRD's "any
 *   D20 Test" lands as "the checks and saves the table asks for".
 * - Sight is declared and hearing is not, so "who can see or hear you" is an
 *   `unverified` line and never a refusal.
 */

const id = (s: string) => asCharacterId(s);
const ILVA = id('ilva'); // the Bard
const NYX = id('nyx'); // the ally who holds the die
const BRAM = id('bram'); // a second holder, and a second Bard's target
const SEL = id('sel'); // a second Bard

const common = {
  speciesId: 'human',
  backgroundId: 'sage',
  languages: ['Dwarvish', 'Orc'],
  alignment: 'Neutral',
  spellbook: [],
  backgroundEquipment: 'A' as const,
  classEquipment: 'A' as const,
  equipped: [],
  hitPoints: { method: 'fixed' as const },
  cantrips: [],
  preparedSpells: [],
  feats: {
    'sage:magic-initiate-wizard': {
      featId: 'magic-initiate',
      spellList: 'wizard',
      spellcastingAbility: 'int' as const,
      cantrips: ['mage-hand', 'light'],
      levelOneSpell: 'find-familiar',
    },
    'human:versatile': { featId: 'alert' },
  },
};

const bard = (name: string): CharacterChoices => ({
  ...common,
  name,
  classId: 'bard',
  level: 1,
  abilities: {
    method: 'manual',
    assignment: { str: 8, dex: 14, con: 13, int: 10, wis: 12, cha: 15 },
  },
  abilityIncreases: { con: 2, int: 1 },
  classSkills: ['persuasion', 'performance', 'deception'],
  featureChoices: { 'human:skillful': ['perception'] },
  cantrips: ['dancing-lights', 'vicious-mockery'],
  preparedSpells: ['cure-wounds', 'charm-person', 'healing-word', 'faerie-fire'],
});

const rogue = (name: string): CharacterChoices => ({
  ...common,
  name,
  classId: 'rogue',
  level: 1,
  abilities: {
    method: 'standard-array',
    assignment: { str: 8, dex: 15, con: 13, int: 14, wis: 12, cha: 10 },
  },
  abilityIncreases: { con: 2, int: 1 },
  classSkills: ['stealth', 'sleight-of-hand', 'acrobatics', 'investigation'],
  featureChoices: {
    'human:skillful': ['perception'],
    'rogue:expertise': ['stealth', 'sleight-of-hand'],
  },
});

const at = (who: CharacterId, from: CharacterId, feet: number, bearing = 90): GameEvent => ({
  type: 'creature-placed',
  id: who,
  placement: { from: { creature: from }, feet, bearing },
});

const sees = (from: CharacterId, to: CharacterId, seen = true): GameEvent => ({
  type: 'sight-declared',
  from,
  to,
  seen,
});

interface Supply {
  readonly issuer: RollIssuer;
  readonly rng: Rng;
  readonly content: Content;
}

const supply = (seed = 'inspire'): Supply => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

const made = (content: Content, choices: CharacterChoices, who: CharacterId): GameEvent[] =>
  unwrap(createCharacter(content, choices, who), `create ${who}`) as GameEvent[];

class Game {
  state: GameState;
  private readonly log: GameEvent[];

  constructor(log: readonly GameEvent[]) {
    this.log = [...log];
    this.state = fold('inspire', this.log);
  }

  push(events: readonly GameEvent[]): void {
    this.log.push(...events);
    this.state = fold('inspire', this.log);
  }

  held(who: CharacterId): readonly { source: string; from: CharacterId }[] {
    return (this.state.creatures[who]?.grantedReactions ?? []).map((g) => ({
      source: g.source,
      from: g.from,
    }));
  }

  left(who: CharacterId, key: string): number {
    return remaining(this.state.creatures[who]!.resources, key);
  }
}

const SCENE: GameEvent[] = [
  { type: 'scene-set', extent: { width: 2000, depth: 2000, height: 40 } },
  { type: 'landmark-added', name: 'the hall', at: { x: 500, y: 500, z: 0 } },
  { type: 'creature-placed', id: ILVA, placement: { from: { landmark: 'the hall' }, feet: 0 } },
];

const party = (): GameEvent[] => [
  ...made(SRD_CONTENT, bard('Ilva'), ILVA),
  ...made(SRD_CONTENT, rogue('Nyx'), NYX),
  ...made(SRD_CONTENT, rogue('Bram'), BRAM),
  ...SCENE,
  at(NYX, ILVA, 30),
  at(BRAM, ILVA, 30, 270),
  sees(NYX, ILVA),
  sees(BRAM, ILVA),
];

const INSPIRATION = 'bard:bardic-inspiration';

describe('conferring a Bardic Inspiration die', () => {
  it('spends the Bard’s own use and hangs a grant on the ally', () => {
    const g = new Game(party());
    const before = g.left(ILVA, 'bardic-inspiration');
    expect(before).toBeGreaterThan(0);

    const out = unwrap(
      conferReaction(g.state, ILVA, { feature: INSPIRATION, target: NYX }),
      'confer',
    );
    g.push(out.events);

    expect(g.left(ILVA, 'bardic-inspiration')).toBe(before - 1);
    expect(g.held(NYX)).toEqual([{ source: `feature:${INSPIRATION}@${ILVA}`, from: ILVA }]);
    // Nothing is taken from the holder, and the holder has no pool at all.
    expect(g.held(ILVA)).toEqual([]);
  });

  /**
   * The die is read off the Bard's class table **at conferral** and pinned
   * into the event, so an ally still holding it when the Bard reaches level 5
   * holds the d6 they were given rather than the d8 the table now prints.
   */
  it('pins the die size the Bard had when they gave it', () => {
    const g = new Game(party());
    g.push(unwrap(conferReaction(g.state, ILVA, { feature: INSPIRATION, target: NYX }), 'confer').events);

    const grant = g.state.creatures[NYX]?.grantedReactions[0];
    expect(grant?.reaction.does.kind).toBe('intervene');
    if (grant?.reaction.does.kind === 'intervene') {
      expect(grant.reaction.does.amount.dice).toBe('1d6');
      expect(grant.reaction.does.direction).toBe('bonus');
      expect(grant.reaction.does.outcome).toBe('failure');
      expect([...grant.reaction.does.tests].sort()).toEqual(['ability-check', 'saving-throw']);
    }
    expect(grant?.reaction.costsReaction).toBe(false);
    expect(grant?.reaction.pool).toBeNull();
  });

  it('is refused past its range, and asks where somebody is standing when nobody has said', () => {
    const g = new Game([
      ...made(SRD_CONTENT, bard('Ilva'), ILVA),
      ...made(SRD_CONTENT, rogue('Nyx'), NYX),
      ...SCENE,
      at(NYX, ILVA, 65),
    ]);
    const far = conferReaction(g.state, ILVA, { feature: INSPIRATION, target: NYX });
    expect(isErr(far) ? far.code : 'ok').toBe('out_of_reach');

    const unplaced = new Game([
      ...made(SRD_CONTENT, bard('Ilva'), ILVA),
      ...made(SRD_CONTENT, rogue('Bram'), BRAM),
      ...SCENE,
    ]);
    const asked = conferReaction(unplaced.state, ILVA, { feature: INSPIRATION, target: BRAM });
    expect(isErr(asked) ? asked.code : 'ok').toBe('unplaced');
  });

  /**
   * SRD: "another creature ... who can see or hear you". Sight is declared and
   * hearing is not, so a creature declared unable to see the Bard may still
   * hear them: the conferral is made and the line is reported.
   */
  it('reports the sense it cannot check rather than refusing', () => {
    const g = new Game([
      ...made(SRD_CONTENT, bard('Ilva'), ILVA),
      ...made(SRD_CONTENT, rogue('Nyx'), NYX),
      ...SCENE,
      at(NYX, ILVA, 30),
      sees(NYX, ILVA, false),
    ]);
    const out = unwrap(conferReaction(g.state, ILVA, { feature: INSPIRATION, target: NYX }), 'confer');
    expect(out.unverified.join(' ')).toContain('hear');
    g.push(out.events);
    expect(g.held(NYX)).toHaveLength(1);

    // And says nothing where the sense it *can* check is satisfied.
    const seen = new Game(party());
    const quiet = unwrap(conferReaction(seen.state, ILVA, { feature: INSPIRATION, target: NYX }), 'confer');
    expect(quiet.unverified).toEqual([]);
  });

  it('refuses the Bard themselves, and refuses when the pool is empty', () => {
    const g = new Game(party());
    const self = conferReaction(g.state, ILVA, { feature: INSPIRATION, target: ILVA });
    expect(isErr(self) ? self.code : 'ok').toBe('not_another_creature');

    const drained = new Game(party());
    for (let n = drained.left(ILVA, 'bardic-inspiration'); n > 0; n -= 1) {
      drained.push(
        unwrap(conferReaction(drained.state, ILVA, { feature: INSPIRATION, target: NYX }), 'confer')
          .events,
      );
    }
    const empty = conferReaction(drained.state, ILVA, { feature: INSPIRATION, target: NYX });
    expect(isErr(empty) ? empty.code : 'ok').toBe('exhausted');
  });

  it('is idempotent under one command id', () => {
    const g = new Game(party());
    const uses = g.left(ILVA, 'bardic-inspiration');
    const first = unwrap(
      conferReaction(g.state, ILVA, { feature: INSPIRATION, target: NYX, commandId: 'c1' }),
      'confer',
    );
    g.push(first.events);
    const again = unwrap(
      conferReaction(g.state, ILVA, { feature: INSPIRATION, target: NYX, commandId: 'c1' }),
      'again',
    );
    expect(again.events).toEqual([]);
    g.push(again.events);
    expect(g.left(ILVA, 'bardic-inspiration')).toBe(uses - 1);
  });

  /**
   * The replace-not-stack rule every sourced grant keeps: the source is the
   * identity, and the source carries **who gave it**, so one Bard's second die
   * replaces their first and two Bards' dice stand together.
   */
  it('replaces its own and stands beside another Bard’s', () => {
    const g = new Game([
      ...party(),
      ...made(SRD_CONTENT, bard('Sel'), SEL),
      at(SEL, ILVA, 10, 180),
      sees(NYX, SEL),
    ]);
    const uses = g.left(ILVA, 'bardic-inspiration');
    g.push(unwrap(conferReaction(g.state, ILVA, { feature: INSPIRATION, target: NYX }), 'one').events);
    g.push(unwrap(conferReaction(g.state, ILVA, { feature: INSPIRATION, target: NYX }), 'two').events);
    // Two uses gone, one die held: what replaces is the grant, never the cost.
    expect(g.held(NYX)).toHaveLength(1);
    expect(g.left(ILVA, 'bardic-inspiration')).toBe(uses - 2);

    g.push(unwrap(conferReaction(g.state, SEL, { feature: INSPIRATION, target: NYX }), 'three').events);
    expect(g.held(NYX).map((h) => h.from).sort()).toEqual([ILVA, SEL]);
  });

  /** SRD: "Once within the next hour". The hour is a `grants` deadline. */
  it('is gone an hour later', () => {
    const g = new Game(party());
    g.push(unwrap(conferReaction(g.state, ILVA, { feature: INSPIRATION, target: NYX }), 'confer').events);
    expect(g.held(NYX)).toHaveLength(1);

    g.push(unwrap(advanceTime(g.state, 3599, 'most of an hour'), 'nearly'));
    expect(g.held(NYX)).toHaveLength(1);
    g.push(unwrap(advanceTime(g.state, 1, 'the last second'), 'the hour'));
    expect(g.held(NYX)).toHaveLength(0);
  });
});

describe('the die in the ally’s hand', () => {
  const conferred = (): Game => {
    const g = new Game(party());
    g.push(unwrap(conferReaction(g.state, ILVA, { feature: INSPIRATION, target: NYX }), 'confer').events);
    return g;
  };

  /** What the Bard has left the moment after giving one die away. */
  const PAID = new Game(party()).left(ILVA, 'bardic-inspiration') - 1;

  it('is offered on the holder’s own failed check and failed save, and not on a success', () => {
    const g = conferred();
    const failed = offersForTest(g.state, { who: NYX, kind: 'ability-check', success: false });
    expect(failed.offers.map((o) => o.feature)).toEqual([INSPIRATION]);
    expect(failed.offers[0]?.costsReaction).toBe(false);
    expect(failed.offers[0]?.granted?.from).toBe(ILVA);

    const saved = offersForTest(g.state, { who: NYX, kind: 'saving-throw', success: false });
    expect(saved.offers.map((o) => o.feature)).toEqual([INSPIRATION]);

    const won = offersForTest(g.state, { who: NYX, kind: 'ability-check', success: true });
    expect(won.offers).toEqual([]);

    // And it is the holder's alone: nobody else is offered somebody's die.
    const elsewhere = offersForTest(g.state, { who: BRAM, kind: 'ability-check', success: false });
    expect(elsewhere.offers).toEqual([]);
  });

  it('adds its die to the failed test and is expended by the use', () => {
    const g = conferred();
    const test = unwrap(
      resolveTest(g.state, NYX, { kind: 'ability-check', ability: 'str', dc: 30 }, supply()),
      'check',
    );
    expect(test.test?.success).toBe(false);
    expect(test.offers.map((o) => o.feature)).toEqual([INSPIRATION]);
    g.push(test.events);

    const before = test.test!.total;
    const pushed = unwrap(
      takeTestReaction(g.state, NYX, { feature: INSPIRATION }, supply('die')),
      'use',
    );
    const added = pushed.test!.total - before;
    expect(added).toBeGreaterThanOrEqual(1);
    expect(added).toBeLessThanOrEqual(6);
    g.push(pushed.events);

    // Expended by the use, whatever it did — and the Bard's pool is untouched,
    // because the Bard paid at the moment they gave it away.
    expect(g.held(NYX)).toHaveLength(0);
    expect(g.left(ILVA, 'bardic-inspiration')).toBe(PAID);
    expect(pushed.events.some((e) => e.type === 'resource-spent')).toBe(false);

    const after = offersForTest(g.state, { who: NYX, kind: 'ability-check', success: false });
    expect(after.offers).toEqual([]);
  });

  /**
   * "Naming nobody takes the first in the order the offers were listed in",
   * which is a rule rather than a fixture: the fold sorts granted Reactions by
   * source and `byFeature` breaks a tie on the same key, so the ally holding
   * two dice spends a settled one and the other stands.
   */
  it('spends the first of two when the holder names no giver', () => {
    const g = new Game([
      ...party(),
      ...made(SRD_CONTENT, bard('Sel'), SEL),
      at(SEL, ILVA, 10, 180),
      sees(NYX, SEL),
    ]);
    g.push(unwrap(conferReaction(g.state, ILVA, { feature: INSPIRATION, target: NYX }), 'one').events);
    g.push(unwrap(conferReaction(g.state, SEL, { feature: INSPIRATION, target: NYX }), 'two').events);

    g.push(
      unwrap(
        resolveTest(g.state, NYX, { kind: 'ability-check', ability: 'str', dc: 30 }, supply()),
        'check',
      ).events,
    );
    g.push(
      unwrap(takeTestReaction(g.state, NYX, { feature: INSPIRATION }, supply('die')), 'use').events,
    );

    // ILVA's source sorts before SEL's, so ILVA's die is the one spent.
    expect(g.held(NYX).map((h) => h.from)).toEqual([SEL]);
  });

  it('is spent by the holder from whichever Bard gave it, and the other stands', () => {
    const g = new Game([
      ...party(),
      ...made(SRD_CONTENT, bard('Sel'), SEL),
      at(SEL, ILVA, 10, 180),
      sees(NYX, SEL),
    ]);
    g.push(unwrap(conferReaction(g.state, ILVA, { feature: INSPIRATION, target: NYX }), 'one').events);
    g.push(unwrap(conferReaction(g.state, SEL, { feature: INSPIRATION, target: NYX }), 'two').events);

    g.push(
      unwrap(
        resolveTest(g.state, NYX, { kind: 'ability-check', ability: 'str', dc: 30 }, supply()),
        'check',
      ).events,
    );
    g.push(
      unwrap(
        takeTestReaction(g.state, NYX, { feature: INSPIRATION, from: SEL }, supply('die')),
        'use',
      ).events,
    );

    expect(g.held(NYX).map((h) => h.from)).toEqual([ILVA]);
  });
});

/**
 * The vocabulary, not the Bard: a homebrew class whose pool hands a die out,
 * created and used through the public API with no engine change.
 */
describe('a homebrew pool that confers a Reaction', () => {
  const WARDEN = JSON.stringify({
    id: 'warden',
    name: 'Warden',
    primaryAbility: 'wis',
    hitDie: 10,
    saveProficiencies: ['wis', 'con'],
    skillChoices: { choose: 2, from: ['athletics', 'survival', 'insight', 'nature'] },
    weaponProficiencies: ['simple', 'martial'],
    armorTraining: { light: true, medium: true, heavy: false, shields: true },
    subclassLevel: 3,
    table: Array.from({ length: 20 }, (_, i) => ({
      level: i + 1,
      proficiencyBonus: 2 + Math.floor(i / 4),
    })),
    startingEquipment: [{ option: 'A', items: [{ id: 'longsword', quantity: 1 }], goldPieces: 10 }],
    multiclass: {
      weapons: ['martial'],
      armorTraining: { light: true, medium: true, heavy: false, shields: true },
      tools: [],
    },
    features: [
      {
        id: 'warden:watchword',
        name: 'Watchword',
        level: 1,
        automation: 'engine',
        note: 'Three uses a Long Rest. One use hands a companion within thirty feet a d4 they may add to a failed saving throw within the minute.',
        grants: {
          kind: 'pool',
          key: 'watchword',
          label: 'Watchword',
          usesByLevel: Array.from({ length: 20 }, () => 3),
          recovers: 'long-rest',
          confersReaction: {
            action: 'bonus-action',
            range: 30,
            durationSeconds: 60,
            excludesSelf: true,
            requiresSightOrHearing: true,
            costsReaction: false,
            reach: { kind: 'self' },
            does: [
              {
                kind: 'intervene',
                amount: { dice: '1d4' },
                direction: 'bonus',
                tests: ['saving-throw'],
                outcome: 'failure',
              },
            ],
          },
        },
      },
    ],
  });

  const warden = (): CharacterChoices => ({
    ...common,
    name: 'Orla',
    classId: 'warden',
    level: 1,
    abilities: {
      method: 'standard-array',
      assignment: { str: 15, dex: 14, con: 13, int: 8, wis: 12, cha: 10 },
    },
    abilityIncreases: { con: 2, wis: 1 },
    classSkills: ['athletics', 'survival'],
    featureChoices: { 'human:skillful': ['perception'] },
  });

  const ORLA = id('orla');

  /**
   * The one promise this shape could make and not keep.
   *
   * SRD Peerless Skill spends a *pool* use and gets it back on a failure; a
   * conferred Reaction spends the grant, and a grant that came back would be a
   * die given away twice. So the flag is refused where it cannot be honoured,
   * rather than accepted and ignored — the guard `oneShotProblem` already puts
   * on a modifier that promises an ending nothing keeps.
   */
  it('refuses a refund it could not pay', () => {
    const greedy = JSON.parse(WARDEN) as {
      features: { grants: { confersReaction: { does: { refundedOnFailure?: boolean }[] } } }[];
    };
    greedy.features[0]!.grants.confersReaction.does[0]!.refundedOnFailure = true;

    const parsed = parseClassDefinition(greedy);
    expect(isErr(parsed) ? parsed.reason : 'ok').toContain('refund');
  });

  it('is parsed, created and used with nothing in the engine naming it', () => {
    const parsed = unwrap(parseClassDefinition(JSON.parse(WARDEN)), 'parse');
    const content = unwrap(extendContent(SRD_CONTENT, { classes: [parsed] }), 'extend');

    const g = new Game([
      ...made(content, warden(), ORLA),
      ...made(SRD_CONTENT, rogue('Nyx'), NYX),
      { type: 'scene-set', extent: { width: 2000, depth: 2000, height: 40 } },
      { type: 'landmark-added', name: 'the wood', at: { x: 500, y: 500, z: 0 } },
      { type: 'creature-placed', id: ORLA, placement: { from: { landmark: 'the wood' }, feet: 0 } },
      at(NYX, ORLA, 20),
      sees(NYX, ORLA),
    ]);

    g.push(
      unwrap(conferReaction(g.state, ORLA, { feature: 'warden:watchword', target: NYX }), 'confer')
        .events,
    );
    expect(g.left(ORLA, 'watchword')).toBe(2);
    expect(g.held(NYX)).toHaveLength(1);

    // It answers a save and not a check, because that is what it said.
    expect(offersForTest(g.state, { who: NYX, kind: 'ability-check', success: false }).offers)
      .toEqual([]);
    const save = offersForTest(g.state, { who: NYX, kind: 'saving-throw', success: false });
    expect(save.offers.map((o) => o.feature)).toEqual(['warden:watchword']);

    const rolled = unwrap(
      resolveTest(g.state, NYX, { kind: 'saving-throw', ability: 'wis', dc: 30 }, supply()),
      'save',
    );
    g.push(rolled.events);
    const pushed = unwrap(
      takeTestReaction(g.state, NYX, { feature: 'warden:watchword' }, supply('d4')),
      'use',
    );
    const added = pushed.test!.total - rolled.test!.total;
    expect(added).toBeGreaterThanOrEqual(1);
    expect(added).toBeLessThanOrEqual(4);
    g.push(pushed.events);
    expect(g.held(NYX)).toHaveLength(0);

    // And its minute is its own, not the Bard's hour.
    const again = new Game([
      ...made(content, warden(), ORLA),
      ...made(SRD_CONTENT, rogue('Nyx'), NYX),
      { type: 'scene-set', extent: { width: 2000, depth: 2000, height: 40 } },
      { type: 'landmark-added', name: 'the wood', at: { x: 500, y: 500, z: 0 } },
      { type: 'creature-placed', id: ORLA, placement: { from: { landmark: 'the wood' }, feet: 0 } },
      at(NYX, ORLA, 20),
      sees(NYX, ORLA),
    ]);
    again.push(
      unwrap(conferReaction(again.state, ORLA, { feature: 'warden:watchword', target: NYX }), 'confer')
        .events,
    );
    again.push(unwrap(advanceTime(again.state, 60, 'a minute'), 'minute'));
    expect(again.held(NYX)).toHaveLength(0);
  });
});
