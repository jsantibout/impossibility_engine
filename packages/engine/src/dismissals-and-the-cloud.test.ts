import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap, isErr, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { applyEvent, fold, type GameEvent, type GameState } from './events.js';
import { spellSlotKey } from './resources.js';
import { declaredCasting } from './spellcasting.js';
import { checkSpellDefinitionValue } from './spell-schema.js';
import { speedOf } from './standing.js';
import { flightLost } from './commands/movement.js';
import {
  advanceTime,
  endOngoingSpell,
  endOngoingSpellOnSelf,
  resolveAttack,
  resolveDeclaredCast,
  resolveSpell,
  pendingCastingsOf,
} from './commands.js';

/**
 * A casting dismissed early, in the two arms the SRD prints exceptions for.
 *
 * `endOngoingSpell` is the general dismissal — a caster ends a casting of
 * their own by id and spends nothing, which is what SRD prints for a **Time
 * Span** duration — and every claimant of `a-casting-dismissed-early` prints
 * an exception to it.
 *
 * > SRD Magic Mouth: "When you cast this spell, you can have the spell end
 * > after it delivers its message." A casting that runs "Until dispelled", so
 * > the book gives its caster no free ending at all — unless the caster said
 * > so at the casting.
 * > SRD Gaseous Form: "The spell ends on the target … if it takes a Magic
 * > action to end the spell on itself." The **target** ends it, and the book
 * > charges an action where a dismissal costs none.
 */

const id = (s: string): CharacterId => asCharacterId(s);
const WIZARD = id('wizard');
const WILLING = id('willing');
const ALLY = id('ally');
const FOE = id('foe');

const sheet = (): CharacterSheet => ({
  level: 9,
  abilities: { str: 10, dex: 12, con: 14, int: 18, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'int',
});

const added = (who: CharacterId): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(),
  maxHp: 40,
  diesAtZero: false,
  creatureType: 'Humanoid',
});

const SETUP: readonly GameEvent[] = [
  added(WIZARD),
  added(WILLING),
  added(ALLY),
  added(FOE),
  {
    type: 'spellcasting-declared',
    id: WIZARD,
    spellcasting: declaredCasting({
      ability: 'int',
      classId: 'wizard',
      cantrips: ['fire-bolt'],
      prepared: ['magic-mouth', 'gaseous-form'],
    }),
  },
  {
    type: 'spellcasting-declared',
    id: WILLING,
    spellcasting: declaredCasting({
      ability: 'int',
      classId: 'wizard',
      cantrips: ['fire-bolt'],
      prepared: [],
    }),
  },
  ...[1, 2, 3].map(
    (level): GameEvent => ({
      type: 'resource-pool-declared',
      id: WIZARD,
      pool: {
        key: spellSlotKey(level),
        label: `level ${level} spell slot`,
        max: 3,
        recovers: 'long-rest',
      },
    }),
  ),
  {
    type: 'resource-pool-declared',
    id: WILLING,
    pool: { key: spellSlotKey(1), label: 'level 1 spell slot', max: 3, recovers: 'long-rest' },
  },
  { type: 'items-gained', id: WILLING, items: [{ id: 'club', quantity: 1 }], source: 'the kit' },
  { type: 'scene-set', extent: { width: 200, depth: 200, height: 60 } },
  { type: 'landmark-added', name: 'the study', at: { x: 50, y: 50, z: 0 } },
  { type: 'creature-placed', id: WIZARD, placement: { from: { landmark: 'the study' }, feet: 0 } },
  { type: 'creature-placed', id: WILLING, placement: { from: { creature: WIZARD }, feet: 5, bearing: 0 } },
  { type: 'creature-placed', id: ALLY, placement: { from: { creature: WIZARD }, feet: 5, bearing: 90 } },
  { type: 'creature-placed', id: FOE, placement: { from: { creature: WILLING }, feet: 5, bearing: 90 } },
  { type: 'sight-declared', from: WIZARD, to: WILLING, seen: true },
  { type: 'sight-declared', from: WIZARD, to: ALLY, seen: true },
  { type: 'sight-declared', from: WILLING, to: FOE, seen: true },
];

/**
 * The fight begins **after** the mist, so the cloud is a cloud on its own turn:
 * what is under test is what a creature in gaseous form may spend a turn on,
 * and a wizard casting on somebody else's turn is a different rule.
 */
const THE_FIGHT: GameEvent = {
  type: 'combat-started',
  combatants: [
    { id: WILLING, initiative: 20, speed: 30 },
    { id: WIZARD, initiative: 15, speed: 30 },
    { id: ALLY, initiative: 10, speed: 30 },
    { id: FOE, initiative: 5, speed: 30 },
  ],
};

const supply = (seed = 'cloud') => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

// — SRD Magic Mouth: an ending the caster states at the casting ——————————————

/**
 * A rite of a minute, so the casting is declared, the clock reaches the
 * moment, and `resolveDeclaredCast` settles it under the same id.
 */
const mouth = (stated: boolean): { readonly state: GameState; readonly castingId: string } => {
  const before = fold('seed', SETUP);
  const declared = unwrap(
    resolveSpell(
      before,
      WIZARD,
      {
        spellId: 'magic-mouth',
        targets: [],
        slotLevel: 2,
        ...(stated ? { endsAfterTrigger: true } : {}),
      },
      supply('mouth'),
    ),
    'the rite',
  );
  const open = declared.events.reduce(applyEvent, before);
  const castingId = pendingCastingsOf(open)[0]!.castingId;
  const ticked = unwrap(advanceTime(open, 60, 'the muttering'), 'the minute').reduce(
    applyEvent,
    open,
  );
  const settled = unwrap(resolveDeclaredCast(ticked, castingId, supply('mouth')), 'the settlement');
  return { state: settled.events.reduce(applyEvent, ticked), castingId };
};

describe('Magic Mouth ends when its caster said at the casting that it would', () => {
  it('lets the caster end a casting that stated the ending', () => {
    const { state, castingId } = mouth(true);
    expect(state.ongoing[castingId]?.endsAfterTrigger).toBe(true);
    const out = unwrap(endOngoingSpell(state, WIZARD, castingId, null), 'the dismissal');
    expect(out.some((event) => event.type === 'spell-ended')).toBe(true);
  });

  it('refuses the caster who stated nothing, because the book prints no ending', () => {
    const { state, castingId } = mouth(false);
    expect(state.ongoing[castingId]?.endsAfterTrigger).toBeUndefined();
    const out = endOngoingSpell(state, WIZARD, castingId, null);
    expect(isErr(out) && out.code).toBe('not_dismissible');
  });

  it('refuses the fact on a spell that prints no such choice', () => {
    const out = resolveSpell(
      fold('seed', SETUP),
      WIZARD,
      { spellId: 'gaseous-form', targets: [WILLING], slotLevel: 3, willing: [WILLING], endsAfterTrigger: true },
      supply('mouth'),
    );
    expect(isErr(out) && out.code).toBe('no_early_ending');
  });
});

// — SRD Gaseous Form: a cloud, and the target's own way out ————————————————

const misted = (fighting = true) => {
  const before = fold('seed', SETUP);
  const out = unwrap(
    resolveSpell(
      before,
      WIZARD,
      { spellId: 'gaseous-form', targets: [WILLING], slotLevel: 3, willing: [WILLING] },
      supply(),
    ),
    'the mist',
  );
  const after = [...out.events, ...(fighting ? [THE_FIGHT] : [])].reduce(applyEvent, before);
  return { state: after, castingId: out.castingId! };
};

describe('Gaseous Form is a cloud with one way to move', () => {
  it('gives a Fly Speed of 10 and takes the walking Speed away', () => {
    const { state } = misted();
    expect(speedOf(state, WILLING, 'fly')).toBe(10);
    expect(speedOf(state, WILLING)).toBe(0);
    expect(speedOf(state, WILLING, 'swim')).toBe(0);
  });

  it('hovers, so a cloud that stops does not fall', () => {
    const { state } = misted();
    expect(flightLost(state, WILLING).kind).toBe('hovers');
  });

  it('refuses the Attack action', () => {
    const { state } = misted();
    const out = resolveAttack(
      state,
      WILLING,
      { target: FOE, weapon: 'club' },
      supply('swing'),
    );
    expect(isErr(out) && out.code).toBe('action_forbidden');
  });

  it('refuses a casting', () => {
    const { state } = misted();
    const out = resolveSpell(state, WILLING, { spellId: 'fire-bolt', targets: [FOE] }, supply('bolt'));
    expect(isErr(out) && out.code).toBe('casting_forbidden');
  });
});

describe('the target of Gaseous Form ends it on itself, as a Magic action', () => {
  it('ends the casting on the target and spends the action', () => {
    const { state, castingId } = misted();
    const out = unwrap(endOngoingSpellOnSelf(state, WILLING, castingId), 'the target’s ending');
    expect(out.some((event) => event.type === 'action-spent')).toBe(true);
    const after = out.reduce(applyEvent, state);
    expect(after.combat?.budgets[WILLING]?.action).toBe(false);
    expect(speedOf(after, WILLING)).toBe(30);
  });

  it('refuses a creature the casting is not on', () => {
    const { state, castingId } = misted();
    const out = endOngoingSpellOnSelf(state, ALLY, castingId);
    expect(isErr(out) && out.code).toBe('no_effect_there');
  });

  it('refuses a casting whose spell prints no such ending', () => {
    const { state, castingId } = mouth(true);
    const out = endOngoingSpellOnSelf(state, WIZARD, castingId);
    expect(isErr(out) && out.code).toBe('not_dismissible_by_target');
  });
});

describe('what a definition may say about the two endings', () => {
  const definition = (over: Record<string, unknown>): unknown => ({
    id: 'homebrew-whisper',
    name: 'Homebrew Whisper',
    level: 2,
    school: 'illusion',
    castingTime: 'action',
    concentration: false,
    range: { kind: 'ranged', feet: 30 },
    targets: { count: 0 },
    effects: [],
    untilDispelled: true,
    unmodelled: ['what the whisper says is the DM’s'],
    ...over,
  });

  const codes = (over: Record<string, unknown>): readonly string[] =>
    checkSpellDefinitionValue(definition(over)).map((one) => one.code);

  it('accepts an offered ending on a casting that runs', () => {
    expect(codes({ offersEndAfterTrigger: true })).toEqual([]);
  });

  it('refuses an offered ending on a casting that leaves nothing running', () => {
    expect(codes({ offersEndAfterTrigger: true, untilDispelled: undefined })).toContain(
      'dismissal_without_a_casting',
    );
  });

  it('refuses a target’s dismissal on a casting that leaves nothing running', () => {
    expect(codes({ dismissibleBy: 'target', untilDispelled: undefined })).toContain(
      'dismissal_without_a_casting',
    );
  });

  it('refuses a target’s dismissal on a spell that is cast at nobody', () => {
    expect(codes({ dismissibleBy: 'target' })).toContain('dismissal_without_a_target');
  });
});
