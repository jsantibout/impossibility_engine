import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, isErr, expect as unwrap } from '@ie/shared';
import {
  createCharacter,
  createRng,
  createRollIssuer,
  fold,
  takeDash,
  takeHide,
  takeUtilize,
  type CharacterChoices,
  type GameEvent,
  type NamedAction,
  type GameState,
} from '@ie/engine';

/**
 * Two allowances for one pair, and which one a creature pays.
 *
 * An Orc Rogue 2 holds both of the SRD sentences that move a Dash to a Bonus
 * Action, and they are not the same offer:
 *
 * > Adrenaline Rush: "You can take the Dash action as a Bonus Action. When you
 * > do so, you gain a number of Temporary Hit Points equal to your Proficiency
 * > Bonus. You can use this trait a number of times equal to your Proficiency
 * > Bonus."
 * > Cunning Action: "you can take one of the following actions as a Bonus
 * > Action: Dash, Disengage, or Hide." — free, and unlimited.
 *
 * `allowsPrice` returned the first rule that matched the pair and the command
 * charged it, so this Rogue paid the Orc's use every time and was then
 * **refused** `exhausted` an action the Rogue's own feature gives them for
 * nothing. The order was a fact about how the sheet happened to be compiled.
 *
 * The rule now is the only default that can never take something away: the
 * cheapest allowance that reaches the pair, with the caller able to name the
 * other one when they want what it buys.
 */

const id = (s: string) => asCharacterId(s);
const KRUSK = id('krusk');

const orcRogue = (): CharacterChoices => ({
  name: 'Krusk',
  classId: 'rogue',
  level: 2,
  speciesId: 'orc',
  backgroundId: 'sage',
  abilities: {
    method: 'standard-array',
    assignment: { str: 12, dex: 15, con: 14, int: 13, wis: 10, cha: 8 },
  },
  abilityIncreases: { con: 2, int: 1 },
  classSkills: ['stealth', 'acrobatics', 'perception', 'insight'],
  languages: ['Dwarvish', 'Orc'],
  alignment: 'Chaotic Neutral',
  cantrips: [],
  spellbook: [],
  preparedSpells: [],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: [],
  hitPoints: { method: 'fixed' },
  featureChoices: { 'rogue:expertise': ['stealth', 'acrobatics'] },
  feats: {
    'sage:magic-initiate-wizard': {
      featId: 'magic-initiate',
      spellList: 'wizard',
      spellcastingAbility: 'int',
      cantrips: ['mage-hand', 'light'],
      levelOneSpell: 'find-familiar',
    },
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
});

const fighting = (): readonly GameEvent[] => [
  ...(unwrap(createCharacter(SRD_CONTENT, orcRogue(), KRUSK), 'create') as GameEvent[]),
  { type: 'combat-started', combatants: [{ id: KRUSK, initiative: 20, speed: 30 }] },
];

const rushOf = (state: GameState) => state.creatures.krusk!.resources.pools['orc:adrenaline-rush']!;
const tempHpOf = (state: GameState) => state.creatures.krusk!.vitals.temporaryHp ?? 0;

const dashing = (
  log: readonly GameEvent[],
  options: Parameters<typeof takeDash>[3],
  commandId: string,
): readonly GameEvent[] => [
  ...log,
  ...unwrap(takeDash(fold('seed', log), KRUSK, { commandId }, options), 'dash'),
];

/**
 * The other half of `usingFeature`: an action paid for out of an extra the
 * turn was handed, rather than out of a cheaper slot.
 *
 * All five commands that can name a grant read it the same way — `takeDash`,
 * `takeDisengage`, `takeDodge`, `takeHide` and `takeUtilize` — and the last two
 * are here because they are the two the tool door publishes the field for and
 * the two that had quietly ignored it. The grant is written directly, through
 * the event a bought pair emits, because no SRD allowance bundles a Hide or a
 * Utilize yet and the branch is the same code either way.
 */
describe('an action spent out of an extra the turn was handed', () => {
  const handed = (only: readonly NamedAction[]): readonly GameEvent[] => [
    ...fighting(),
    { type: 'turn-budget-granted', id: KRUSK, source: 'a-feature', action: { only } },
  ];

  const supply = (state: GameState) => ({
    issuer: createRollIssuer('r', state.rollsIssued),
    rng: createRng('hide'),
    content: SRD_CONTENT,
  });

  it('spends the grant on a Utilize and leaves the turn’s own Action', () => {
    const log = handed(['utilize']);
    const events = unwrap(
      takeUtilize(fold('seed', log), KRUSK, {
        commandId: 'lever',
        object: 'the lever',
        usingFeature: 'a-feature',
      }),
      'utilize',
    );
    // The spend names the grant, so the reducer performs the same one.
    expect(events.find((one) => one.type === 'action-spent')).toEqual({
      type: 'action-spent',
      id: KRUSK,
      grant: 'a-feature',
    });
    const after = fold('seed', [...log, ...events]);
    expect(after.combat!.budgets[KRUSK]!.action).toBe(true);
    expect(after.combat!.budgets[KRUSK]!.extraActions).toEqual([]);
  });

  it('refuses a Utilize that names a grant narrowed to something else', () => {
    const state = fold('seed', handed(['hide']));
    const refused = takeUtilize(state, KRUSK, { commandId: 'lever', usingFeature: 'a-feature' });
    expect(isErr(refused) && refused.code).toBe('action_forbidden');
    expect(state.combat!.budgets[KRUSK]!.action).toBe(true);
  });

  it('spends the grant on a Hide and leaves the turn’s own Action', () => {
    const log = handed(['hide']);
    const state = fold('seed', log);
    const out = unwrap(
      takeHide(
        state,
        KRUSK,
        { commandId: 'duck', obscured: true, usingFeature: 'a-feature' },
        supply(state),
      ),
      'hide',
    );
    expect(out.events.find((one) => one.type === 'action-spent')).toEqual({
      type: 'action-spent',
      id: KRUSK,
      grant: 'a-feature',
    });
    const after = fold('seed', [...log, ...out.events]);
    expect(after.combat!.budgets[KRUSK]!.action).toBe(true);
    expect(after.combat!.budgets[KRUSK]!.extraActions).toEqual([]);
  });

  it('refuses a Hide that names a grant narrowed to something else', () => {
    const state = fold('seed', handed(['utilize']));
    const refused = takeHide(
      state,
      KRUSK,
      { commandId: 'duck', obscured: true, usingFeature: 'a-feature' },
      supply(state),
    );
    expect(isErr(refused) && refused.code).toBe('action_forbidden');
    expect(state.combat!.budgets[KRUSK]!.action).toBe(true);
  });

  /** A grant nobody handed over is the other refusal, and says so. */
  it('refuses either when nothing handed the turn anything', () => {
    const state = fold('seed', fighting());
    const refused = takeUtilize(state, KRUSK, { commandId: 'lever', usingFeature: 'a-feature' });
    expect(isErr(refused) && refused.code).toBe('no_such_grant');
  });
});

describe('a creature holding a free allowance and a priced one for the same pair', () => {
  it('really holds both, which is what makes the question real', () => {
    const sheet = fold('seed', fighting()).creatures.krusk!.sheet;
    const sources = (sheet.standing ?? [])
      .filter((one) => one.grant.kind === 'action-rule')
      .map((one) => one.feature);
    expect(sources).toContain('orc:adrenaline-rush');
    expect(sources).toContain('rogue:cunning-action');
  });

  /** The default: the free one, and the Orc's uses untouched. */
  it('Dashes for nothing when nobody names an allowance', () => {
    const after = fold('seed', dashing(fighting(), { from: 'bonus-action' }, 'run'));
    expect(rushOf(after).spent).toBe(0);
    expect(tempHpOf(after)).toBe(0);
    expect(after.combat!.budgets[KRUSK]!.bonusAction).toBe(false);
  });

  /** And the priced one on request, because the Temporary Hit Points are why. */
  it('spends the trait when the Orc asks for what it pays', () => {
    const after = fold(
      'seed',
      dashing(fighting(), { from: 'bonus-action', usingFeature: 'orc:adrenaline-rush' }, 'rush'),
    );
    expect(rushOf(after).spent).toBe(1);
    // A Rogue 2's Proficiency Bonus is 2.
    expect(tempHpOf(after)).toBe(2);
  });

  /**
   * The defect, from the other end: with the trait's uses gone the Rogue's own
   * free sentence still stands, and only the *named* one is refused.
   */
  it('still Dashes for nothing once the trait is spent, and refuses only the named one', () => {
    const drained: readonly GameEvent[] = [
      ...fighting(),
      { type: 'resource-spent', id: KRUSK, key: 'orc:adrenaline-rush', amount: 2 },
    ];
    const state = fold('seed', drained);
    expect(rushOf(state).max - rushOf(state).spent).toBe(0);

    const refused = takeDash(state, KRUSK, { commandId: 'rush' }, {
      from: 'bonus-action',
      usingFeature: 'orc:adrenaline-rush',
    });
    expect(isErr(refused) && refused.code).toBe('exhausted');

    const free = fold('seed', dashing(drained, { from: 'bonus-action' }, 'run'));
    expect(free.combat!.budgets[KRUSK]!.bonusAction).toBe(false);
    expect(tempHpOf(free)).toBe(0);
  });

  /** An allowance this creature does not hold is a refusal naming it. */
  it('refuses an allowance the creature was never granted', () => {
    const refused = takeDash(fold('seed', fighting()), KRUSK, { commandId: 'run' }, {
      from: 'bonus-action',
      usingFeature: 'monk:focus',
    });
    expect(isErr(refused) && refused.code).toBe('no_such_allowance');
  });
});
