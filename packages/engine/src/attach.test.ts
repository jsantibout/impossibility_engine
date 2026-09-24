import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, type CharacterId, expect as unwrap, type Result } from '@ie/shared';
import {
  addCreature,
  addSceneLandmark,
  beginCombat,
  declareCreatureSide,
  detachFrom,
  escapeGrapple,
  letGoOfAttachment,
  placeCreatureInScene,
  resolveAttack,
  resolveMove,
  resolveTurn,
  setScene,
} from './commands.js';
import { createCharacter, type CharacterChoices } from './creation.js';
import { createRng, type Rng } from './dice.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { createRollIssuer } from './rolls.js';
import { speedOf } from './standing.js';
import { attachmentsOf, attachmentsOn, grapplesOn } from './commands/unarmed.js';

/**
 * **A creature that fixes itself to the one it hit**, which is not a grapple
 * and is not a condition.
 *
 * SRD Stirge: "the stirge attaches to the target. While attached, the stirge
 * can't make Proboscis attacks, and the target takes 5 (2d4) Necrotic damage
 * at the start of each of the stirge's turns." SRD Darkmantle attaches,
 * covers and pins its own Speed at 0.
 *
 * The target is not Grappled by it — it may walk off with the stirge on them —
 * so nothing in `grapplesOn` finds one, and the hold comes off by an Action
 * somebody spends or by five feet of the attacher's own movement, with a check
 * only where the line prints one.
 */

const id = (s: string) => asCharacterId(s);
const BREN = id('bren');
const BEAST = id('beast');
const MATE = id('mate');
const SEED = 'proboscis';

const supply = (seed = SEED) => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

/** A level 1 Fighter for the beasts to land on. */
const walkOn = (name: string): CharacterChoices => ({
  name,
  classId: 'fighter',
  level: 1,
  speciesId: 'human',
  backgroundId: 'sage',
  abilities: {
    method: 'standard-array',
    assignment: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 },
  },
  abilityIncreases: { con: 2, wis: 1 },
  classSkills: ['athletics', 'survival'],
  languages: ['Dwarvish', 'Orc'],
  alignment: 'Neutral',
  cantrips: [],
  spellbook: [],
  preparedSpells: [],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: ['chain-mail'],
  hitPoints: { method: 'fixed' },
  featureChoices: { 'human:skillful': ['perception'], 'fighter:weapon-mastery': [] },
  feats: {
    'sage:magic-initiate-wizard': {
      featId: 'magic-initiate',
      spellList: 'wizard',
      spellcastingAbility: 'int',
      cantrips: ['mage-hand', 'light'],
      levelOneSpell: 'ray-of-sickness',
    },
    'human:versatile': { featId: 'alert' },
    'fighter:fighting-style': { featId: 'archery' },
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
});

/** A log built only out of what the engine produced. */
class Table {
  readonly log: GameEvent[] = [];

  get state(): GameState {
    return fold(SEED, this.log);
  }

  do(step: string, produce: (state: GameState) => Result<readonly GameEvent[]>): GameState {
    this.log.push(...unwrap(produce(this.state), step));
    return this.state;
  }

  did(
    step: string,
    produce: (state: GameState) => Result<{ readonly events: readonly GameEvent[] }>,
  ): GameState {
    this.log.push(...unwrap(produce(this.state), step).events);
    return this.state;
  }
}

/** A fighter, a beast a stated distance away, and a friend beside the fighter. */
const field = (block: string, away = 5, withFriend = false, friendAt = 5): Table => {
  const table = new Table();
  table.do('the fighter arrives', () => createCharacter(SRD_CONTENT, walkOn('Bren'), BREN));
  table.did('the beast arrives', (s) => addCreature(s, SRD_CONTENT, BEAST, block));
  table.do('the field', (s) => setScene(s, { width: 400, depth: 400, height: 100 }));
  table.do('the oak', (s) => addSceneLandmark(s, 'the oak', { x: 200, y: 200, z: 0 }));
  table.do('Bren by the oak', (s) =>
    placeCreatureInScene(s, BREN, { from: { landmark: 'the oak' }, feet: 0 }),
  );
  table.do('the beast nearby', (s) =>
    placeCreatureInScene(s, BEAST, { from: { creature: BREN }, feet: away, bearing: 180 }),
  );
  table.do('Bren’s side', (s) => declareCreatureSide(s, BREN, 'party'));
  table.do('the beast’s side', (s) => declareCreatureSide(s, BEAST, 'wild'));
  if (withFriend) {
    table.do('a friend arrives', () => createCharacter(SRD_CONTENT, walkOn('Mate'), MATE));
    table.do('the friend beside Bren', (s) =>
      placeCreatureInScene(s, MATE, { from: { creature: BREN }, feet: friendAt, bearing: 90 }),
    );
    table.do('the friend’s side', (s) => declareCreatureSide(s, MATE, 'party'));
  }
  table.do('the order', (s) =>
    beginCombat(s, [
      { id: BEAST, initiative: 20, speed: 40 },
      { id: BREN, initiative: 10, speed: 30 },
      ...(withFriend ? [{ id: MATE, initiative: 1, speed: 30 }] : []),
    ]),
  );
  return table;
};

/** A swing with the attack roll forced to land. */
const swing = (
  table: Table,
  action: string,
  options: {
    readonly modes?: readonly 'advantage'[];
    readonly seed?: string;
    readonly commandId?: string;
    readonly holdInsteadOfDamage?: true;
  } = {},
) => {
  const out = unwrap(
    resolveAttack(
      table.state,
      BEAST,
      {
        target: BREN,
        weapon: null,
        action,
        attackBonuses: [{ source: 'forced', flat: 40 }],
        ...(options.modes === undefined ? {} : { modes: options.modes }),
        ...(options.holdInsteadOfDamage === undefined
          ? {}
          : { holdInsteadOfDamage: options.holdInsteadOfDamage }),
        ...(options.commandId === undefined ? {} : { commandId: options.commandId }),
      },
      supply(options.seed ?? SEED),
    ),
    `the ${action}`,
  );
  table.log.push(...out.events);
  return { ...out, state: table.state };
};

const conditionsOn = (state: GameState, who: CharacterId): readonly string[] =>
  state.creatures[who]?.conditions.conditions ?? [];

/** The damage the log says was dealt to somebody, by source. */
const dealtTo = (events: readonly GameEvent[], who: CharacterId) =>
  events.filter((e) => e.type === 'damage-taken' && e.id === who);

/** Every die face the log says was thrown. */
const facesIn = (events: readonly GameEvent[]): readonly unknown[] =>
  events.flatMap((e) => (e.type === 'damage-dice-recorded' ? e.components.flatMap((c) => c.dice) : []));

// — the attach ————————————————————————————————————————————————————————————————

describe('a creature that attaches to the one it hit', () => {
  it('fixes the stirge to Bren without grappling him', () => {
    const table = field('stirge');
    const out = swing(table, 'Proboscis');

    expect(out.attack?.hit).toBe(true);
    // The relation is on the creature that attached, and it names the target.
    expect(attachmentsOf(out.state, BEAST).map((one) => one.to)).toEqual([BREN]);
    expect(attachmentsOn(out.state, BREN).map((one) => one.holder)).toEqual([BEAST]);
    // And it is not a grapple: nothing holds Bren, and he is not Grappled.
    expect(grapplesOn(out.state, BREN)).toEqual([]);
    expect(conditionsOn(out.state, BREN)).not.toContain('grappled');
  });

  /** SRD: the target may walk off with the stirge on them. */
  it('leaves the target free to walk away', () => {
    const table = field('stirge');
    swing(table, 'Proboscis');
    table.did('the stirge’s turn ends', (s) => resolveTurn(s, supply()));
    const moved = table.did('Bren walks', (s) =>
      resolveMove(
        s,
        BREN,
        { placement: { from: { creature: BREN }, feet: 20, bearing: 0 }, commandId: 'walk' },
        supply(),
      ),
    );

    expect(moved.scene).not.toBeNull();
    expect(attachmentsOf(moved, BEAST).map((one) => one.to)).toEqual([BREN]);
  });

  /**
   * SRD Stirge: "the target takes 5 (2d4) Necrotic damage at the start of each
   * of **the stirge's** turns" — the attacher's boundary and not the target's,
   * which is a round apart.
   */
  it('takes its 2d4 out of the target at the start of its own turns', () => {
    const table = field('stirge');
    swing(table, 'Proboscis');

    // Bren's turn first — nothing is owed at his boundary.
    const brensTurn = unwrap(resolveTurn(table.state, supply('t1')), 'the stirge’s turn ends');
    expect(dealtTo(brensTurn.events, BREN)).toEqual([]);
    table.log.push(...brensTurn.events);

    // And round the order to the stirge's, where the line is paid.
    const back = unwrap(resolveTurn(table.state, supply('t2')), 'Bren’s turn ends');
    table.log.push(...back.events);
    const paid = dealtTo(back.events, BREN);
    expect(paid).toHaveLength(1);
    // Two faces of a d4, thrown at the boundary rather than at the hit.
    expect(facesIn(back.events)).toHaveLength(2);
  });

  /**
   * SRD Stirge: "The target or a creature within 5 feet of it can detach the
   * stirge as an action." No check — the line prints none, and inventing a DC
   * would be a roll nobody wrote down.
   */
  it('comes off when a neighbour spends an action on it, and owes nothing after', () => {
    const table = field('stirge', 5, true);
    swing(table, 'Proboscis');
    table.did('the stirge’s turn ends', (s) => resolveTurn(s, supply('a')));
    table.did('Bren’s turn ends', (s) => resolveTurn(s, supply('b')));

    const off = table.did('the friend pulls it off', (s) =>
      detachFrom(s, MATE, { holder: BEAST, from: BREN, commandId: 'pull' }, supply()),
    );
    expect(attachmentsOf(off, BEAST)).toEqual([]);

    // Round to the stirge's turn again: the arrangement went with the hold.
    table.did('the friend’s turn ends', (s) => resolveTurn(s, supply('c')));
    const next = unwrap(resolveTurn(table.state, supply('d')), 'round to the stirge');
    expect(dealtTo(next.events, BREN)).toEqual([]);
  });

  /** SRD: "The stirge can detach itself by spending 5 feet of its movement." */
  it('lets the attacher go for five feet of its own movement', () => {
    const table = field('stirge');
    swing(table, 'Proboscis');
    const before = table.state.combat?.budgets[BEAST]?.movementSpent ?? 0;

    const off = table.do('the stirge lets go', (s) =>
      letGoOfAttachment(s, BEAST, { from: BREN, commandId: 'let go' }),
    );
    expect(attachmentsOf(off, BEAST)).toEqual([]);
    expect(off.combat?.budgets[BEAST]?.movementSpent).toBe(before + 5);
  });

  /**
   * **The ending takes what the hold hung, at both ends.** SRD Stirge files
   * its payment on the stirge and SRD Animated Rug files its on whoever it is
   * holding, so `creature-detached`'s fold releases grants on both creatures
   * — and the boundary's own lapsed-hold filter is not what is being tested
   * here: the grant list itself must be empty.
   */
  it('takes the arrangement off the creature that was collecting it', () => {
    const table = field('stirge', 5, true);
    swing(table, 'Proboscis');
    expect(table.state.creatures[BEAST]?.payouts).toHaveLength(1);

    const off = table.do('the stirge lets go', (s) =>
      letGoOfAttachment(s, BEAST, { from: BREN, commandId: 'let go' }),
    );
    expect(off.creatures[BEAST]?.payouts).toEqual([]);
    expect(off.creatures[BEAST]?.attachments).toEqual([]);
  });

  /** A creature nothing is attached to has nothing to pull off. */
  it('refuses a detach where nothing is attached', () => {
    const table = field('stirge');
    const out = detachFrom(
      table.state,
      BREN,
      { holder: BEAST, from: BREN, commandId: 'pull' },
      supply(),
    );
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe('not_attached');
  });

  /** And SRD's "or a creature within 5 feet of it" is a distance, checked. */
  it('refuses a detach by somebody too far from the creature holding on', () => {
    // The friend is thirty feet off from the start: a move made in the fight
    // would be *declared* and wait on an Opportunity Attack, and where the
    // creature is standing is the only fact this refusal is about.
    const table = field('stirge', 5, true, 30);
    swing(table, 'Proboscis');
    table.did('the stirge’s turn ends', (s) => resolveTurn(s, supply('a')));
    table.did('Bren’s turn ends', (s) => resolveTurn(s, supply('b')));
    const out = detachFrom(table.state, MATE, { holder: BEAST, from: BREN, commandId: 'pull' }, supply());
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe('out_of_reach');
  });
});

// — the darkmantle's cover ————————————————————————————————————————————————————

describe('an attach that covers what it lands on', () => {
  /**
   * SRD Darkmantle: "If the target is a Medium or smaller creature **and the
   * darkmantle had Advantage on the attack roll**, it covers the target, which
   * has the Blinded condition."
   */
  it('blinds a Medium target when the attack roll had Advantage', () => {
    const table = field('darkmantle');
    const out = swing(table, 'Crush', { modes: ['advantage'] });

    expect(out.attack?.roll.mode).toBe('advantage');
    expect(attachmentsOf(out.state, BEAST).map((one) => one.to)).toEqual([BREN]);
    expect(conditionsOn(out.state, BREN)).toContain('blinded');
  });

  /** Without the Advantage it attaches and covers nobody. */
  it('attaches without covering when the roll was ordinary', () => {
    const table = field('darkmantle');
    const out = swing(table, 'Crush');

    expect(out.attack?.roll.mode).toBe('normal');
    expect(attachmentsOf(out.state, BEAST).map((one) => one.to)).toEqual([BREN]);
    expect(conditionsOn(out.state, BREN)).not.toContain('blinded');
  });

  /** SRD Darkmantle: "Its Speed becomes 0" — the darkmantle's own. */
  it('pins the darkmantle’s own Speed at 0 while it is attached', () => {
    const table = field('darkmantle');
    const out = swing(table, 'Crush');
    expect(out.state.creatures[BEAST]?.speedModifiers.some((m) => m.change === 'zero')).toBe(true);
  });

  /**
   * SRD Darkmantle: "A creature can take an action to try to detach the
   * darkmantle from itself, doing so with a successful DC 13 Strength
   * (Athletics) check" — a check where the Stirge's line prints none.
   */
  it('makes a check where the line prints a DC', () => {
    const table = field('darkmantle');
    swing(table, 'Crush');
    // Detaching costs an Action, so it happens on the detacher's own turn.
    table.did('the darkmantle’s turn ends', (s) => resolveTurn(s, supply('d')));
    const out = unwrap(
      detachFrom(table.state, BREN, { holder: BEAST, from: BREN, commandId: 'pull' }, supply()),
      'the detach',
    );
    expect(out.check).not.toBeNull();
    expect(out.check?.dc).toBe(13);
  });

  /**
   * **SRD prints the rule and its exception in one paragraph**: "Its Speed
   * becomes 0 … On its turn, the darkmantle can detach itself by using 5 feet
   * of movement." Measured against the Speed the attach itself pinned, the
   * second sentence could never be taken.
   */
  it('lets the darkmantle go for five feet despite the Speed it pinned at 0', () => {
    const table = field('darkmantle');
    swing(table, 'Crush', { modes: ['advantage'] });
    expect(speedOf(table.state, BEAST)).toBe(0);

    const off = table.do('the darkmantle lets go', (s) =>
      letGoOfAttachment(s, BEAST, { from: BREN, commandId: 'let go' }),
    );
    expect(attachmentsOf(off, BEAST)).toEqual([]);
    // Both ends of the hold released by the one ending: the Speed it pinned
    // on itself, and the Blinded it left on whoever it covered.
    expect(off.creatures[BEAST]?.speedModifiers).toEqual([]);
    expect(speedOf(off, BEAST)).toBeGreaterThan(0);
    expect(conditionsOn(off, BREN)).not.toContain('blinded');
    // And the five feet were charged: SRD says "by **using** 5 feet of
    // movement", so a hold let go of costs the turn what the line prints.
    expect(off.combat?.budgets[BEAST]?.movementSpent).toBe(5);
  });

  /**
   * **What is set aside is this hold's own Speed and not the turn's own
   * budget.** A darkmantle that flew its whole Speed before biting has no
   * movement left to let go with, exactly as a stirge in the same position
   * has none: the book gives it five feet of its own movement and no more.
   */
  it('refuses the darkmantle that has already spent its movement', () => {
    const table = field('darkmantle', 45);
    // The whole of the Speed this fight declared for it, and then the swing
    // that attaches: nothing is left for the line's five feet to come out of.
    table.did('the darkmantle flies in', (s) =>
      resolveMove(
        s,
        BEAST,
        { placement: { from: { creature: BEAST }, feet: 40, bearing: 0 }, commandId: 'fly in' },
        supply(),
      ),
    );
    swing(table, 'Crush');

    const out = letGoOfAttachment(table.state, BEAST, { from: BREN, commandId: 'let go' });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe('not_enough_movement');
  });
});

// — a hold taken instead of the damage ————————————————————————————————————————

describe('a hold the line offers in place of its damage', () => {
  /**
   * SRD Animated Rug of Smothering: "the rug can give it the Grappled
   * condition (escape DC 13) instead of dealing damage. Until the grapple
   * ends, the target has the Blinded and Restrained conditions … and takes 10
   * (2d6 + 3) Bludgeoning damage at the start of each of its turns."
   */
  it('deals no damage, holds, blinds and restrains when the choice is taken', () => {
    const table = field('animated-rug-of-smothering', 10);
    const out = swing(table, 'Smother', { holdInsteadOfDamage: true });

    expect(out.attack?.hit).toBe(true);
    expect(out.damage ?? 0).toBe(0);
    expect(conditionsOn(out.state, BREN)).toContain('grappled');
    expect(conditionsOn(out.state, BREN)).toContain('blinded');
    expect(conditionsOn(out.state, BREN)).toContain('restrained');
  });

  /** And taken as damage it grapples nobody. */
  it('deals its damage and grapples nobody when the choice is not taken', () => {
    const table = field('animated-rug-of-smothering', 10);
    const out = swing(table, 'Smother');

    expect(out.attack?.hit).toBe(true);
    expect(out.damage ?? 0).toBeGreaterThan(0);
    expect(grapplesOn(out.state, BREN)).toEqual([]);
  });

  /** A choice the line does not offer is refused, with nothing spent. */
  it('refuses a hold on a line that offers none', () => {
    const table = field('stirge');
    const out = resolveAttack(
      table.state,
      BEAST,
      {
        target: BREN,
        weapon: null,
        action: 'Proboscis',
        holdInsteadOfDamage: true,
        commandId: 'no offer',
      },
      supply(),
    );
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe('no_hold_offered');
  });

  /**
   * The payment falls at the **target's** boundary, which is what "each of its
   * turns" says by this reader's own convention, and it stops the moment the
   * escape succeeds.
   */
  it('takes its 2d6 + 3 at the start of the held creature’s turns, and stops at the escape', () => {
    const table = field('animated-rug-of-smothering', 10);
    swing(table, 'Smother', { holdInsteadOfDamage: true });

    const brens = unwrap(resolveTurn(table.state, supply('r1')), 'the rug’s turn ends');
    table.log.push(...brens.events);
    expect(dealtTo(brens.events, BREN)).toHaveLength(1);

    // Bren tears free, and the next time his turn comes round he owes nothing.
    table.did('Bren escapes', (s) =>
      escapeGrapple(
        s,
        BREN,
        { ability: 'str', modes: ['advantage'], bonuses: [{ source: 'forced', flat: 40 }], commandId: 'escape' },
        supply(),
      ),
    );
    expect(grapplesOn(table.state, BREN)).toEqual([]);
    table.did('Bren’s turn ends', (s) => resolveTurn(s, supply('r2')));
    const again = unwrap(resolveTurn(table.state, supply('r3')), 'round to Bren');
    expect(dealtTo(again.events, BREN)).toEqual([]);
  });
});
