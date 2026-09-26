/**
 * SRD Command's Approach and Flee: the die is the engine's and the following is
 * the table's.
 *
 * > "The target must succeed on a Wisdom saving throw or follow the command on
 * > its next turn." / "**Approach.** The target moves toward you by the shortest
 * > and most direct route, ending its turn if it moves within 5 feet of you." /
 * > "**Flee.** The target spends its turn moving away from you by the fastest
 * > available means."
 *
 * **Two of the five words were filed as "the save is not rolled", and that was
 * one step too far.** The owner's ruling of 2026-09-25 is that a compulsion is
 * legality the table adjudicates and a compulsion clause is a handover — which
 * says nothing about the *die*. What a failure buys here is a route nobody chose
 * and a turn spent walking it, so the verdict is the whole of what the engine
 * decides: `save.verdictOnly`, the mark SRD Animal Messenger's errand already
 * uses, with the sentence going over beside it.
 *
 * So the engine rolls, reports who resisted and who did not, and hands the
 * walking to whoever is running the table. Nothing is compelled and nothing is
 * performed.
 */

import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap, isErr, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, restoreRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { spellSlotKey } from './resources.js';
import { declaredCasting } from './spellcasting.js';
import { equipItem, resolveSpell, resolveTurn, takeDash } from './commands.js';
import { actionRulesOn } from './standing.js';
import { checkSpellDefinitionValue } from './spell-schema.js';

const id = (s: string) => asCharacterId(s);
const CLERIC = id('cleric');
const THUG = id('thug');

const sheet = (): CharacterSheet => ({
  level: 5,
  abilities: { str: 14, dex: 12, con: 12, int: 10, wis: 16, cha: 12 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'wis',
  weaponProficiencies: ['simple'],
});

const added = (who: CharacterId): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(),
  maxHp: 40,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side: who === CLERIC ? 'party' : 'foes',
});

const SETUP: readonly GameEvent[] = [
  added(CLERIC),
  added(THUG),
  {
    type: 'spellcasting-declared',
    id: CLERIC,
    spellcasting: declaredCasting({ ability: 'wis', classId: 'cleric', prepared: ['command'] }),
  },
  ...[1, 2].map(
    (level): GameEvent => ({
      type: 'resource-pool-declared',
      id: CLERIC,
      pool: { key: spellSlotKey(level), label: `level ${level}`, max: 4, recovers: 'long-rest' },
    }),
  ),
  { type: 'scene-set', extent: { width: 300, depth: 300, height: 40 } },
  { type: 'landmark-added', name: 'the road', at: { x: 100, y: 100, z: 0 } },
  { type: 'creature-placed', id: CLERIC, placement: { from: { landmark: 'the road' }, feet: 0 } },
  { type: 'creature-placed', id: THUG, placement: { from: { creature: CLERIC }, feet: 15 } },
  { type: 'sight-declared', from: CLERIC, to: THUG, seen: true },
];

const supply = (state: GameState, flat: number) => ({
  issuer: createRollIssuer('r', state.rollsIssued),
  rng: (state.rng === null ? createRng('word') : restoreRng(state.rng)) as Rng,
  content: SRD_CONTENT,
  bonuses: [{ source: 'the test insists', flat }],
});

/** One word spoken, with the save forced either way. */
const speak = (option: string, flat: number) => {
  const state = fold('word', SETUP);
  return unwrap(
    resolveSpell(state, CLERIC, { spellId: 'command', targets: [THUG], option } as never, supply(state, flat)),
    option,
  );
};

describe('SRD Command: a verdict-only save for the two words nobody performs', () => {
  it('rolls the Wisdom save for Approach and reports who failed it', () => {
    const out = speak('approach', -40);
    const rolls = out.events.filter((event) => event.type === 'roll-recorded');

    expect(rolls).toHaveLength(1);
    expect(out.outcomes.map((one) => one.target)).toEqual([THUG]);
    expect(out.outcomes[0]?.save?.success).toBe(false);
  });

  it('rolls it for Flee too, and a made save is reported as made', () => {
    const out = speak('flee', 40);
    expect(out.events.filter((event) => event.type === 'roll-recorded')).toHaveLength(1);
    expect(out.outcomes[0]?.save?.success).toBe(true);
  });

  it('hands the walking over and compels nothing', () => {
    const out = speak('approach', -40);
    const said = out.unverified.join('\n');

    expect(said).toContain('shortest and most direct route');
    // Nothing is applied, nothing is spent, nothing is granted: the failure's
    // whole content is the answer the die gave.
    const after = fold('word', [...SETUP, ...out.events]);
    expect(after.creatures[THUG]?.conditions.instances ?? []).toEqual([]);
    expect(after.creatures[THUG]?.actionRules ?? []).toEqual([]);
  });

  it('speaks the word that was spoken and no other', () => {
    expect(speak('flee', -40).unverified.join('\n')).not.toContain('shortest and most direct');
    expect(speak('approach', -40).unverified.join('\n')).not.toContain('fastest available means');
  });
});

// — Drop and Grovel: a word obeyed on the target's next turn (W7-S22) —————————

/**
 * > "The target must succeed on a Wisdom saving throw or follow the command
 * > **on its next turn**." / "**Drop.** The target drops whatever it is
 * > holding and then ends its turn." / "**Grovel.** The target has the Prone
 * > condition and then ends its turn."
 *
 * The save is rolled at the casting; what a failure buys is **owed** to the
 * goblin's next turn — a `riders-deferred` record the boundary settles as that
 * turn begins. "Then ends its turn" is the goblin's Action and Bonus Action
 * spent through `spends`; its movement is the one slot a spend may not take,
 * so it is left in the budget and the turn is the table's to end.
 */
const FIGHTER = id('fighter');
const GOBLIN = id('goblin');

const withGear = (log: readonly GameEvent[], item: string): readonly GameEvent[] => [
  ...log,
  ...unwrap(equipItem(fold('word', log), SRD_CONTENT, GOBLIN, item), `equip ${item}`),
];

const FIGHT: readonly GameEvent[] = (() => {
  const base: readonly GameEvent[] = [
    ...SETUP,
    added(FIGHTER),
    added(GOBLIN),
    { type: 'items-gained', id: GOBLIN, items: [{ id: 'mace', quantity: 1 }], source: 'its belt' },
    { type: 'items-gained', id: GOBLIN, items: [{ id: 'shield', quantity: 1 }], source: 'its back' },
    { type: 'creature-placed', id: FIGHTER, placement: { from: { creature: CLERIC }, feet: 5, bearing: 90 } },
    { type: 'creature-placed', id: GOBLIN, placement: { from: { creature: CLERIC }, feet: 20, bearing: 180 } },
    { type: 'sight-declared', from: CLERIC, to: GOBLIN, seen: true },
  ];
  return [
    ...withGear(withGear(base, 'mace'), 'shield'),
    {
      type: 'combat-started',
      combatants: [
        { id: CLERIC, initiative: 20, speed: 30 },
        { id: FIGHTER, initiative: 15, speed: 30 },
        { id: GOBLIN, initiative: 10, speed: 30 },
      ],
    },
  ];
})();

const held = (state: GameState): readonly string[] =>
  (state.creatures[GOBLIN]?.equipped ?? []).map((worn) => worn.id).sort();
const proneOf = (state: GameState): boolean =>
  (state.creatures[GOBLIN]?.conditions.conditions ?? []).includes('prone');

/** One word spoken at the goblin in the cleric's turn, the save forced. */
const commanded = (option: string, flat: number): readonly GameEvent[] => {
  const state = fold('word', FIGHT);
  const out = unwrap(
    resolveSpell(
      state,
      CLERIC,
      { spellId: 'command', targets: [GOBLIN], slotLevel: 1, option } as never,
      supply(state, flat),
    ),
    option,
  );
  return [...FIGHT, ...out.events];
};

const advance = (log: readonly GameEvent[]): readonly GameEvent[] => {
  const state = fold('word', log);
  return [...log, ...unwrap(resolveTurn(state, supply(state, 0)), 'turn').events];
};

describe('SRD Command: Drop and Grovel land on the target’s next turn', () => {
  it('Drop leaves the goblin holding its gear until its own turn begins', () => {
    const log = commanded('drop', -40);
    const state = fold('word', log);
    expect(held(state)).toEqual(['mace', 'shield']);
    expect(state.deferredRiders.map((owed) => [owed.target, owed.spell])).toEqual([
      [GOBLIN, 'Command'],
    ]);
    // The fighter's turn comes and goes, and the goblin still holds both.
    const fighters = advance(log);
    expect(held(fold('word', fighters))).toEqual(['mace', 'shield']);
    expect(fold('word', fighters).deferredRiders).toHaveLength(1);
  });

  it('drops it as the goblin’s turn begins, and the turn has nothing left to spend', () => {
    const log = advance(advance(commanded('drop', -40)));
    const state = fold('word', log);
    const combat = state.combat!;
    expect(combat.order[combat.turnIndex]?.id).toBe(GOBLIN);
    expect(held(state)).toEqual([]);
    expect(state.deferredRiders).toEqual([]);
    // "And then ends its turn": the Action and the Bonus Action are gone, the
    // Reaction is not the turn's, and the feet are the one slot a spend may
    // not take — untouched, and the turn is the table's to end.
    const budget = combat.budgets[GOBLIN]!;
    expect(budget.action).toBe(false);
    expect(budget.bonusAction).toBe(false);
    expect(budget.reaction).toBe(true);
    expect(budget.movementSpent).toBe(0);
    const compelled = log.filter((event) => event.type === 'budget-compelled');
    expect(compelled.map((event) => event.type === 'budget-compelled' && event.slot)).toEqual([
      'action',
      'bonus-action',
    ]);
    const dash = takeDash(state, GOBLIN, {});
    expect(isErr(dash) && dash.code).toBe('no_action');
  });

  /**
   * SRD Haste's extra action is a slot `budget-compelled` does not name, so a
   * hasted goblin told to Drop keeps it — and the settlement says so rather
   * than the budget quietly looking spent.
   */
  it('tells the table what a hasted goblin still holds when the word ends its turn', () => {
    const hasted: readonly GameEvent[] = [
      ...commanded('drop', -40),
      {
        type: 'action-rule-granted',
        id: GOBLIN,
        rule: {
          source: 'Haste#cast:77',
          rule: { kind: 'grants', at: 'each-turn', only: ['attack', 'dash', 'disengage', 'hide', 'utilize'] },
          label: 'Haste',
          until: 'the spell ends',
        },
      },
    ];
    const log = advance(hasted);
    const state = fold('word', log);
    const out = unwrap(resolveTurn(state, supply(state, 0)), 'into the goblin’s turn');
    const theirs = fold('word', [...log, ...out.events]);
    expect(held(theirs)).toEqual([]);
    expect(theirs.combat!.budgets[GOBLIN]!.action).toBe(false);
    expect(theirs.combat!.budgets[GOBLIN]!.extraActions).toHaveLength(1);
    expect(out.unverified.join('\n')).toContain('still holds 1 extra action');
  });

  it('Grovel knocks the goblin Prone at its turn and not before', () => {
    const log = commanded('grovel', -40);
    expect(proneOf(fold('word', log))).toBe(false);
    expect(proneOf(fold('word', advance(log)))).toBe(false);
    const theirs = fold('word', advance(advance(log)));
    expect(proneOf(theirs)).toBe(true);
    expect(theirs.combat!.budgets[GOBLIN]!.action).toBe(false);
    expect(theirs.deferredRiders).toEqual([]);
  });

  it('owes nothing to a goblin that made the save', () => {
    const log = commanded('drop', 40);
    expect(fold('word', log).deferredRiders).toEqual([]);
    const theirs = fold('word', advance(advance(log)));
    expect(held(theirs)).toEqual(['mace', 'shield']);
    expect(theirs.combat!.budgets[GOBLIN]!.action).toBe(true);
  });

  it('does not advance into the goblin’s turn without the catalogue to settle the debt', () => {
    const log = advance(commanded('drop', -40));
    const refused = resolveTurn(fold('word', log));
    expect(isErr(refused) && refused.code).toBe('riders_owed');
    // And nothing moved: the debt is still owed and the fighter's turn stands.
    const state = fold('word', log);
    expect(state.combat!.order[state.combat!.turnIndex]?.id).toBe(FIGHTER);
    expect(state.deferredRiders).toHaveLength(1);
  });

  it('asks for a turn order before the die, where there is none to owe the word to', () => {
    const state = fold('word', SETUP);
    const out = resolveSpell(
      state,
      CLERIC,
      { spellId: 'command', targets: [THUG], slotLevel: 1, option: 'drop' } as never,
      supply(state, -40),
    );
    expect(isErr(out) && out.code).toBe('needs_context');
  });

  it('is forgotten with the fight it was owed in', () => {
    const log: readonly GameEvent[] = [...commanded('grovel', -40), { type: 'combat-ended' }];
    expect(fold('word', log).deferredRiders).toEqual([]);
  });

  it('leaves Halt as it was: a rule for the goblin’s next turn, nothing owed', () => {
    const log = commanded('halt', -40);
    const state = fold('word', log);
    expect(state.deferredRiders).toEqual([]);
    expect(actionRulesOn(state, GOBLIN).map((rule) => rule.rule)).toEqual([
      { kind: 'forbids', slots: ['action', 'bonus-action', 'movement'] },
    ]);
  });

  it('refuses a log that settles a debt nobody owed', () => {
    expect(() =>
      fold('word', [...FIGHT, { type: 'deferred-riders-settled', id: GOBLIN, source: 'Command#cast:1' }]),
    ).toThrow(/owes nothing/);
  });
});

describe('a deferral, held at authoring', () => {
  const save = (over: Record<string, unknown>): unknown => ({
    id: 'homebrew-word',
    name: 'Homebrew Word',
    level: 1,
    school: 'enchantment',
    castingTime: 'action',
    concentration: false,
    range: { kind: 'ranged', feet: 60 },
    targets: { count: 1 },
    effects: [{ kind: 'save', ability: 'wis', ...over }],
  });
  const codes = (value: unknown) =>
    checkSpellDefinitionValue(value).map((problem) => problem.code);
  const SPENDS = { slots: ['action', 'bonus-action'], on: 'ending its turn' };

  it('accepts Command’s two words as the catalogue writes them', () => {
    expect(checkSpellDefinitionValue(SRD_CONTENT.spell('command'))).toEqual([]);
    expect(codes(save({ drops: { all: true }, spends: SPENDS, at: 'start-of-targets-next-turn' }))).toEqual([]);
  });

  it('refuses a moment the book does not defer to', () => {
    expect(codes(save({ drops: { all: true }, at: 'end-of-targets-next-turn' }))).toContain('bad_deferral');
  });

  it('refuses a rider the settlement does not land', () => {
    expect(
      codes(
        save({
          at: 'start-of-targets-next-turn',
          drops: { all: true },
          movement: { feet: 10 },
        }),
      ),
    ).toContain('bad_deferral');
  });

  it('refuses a deferral that owes nothing', () => {
    expect(codes(save({ at: 'start-of-targets-next-turn', verdictOnly: true }))).toContain('bad_deferral');
  });

  it('refuses a deferral on a success', () => {
    expect(
      codes(
        save({
          condition: 'prone',
          onSuccessRiders: { at: 'start-of-targets-next-turn', spends: SPENDS },
        }),
      ),
    ).toContain('rider_off_a_success');
  });

  it('counts a spend as something a bare save decides', () => {
    expect(codes(save({ spends: SPENDS }))).not.toContain('save_imposes_nothing');
    expect(codes(save({ spends: SPENDS, verdictOnly: true }))).toContain(
      'verdict_is_not_the_whole_content',
    );
  });
});
