import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { SPELL_INDEX } from '@ie/srd';
import { asCharacterId, expect as unwrap, isErr, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, restoreRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { declaredCasting } from './spellcasting.js';
import { hasComponent, loadContent } from './content.js';
import { checkActionRule } from './spell-schema.js';
import { awardItems, equipItem, resolveDeclaredCast, resolveSpell, resolveTurn } from './commands.js';

/**
 * SRD Slow's last sentence, and the fact about a spell the engine did not hold.
 *
 * > "If it casts a spell with a Somatic component, there is a 25 percent
 * > chance the spell fails as a result of the target making the spell's
 * > gestures too slowly."
 *
 * Two halves. The **fact**: `SpellEntry.components`, carried out of the parsed
 * book by the generated index, so a Fire Bolt (V, S) is told apart from a
 * Command (V). The **rule**: `ActionRule`'s `casting-chance`, which Slow's
 * failed save hangs beside its other four grants and which the casting
 * pipeline reads **after the cost is paid** — so a failure keeps the slot and
 * the action spent, throws no die of the spell's own, and says so in the log
 * with `spell-fizzled`. (W7-S22)
 */

const id = (s: string) => asCharacterId(s);
const WIZARD = id('wizard');
const CLERIC = id('cleric');
const SORCERER = id('sorcerer');
const GOBLIN = id('goblin');

const sheet = (ability: 'int' | 'wis' | 'cha'): CharacterSheet => ({
  level: 5,
  abilities: { str: 10, dex: 14, con: 12, int: 16, wis: 16, cha: 16 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: ability,
  weaponProficiencies: ['simple'],
});

const added = (who: CharacterId, side: string, ability: 'int' | 'wis' | 'cha'): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(ability),
  maxHp: 400,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side,
});

const slots = (who: CharacterId): readonly GameEvent[] =>
  [1, 2, 3].map((level) => ({
    type: 'resource-pool-declared',
    id: who,
    pool: { key: `spell-slot:${level}`, label: `level ${level}`, max: 4, recovers: 'long-rest' },
  }));

/** The rule Slow's failed save hangs, stood on a creature by hand. */
const slowed = (who: CharacterId): GameEvent => ({
  type: 'action-rule-granted',
  id: who,
  rule: {
    source: 'Slow#cast:90',
    rule: { kind: 'casting-chance', component: 'somatic', percent: 25 },
    label: 'Slow',
    until: 'the spell ends',
  },
});

const FIELD: readonly GameEvent[] = [
  added(WIZARD, 'party', 'int'),
  added(CLERIC, 'party', 'wis'),
  added(SORCERER, 'foes', 'cha'),
  added(GOBLIN, 'foes', 'int'),
  {
    type: 'spellcasting-declared',
    id: WIZARD,
    spellcasting: declaredCasting({
      ability: 'int',
      classId: 'wizard',
      prepared: ['fire-bolt', 'magic-missile'],
    }),
  },
  {
    type: 'spellcasting-declared',
    id: CLERIC,
    spellcasting: declaredCasting({ ability: 'wis', classId: 'cleric', prepared: ['command'] }),
  },
  {
    type: 'spellcasting-declared',
    id: SORCERER,
    spellcasting: declaredCasting({ ability: 'cha', classId: 'sorcerer', prepared: ['slow'] }),
  },
  ...slots(WIZARD),
  ...slots(CLERIC),
  ...slots(SORCERER),
  { type: 'scene-set', extent: { width: 600, depth: 600, height: 40 } },
  { type: 'landmark-added', name: 'the door', at: { x: 200, y: 200, z: 0 } },
  { type: 'creature-placed', id: WIZARD, placement: { from: { landmark: 'the door' }, feet: 0 } },
  { type: 'creature-placed', id: CLERIC, placement: { from: { creature: WIZARD }, feet: 5, bearing: 90 } },
  { type: 'creature-placed', id: SORCERER, placement: { from: { creature: WIZARD }, feet: 30, bearing: 0 } },
  { type: 'creature-placed', id: GOBLIN, placement: { from: { creature: WIZARD }, feet: 30, bearing: 180 } },
  ...[WIZARD, CLERIC, SORCERER, GOBLIN].flatMap((from): readonly GameEvent[] =>
    [WIZARD, CLERIC, SORCERER, GOBLIN]
      .filter((to) => to !== from)
      .map((to): GameEvent => ({ type: 'sight-declared', from, to, seen: true })),
  ),
  {
    type: 'combat-started',
    combatants: [
      { id: WIZARD, initiative: 20, speed: 30 },
      { id: CLERIC, initiative: 15, speed: 30 },
      { id: SORCERER, initiative: 12, speed: 30 },
      { id: GOBLIN, initiative: 10, speed: 30 },
    ],
  },
];

const supply = (state: GameState, seed: string, flat?: number) => ({
  issuer: createRollIssuer('r', state.rollsIssued),
  rng: (state.rng === null ? createRng(seed) : restoreRng(state.rng)) as Rng,
  ...(flat === undefined ? {} : { bonuses: [{ source: 'the test insists', flat }] }),
  content: SRD_CONTENT,
});

/** The die the rule throws, told apart from every die of the spell's own. */
const fumbleRolls = (events: readonly GameEvent[]) =>
  events.filter(
    (event): event is Extract<GameEvent, { type: 'roll-recorded' }> =>
      event.type === 'roll-recorded' && event.label.includes('under Slow'),
  );

/** Advance the order until it is this creature's turn. */
const until = (log: readonly GameEvent[], who: CharacterId): readonly GameEvent[] => {
  let current = log;
  for (let guard = 0; guard < 8; guard += 1) {
    const combat = fold('slow', current).combat;
    if (combat !== null && combat.order[combat.turnIndex]?.id === who) return current;
    const state = fold('slow', current);
    current = [...current, ...unwrap(resolveTurn(state, supply(state, 'turns')), 'turn').events];
  }
  throw new Error(`the order never reached ${who}`);
};

/** The wizard's Fire Bolt at the goblin, thrown with the generator on this seed. */
const fireBolt = (log: readonly GameEvent[], seed: string) => {
  const state = fold('slow', log);
  return unwrap(
    resolveSpell(state, WIZARD, { spellId: 'fire-bolt', targets: [GOBLIN] }, supply(state, seed)),
    'fire bolt',
  );
};

describe('the book’s components reach the engine', () => {
  it('carries all three components on every indexed spell, as the parsed book prints them', () => {
    const fireBolt = SPELL_INDEX.find((spell) => spell.id === 'fire-bolt');
    const command = SPELL_INDEX.find((spell) => spell.id === 'command');
    expect(fireBolt?.components).toEqual({ verbal: true, somatic: true, material: false });
    expect(command?.components).toEqual({ verbal: true, somatic: false, material: false });
    // And the index answers for all of them, not the two a test happened to name.
    expect(SPELL_INDEX.every((spell) => typeof spell.components.somatic === 'boolean')).toBe(true);
    expect(SPELL_INDEX.some((spell) => !spell.components.somatic)).toBe(true);
  });

  it('is what the catalogue’s entries say, through the one reader', () => {
    expect(hasComponent(SRD_CONTENT.spellEntry('fire-bolt'), 'somatic')).toBe(true);
    expect(hasComponent(SRD_CONTENT.spellEntry('command'), 'somatic')).toBe(false);
    expect(hasComponent(SRD_CONTENT.spellEntry('command'), 'verbal')).toBe(true);
  });

  it('reads a spell nobody described as having a Verbal and a Somatic component and no Material one', () => {
    expect(hasComponent(null, 'verbal')).toBe(true);
    expect(hasComponent(null, 'somatic')).toBe(true);
    expect(hasComponent(null, 'material')).toBe(false);
  });

  it('round-trips a homebrew entry’s components through JSON, and refuses malformed ones', () => {
    const entry = {
      id: 'finger-wag',
      name: 'Finger Wag',
      level: 0,
      school: 'evocation',
      classes: ['wizard'],
      castingTime: 'Action',
      ritual: false,
      concentration: false,
      components: { verbal: false, somatic: true, material: false },
    };
    const loaded = unwrap(loadContent(JSON.parse(JSON.stringify({ spellEntries: [entry] }))), 'load');
    expect(loaded.spellEntry('finger-wag')?.components).toEqual(entry.components);

    const bad = loadContent({ spellEntries: [{ ...entry, components: { verbal: 'yes' } }] });
    expect(isErr(bad)).toBe(true);
  });
});

describe('the rule, held at authoring', () => {
  const problems = (rule: unknown) => {
    const found: { field: string; code: string; reason: string }[] = [];
    checkActionRule(rule as never, 'rule', found);
    return found.map((problem) => problem.code);
  };

  it('accepts Slow’s sentence', () => {
    expect(problems({ kind: 'casting-chance', component: 'somatic', percent: 25 })).toEqual([]);
  });

  it('refuses a component the book does not print and a chance the die cannot fall under', () => {
    expect(problems({ kind: 'casting-chance', component: 'gestural', percent: 25 })).toEqual([
      'bad_action_rule',
    ]);
    expect(problems({ kind: 'casting-chance', component: 'somatic', percent: 0 })).toEqual([
      'bad_action_rule',
    ]);
    expect(problems({ kind: 'casting-chance', component: 'somatic', percent: 100 })).toEqual([
      'bad_action_rule',
    ]);
  });
});

describe('SRD Slow: a Somatic casting may fail', () => {
  const WIZARD_SLOWED = [...FIELD, slowed(WIZARD)];

  it('hangs the rule on a creature that fails Slow’s save', () => {
    const log = until(FIELD, SORCERER);
    const state = fold('slow', log);
    const out = unwrap(
      resolveSpell(
        state,
        SORCERER,
        {
          spellId: 'slow',
          targets: [WIZARD],
          at: { x: 200, y: 210, z: 0 },
          towards: { x: 200, y: 170, z: 0 },
        } as never,
        supply(state, 'cast', -40),
      ),
      'slow',
    );
    const after = fold('slow', [...log, ...out.events]);
    const rules = (after.creatures[WIZARD]?.actionRules ?? []).map((held) => held.rule);
    expect(rules).toContainEqual({ kind: 'casting-chance', component: 'somatic', percent: 25 });
  });

  it('throws the die for a slowed Fire Bolt, and a failure spends the action and throws nothing else', () => {
    const seen = { failed: 0, held: 0 };
    for (let n = 0; n < 60 && (seen.failed === 0 || seen.held === 0); n += 1) {
      const out = fireBolt(WIZARD_SLOWED, `seed-${n}`);
      const fumbles = fumbleRolls(out.events);
      expect(fumbles).toHaveLength(1);
      const face = fumbles[0]!.natural;
      const fizzled = out.events.filter((event) => event.type === 'spell-fizzled');

      if (face <= 25) {
        seen.failed += 1;
        // The spell fails: the log says so and names the rule that did it.
        expect(fizzled).toEqual([
          { type: 'spell-fizzled', castingId: out.castingId, id: WIZARD, source: 'Slow#cast:90', label: 'Slow' },
        ]);
        // The cost is paid — the casting happened and the action is gone.
        expect(out.events.some((event) => event.type === 'spell-cast')).toBe(true);
        expect(out.events.some((event) => event.type === 'action-spent' && event.id === WIZARD)).toBe(true);
        // And no die of the spell's own: no attack roll, no damage, no hit.
        expect(out.events.filter((event) => event.type === 'roll-recorded')).toHaveLength(1);
        expect(out.events.some((event) => event.type === 'damage-taken')).toBe(false);
        expect(out.outcomes).toEqual([]);
        const after = fold('slow', [...WIZARD_SLOWED, ...out.events]);
        expect(after.combat?.budgets[WIZARD]?.action).toBe(false);
      } else {
        seen.held += 1;
        expect(fizzled).toEqual([]);
        // The casting goes on: the attack roll is thrown after the fumble die.
        expect(out.events.filter((event) => event.type === 'roll-recorded').length).toBeGreaterThan(1);
        expect(out.outcomes.map((one) => one.target)).toEqual([GOBLIN]);
      }
    }
    // Both faces reached, or the loop proved one branch only.
    expect(seen.failed).toBeGreaterThan(0);
    expect(seen.held).toBeGreaterThan(0);
  });

  it('keeps the slot spent when a levelled Somatic spell fails', () => {
    for (let n = 0; n < 60; n += 1) {
      const state = fold('slow', WIZARD_SLOWED);
      const out = unwrap(
        resolveSpell(
          state,
          WIZARD,
          { spellId: 'magic-missile', targets: [GOBLIN], slotLevel: 1 },
          supply(state, `slot-${n}`),
        ),
        'magic missile',
      );
      if (!out.events.some((event) => event.type === 'spell-fizzled')) continue;
      const after = fold('slow', [...WIZARD_SLOWED, ...out.events]);
      expect(after.creatures[WIZARD]?.resources.pools['spell-slot:1']?.spent).toBe(1);
      expect(after.creatures[GOBLIN]?.vitals.hp).toBe(400);
      return;
    }
    throw new Error('no seed failed the casting');
  });

  it('throws nothing for a slowed cleric’s Command, which is Verbal only', () => {
    const log = until([...FIELD, slowed(CLERIC)], CLERIC);
    const state = fold('slow', log);
    const out = unwrap(
      resolveSpell(
        state,
        CLERIC,
        { spellId: 'command', targets: [GOBLIN], option: 'halt' } as never,
        supply(state, 'word', -40),
      ),
      'command',
    );
    expect(fumbleRolls(out.events)).toEqual([]);
    expect(out.events.some((event) => event.type === 'spell-fizzled')).toBe(false);
  });

  /**
   * SRD "Spells Cast from Items": the item's casting needs none of the
   * caster's gestures — the reason Counterspell's own window is an open
   * question in `docs/design/casting.md` — so a slowed wizard waving a Wand of
   * Fireballs throws no die for it.
   */
  it('throws nothing for a casting an item makes', () => {
    const awarded = [
      ...WIZARD_SLOWED,
      ...unwrap(
        awardItems(fold('slow', WIZARD_SLOWED), supply(fold('slow', WIZARD_SLOWED), 'hoard'), WIZARD, [
          { id: 'wand-of-fireballs' },
        ], 'the hoard'),
        'award',
      ),
    ];
    const worn: readonly GameEvent[] = [
      ...awarded,
      ...unwrap(equipItem(fold('slow', awarded), SRD_CONTENT, WIZARD, 'wand-of-fireballs'), 'equip'),
      { type: 'attuned', id: WIZARD, item: 'wand-of-fireballs' },
    ];
    for (let n = 0; n < 8; n += 1) {
      const state = fold('slow', worn);
      const out = unwrap(
        resolveSpell(
          state,
          WIZARD,
          { spellId: 'fireball', targets: [], at: { x: 200, y: 100, z: 0 }, item: 'wand-of-fireballs' } as never,
          supply(state, `wand-${n}`),
        ),
        'fireball from the wand',
      );
      expect(fumbleRolls(out.events)).toEqual([]);
      expect(out.events.some((event) => event.type === 'spell-fizzled')).toBe(false);

      // And the same where the casting is held open and settled: the record
      // carries the wand's numbers, which is how the settlement knows.
      const declared = unwrap(
        resolveSpell(
          state,
          WIZARD,
          {
            spellId: 'fireball',
            targets: [],
            at: { x: 200, y: 100, z: 0 },
            item: 'wand-of-fireballs',
            hold: true,
          } as never,
          supply(state, `held-wand-${n}`),
        ),
        'fireball from the wand, held',
      );
      const open = fold('slow', [...worn, ...declared.events]);
      const settled = unwrap(
        resolveDeclaredCast(open, declared.castingId!, supply(open, `held-wand-${n}`)),
        'settled',
      );
      expect(fumbleRolls(settled.events)).toEqual([]);
    }
  });

  it('throws nothing for a wizard nobody slowed', () => {
    const out = fireBolt(FIELD, 'free');
    expect(fumbleRolls(out.events)).toEqual([]);
    expect(out.events.some((event) => event.type === 'spell-fizzled')).toBe(false);
  });

  it('throws at the settlement of a declared casting, where the slot is spent', () => {
    for (let n = 0; n < 60; n += 1) {
      const state = fold('slow', WIZARD_SLOWED);
      const declared = unwrap(
        resolveSpell(
          state,
          WIZARD,
          { spellId: 'magic-missile', targets: [GOBLIN], slotLevel: 1, hold: true },
          supply(state, `held-${n}`),
        ),
        'declared',
      );
      // No die at the declaration: nothing has been paid for yet.
      expect(fumbleRolls(declared.events)).toEqual([]);
      const log = [...WIZARD_SLOWED, ...declared.events];
      const open = fold('slow', log);
      const settled = unwrap(
        resolveDeclaredCast(open, declared.castingId!, supply(open, `held-${n}`)),
        'settled',
      );
      expect(fumbleRolls(settled.events)).toHaveLength(1);
      if (!settled.events.some((event) => event.type === 'spell-fizzled')) continue;
      const after = fold('slow', [...log, ...settled.events]);
      expect(after.creatures[WIZARD]?.resources.pools['spell-slot:1']?.spent).toBe(1);
      expect(after.creatures[GOBLIN]?.vitals.hp).toBe(400);
      expect(after.pendingCastings).toEqual({});
      return;
    }
    throw new Error('no seed failed the settlement');
  });

  it('ends a Concentration the failed casting began', () => {
    // Slow itself is V, S, M and a Concentration spell: a slowed sorcerer's
    // Slow that fails leaves nothing held.
    const log = until([...FIELD, slowed(SORCERER)], SORCERER);
    for (let n = 0; n < 60; n += 1) {
      const state = fold('slow', log);
      const out = unwrap(
        resolveSpell(
          state,
          SORCERER,
          {
            spellId: 'slow',
            targets: [WIZARD],
            at: { x: 200, y: 210, z: 0 },
            towards: { x: 200, y: 170, z: 0 },
          } as never,
          supply(state, `conc-${n}`, -40),
        ),
        'slow',
      );
      if (!out.events.some((event) => event.type === 'spell-fizzled')) continue;
      expect(out.events.some((event) => event.type === 'concentration-started')).toBe(true);
      const after = fold('slow', [...log, ...out.events]);
      expect(after.creatures[SORCERER]?.concentration).toBeNull();
      expect(after.ongoing).toEqual({});
      expect(after.creatures[WIZARD]?.actionRules ?? []).toEqual([]);
      return;
    }
    throw new Error('no seed failed the casting');
  });

  it('refuses a log that fumbles a casting nobody made', () => {
    expect(() =>
      fold('slow', [
        ...FIELD,
        { type: 'spell-fizzled', castingId: 'cast:7', id: WIZARD, source: 'Slow#cast:90', label: 'Slow' },
      ]),
    ).toThrow(/has not been cast/);
  });
});
