import { SRD_CONTENT } from '@ie/content';
import { describe, expect, it } from 'vitest';
import { asCharacterId, expect as unwrap, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { spellSlotKey } from './resources.js';
import { declaredCasting } from './spellcasting.js';
import { rollModesFor } from './standing.js';
import { endConcentration, ongoingSpellsOn, resolveSpell, resolveTurn } from './commands.js';

/**
 * What a settled outcome carries with it.
 *
 * SRD writes this constantly and the engine could say almost none of it:
 *
 * > Hideous Laughter: "On a failed save, it has the **Prone and
 * > Incapacitated** conditions for the duration."
 * > Phantasmal Killer: "the target takes 4d10 Psychic damage **and has
 * > Disadvantage on ability checks and attack rolls** for the duration."
 * > Sunburst: "a creature takes 12d6 Radiant damage and has the Blinded
 * > condition **for 1 minute**."
 * > Acid Arrow: "**On a miss**, the arrow splashes the target with acid for
 * > half as much of the initial damage only."
 *
 * **There are no child effects in any of those sentences**, which is the
 * finding the whole vocabulary rests on. What follows "On a failed save," is a
 * conjunction of consequences that *share one roll* — one target, one DC, one
 * casting link, one lifetime — and every consequence in that position is a
 * **leaf**: it rolls no d20, names no target of its own, opens no window, and
 * spends nothing. So the answer was not a restricted child grammar but a fixed
 * set of named rider slots on the three kinds that produce an outcome, with
 * the branch decided by the host rather than chosen by the author.
 *
 * Writing any of these as a second effect would roll a **second saving
 * throw**, and a creature could then fail one and make the other — which is
 * not the spell. That is the argument `plus` already made for a second damage
 * type, and this file is it made for conditions, for grants, and for a miss.
 *
 * `spell-schema.test.ts` holds the invariant from the other side: nothing
 * below an effect is an effect, in the catalogue or in a file somebody loads.
 */

const id = (s: string) => asCharacterId(s);
const CASTER = id('caster');
const TARGET = id('target');
const OTHER = id('other');

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 17,
  abilities: { str: 10, dex: 10, con: 10, int: 20, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
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
  maxHp: 400,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side: who === CASTER ? 'party' : 'foes',
});

const SETUP: readonly GameEvent[] = [
  added(CASTER),
  added(TARGET),
  added(OTHER),
  ...[1, 2, 3, 4, 5, 6, 7, 8].map(
    (level): GameEvent => ({
      type: 'resource-pool-declared',
      id: CASTER,
      pool: { key: spellSlotKey(level), label: `level ${level}`, max: 4, recovers: 'long-rest' },
    }),
  ),
  {
    type: 'spellcasting-declared',
    id: CASTER,
    spellcasting: declaredCasting({
      ability: 'int',
      prepared: ['hideous-laughter', 'hypnotic-pattern', 'phantasmal-killer', 'sunburst'],
    }),
  },
  { type: 'scene-set', extent: { width: 400, depth: 400, height: 40 } },
  { type: 'landmark-added', name: 'here', at: { x: 100, y: 100, z: 0 } },
  { type: 'creature-placed', id: CASTER, placement: { from: { landmark: 'here' }, feet: 0 } },
  { type: 'creature-placed', id: TARGET, placement: { from: { creature: CASTER }, feet: 10, bearing: 0 } },
  { type: 'creature-placed', id: OTHER, placement: { from: { creature: CASTER }, feet: 15, bearing: 0 } },
  { type: 'sight-declared', from: CASTER, to: TARGET, seen: true },
  { type: 'sight-declared', from: CASTER, to: OTHER, seen: true },
  // The caster acts first, so "the end of its turn" is the target's own.
  {
    type: 'combat-started',
    combatants: [
      { id: CASTER, initiative: 20, speed: 30 },
      { id: TARGET, initiative: 10, speed: 30 },
      { id: OTHER, initiative: 5, speed: 30 },
    ],
  },
];

/**
 * A supply whose flat bonus settles the saving throw outright.
 *
 * Forced rather than seeded, because every test here is about what a *settled*
 * outcome carries: which way the die fell is the premise rather than the
 * question, and the engine's own suite proves the roll elsewhere.
 */
const supply = (seed: string, flat?: number) => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  ...(flat === undefined ? {} : { bonuses: [{ source: 'the test insists', flat }] }),
  content: SRD_CONTENT,
});

const cast = (
  log: readonly GameEvent[],
  request: Parameters<typeof resolveSpell>[2],
  flat: number,
  seed = 'cast',
) => unwrap(resolveSpell(fold('seed', log), CASTER, request, supply(seed, flat)), String(request.spellId));

/** Advance to whoever is next, settling anything the boundary owes. */
const nextTurn = (log: readonly GameEvent[], seed = 'turn'): readonly GameEvent[] => [
  ...log,
  ...unwrap(resolveTurn(fold('seed', log), supply(seed)), 'turn').events,
];

const conditionsOf = (state: GameState, who: CharacterId): readonly string[] =>
  state.creatures[who]!.conditions.conditions;

const savesIn = (events: readonly GameEvent[], spell: string): readonly GameEvent[] =>
  events.filter((e) => e.type === 'roll-recorded' && new RegExp(`save vs ${spell}`).test(e.label));

// — one save, several conditions ———————————————————————————————————————————

describe('Hideous Laughter: one saving throw, two conditions', () => {
  /**
   * SRD: "One creature of your choice that you can see within range makes a
   * Wisdom saving throw. On a failed save, it has the **Prone and
   * Incapacitated** conditions for the duration."
   *
   * The spell that made `conditions` plural, and the reason the plural is not
   * a convenience: two `save` effects would be two Wisdom saving throws, so a
   * creature could be Prone and not Incapacitated. The book offers no such
   * creature.
   */
  const laughing = (log: readonly GameEvent[] = SETUP, flat = -40) =>
    cast(log, { spellId: 'hideous-laughter', targets: [TARGET], slotLevel: 1 }, flat);

  it('imposes both conditions on a single failed save', () => {
    const out = laughing();
    expect(savesIn(out.events, 'Hideous Laughter')).toHaveLength(1);
    expect(out.outcomes[0]?.conditions).toEqual(['prone', 'incapacitated']);

    const state = fold('seed', [...SETUP, ...out.events]);
    expect(conditionsOf(state, TARGET)).toContain('prone');
    expect(conditionsOf(state, TARGET)).toContain('incapacitated');
  });

  /** And a creature that makes the save gets neither, rather than one of the two. */
  it('imposes neither on a successful save', () => {
    const out = laughing(SETUP, 40);
    expect(out.outcomes[0]?.affected).toBe(false);
    expect(out.outcomes[0]?.conditions).toBeUndefined();

    const state = fold('seed', [...SETUP, ...out.events]);
    expect(conditionsOf(state, TARGET)).toEqual([]);
  });

  /**
   * Both are the casting's, so both go when it does. SRD says "for the
   * duration" of a spell that also says the target "can't end the Prone
   * condition on itself" — which is the opposite of Grease, where the Prone is
   * the creature's own to stand up from and `outlivesCasting` says so.
   */
  it('takes both away when the casting ends', () => {
    const log = [...SETUP, ...laughing().events];
    const ended = [
      ...log,
      ...unwrap(endConcentration(fold('seed', log), CASTER, 'voluntary'), 'end'),
    ];
    expect(conditionsOf(fold('seed', ended), TARGET)).toEqual([]);
  });

  /**
   * The repeat save stays flat on the effect, because SRD writes it once about
   * the spell rather than once per condition: "it makes another Wisdom saving
   * throw ... On a successful save, **the spell ends**." So one save is raised
   * at the boundary — not two, one per condition — and its success lifts both.
   */
  it('raises exactly one repeat save at the boundary, and ends the spell on a success', () => {
    const log = [...SETUP, ...laughing().events];

    // The caster's turn ends and the target's begins; nothing is owed yet,
    // because the hook is anchored to the *end* of the target's own turn.
    const theirs = nextTurn(log);
    expect(conditionsOf(fold('seed', theirs), TARGET)).toContain('prone');

    const rolled = unwrap(
      resolveTurn(fold('seed', theirs), supply('escape', 40)),
      'the target shakes it off',
    );
    expect(savesIn(rolled.events, 'Hideous Laughter')).toHaveLength(1);

    const free = fold('seed', [...theirs, ...rolled.events]);
    expect(conditionsOf(free, TARGET)).toEqual([]);
    expect(free.creatures[CASTER]!.concentration).toBeNull();
  });
});

describe('Hypnotic Pattern: the second condition the Charm carries', () => {
  /**
   * SRD: "Each creature in the area who can see the pattern must succeed on a
   * Wisdom saving throw or have the Charmed condition for the duration.
   * **While Charmed, the creature has the Incapacitated condition** and a
   * Speed of 0."
   *
   * The second consumer, and it is the one that shows the slot belongs to the
   * *outcome* rather than to any one kind: this is an area, so the geometry
   * picked the targets, and both conditions still land on the one save each of
   * them rolled.
   */
  it('charms and incapacitates everyone the Cube catches, on one save each', () => {
    const out = cast(
      SETUP,
      {
        spellId: 'hypnotic-pattern',
        targets: [],
        // A Cube excludes its own point of origin, so the origin sits a space
        // short of the nearer creature and the template covers them both.
        at: { x: 100, y: 105, z: 0 },
        towards: { x: 100, y: 160, z: 0 },
        slotLevel: 3,
      },
      -40,
    );
    expect(out.outcomes.length).toBeGreaterThanOrEqual(2);
    expect(savesIn(out.events, 'Hypnotic Pattern')).toHaveLength(out.outcomes.length);

    const state = fold('seed', [...SETUP, ...out.events]);
    for (const outcome of out.outcomes) {
      expect(outcome.conditions).toEqual(['charmed', 'incapacitated']);
      expect(conditionsOf(state, outcome.target)).toContain('charmed');
      expect(conditionsOf(state, outcome.target)).toContain('incapacitated');
    }
  });
});

// — one save, a grant —————————————————————————————————————————————————————

describe('Phantasmal Killer: the grant a failed save imposes', () => {
  /**
   * SRD: "On a failed save, the target takes 4d10 Psychic damage **and has
   * Disadvantage on ability checks and attack rolls** for the duration."
   *
   * The `modifiers` slot, and the case that shows why it is a list: a
   * `RollModifier` names one family of roll, and "ability checks and attack
   * rolls" is two families in one clause.
   */
  const feared = (flat: number) =>
    cast(SETUP, { spellId: 'phantasmal-killer', targets: [TARGET], slotLevel: 4 }, flat);

  const modesOn = (state: GameState, family: 'attack' | 'ability-check') =>
    rollModesFor(state, { family, roller: TARGET }).modes;

  it('deals the damage and grants both modes on one saving throw', () => {
    const out = feared(-40);
    expect(savesIn(out.events, 'Phantasmal Killer')).toHaveLength(1);
    expect(out.outcomes[0]?.damage).toBeGreaterThan(0);

    const granted = out.events.filter((e) => e.type === 'roll-modifier-granted');
    expect(granted).toHaveLength(2);

    const state = fold('seed', [...SETUP, ...out.events]);
    expect(modesOn(state, 'attack').map((m) => m.mode)).toEqual(['disadvantage']);
    expect(modesOn(state, 'ability-check').map((m) => m.mode)).toEqual(['disadvantage']);
  });

  /**
   * "On a successful save, the target takes half as much damage" — and nothing
   * else. A grant that landed on a success would be the spell's own sentence
   * read backwards.
   */
  it('grants nothing to a target that saves, though the damage still lands', () => {
    const out = feared(40);
    expect(out.outcomes[0]?.damage).toBeGreaterThan(0);
    expect(out.events.filter((e) => e.type === 'roll-modifier-granted')).toEqual([]);

    const state = fold('seed', [...SETUP, ...out.events]);
    expect(modesOn(state, 'attack')).toEqual([]);
  });

  /**
   * "For the duration" is the casting's, which is all a `mode` rider can say:
   * that member carries no `lasts`, because no SRD sentence in its position
   * asks for one. `EffectTarget.grants` makes a shorter deadline expressible
   * and `speed-change` is the one member that names it — so the grant going
   * when the casting goes is this rider's whole lifetime rather than the
   * engine's only answer.
   */
  it('takes the grant away when the casting ends', () => {
    const log = [...SETUP, ...feared(-40).events];
    expect(modesOn(fold('seed', log), 'attack')).toHaveLength(1);

    const ended = [
      ...log,
      ...unwrap(endConcentration(fold('seed', log), CASTER, 'voluntary'), 'end'),
    ];
    expect(modesOn(fold('seed', ended), 'attack')).toEqual([]);
  });

  /**
   * And the source is the casting, so Dispel Magic and every other door that
   * ends a spell reaches it through machinery that already existed.
   */
  it('records the casting as running on the creature it granted to', () => {
    const out = feared(-40);
    const state = fold('seed', [...SETUP, ...out.events]);
    expect(ongoingSpellsOn(state, TARGET).map((o) => o.castingId)).toEqual([out.castingId]);
  });
});

// — a rider that repeats the host's save, on its own clock ——————————————————

describe('Sunburst: a rider that outlives an Instantaneous casting', () => {
  /**
   * SRD: "On a failed save, a creature takes 12d6 Radiant damage and has the
   * Blinded condition **for 1 minute**." **Duration: Instantaneous.**
   *
   * The spell that needed a span of seconds as a rider deadline. The casting
   * is over the instant it happens, so there is no casting deadline to borrow
   * and no turn in the order that means "a minute"; and `durationSeconds: 60`
   * on the definition was rejected because it would make a flash of light an
   * ongoing, dispellable spell.
   */
  const flash = (log: readonly GameEvent[] = SETUP, flat = -40) =>
    cast(log, { spellId: 'sunburst', targets: [], at: { x: 100, y: 112, z: 0 }, slotLevel: 8 }, flat);

  it('blinds on the same failed save that dealt the damage', () => {
    const out = flash();
    expect(savesIn(out.events, 'Sunburst')).toHaveLength(out.outcomes.length);
    expect(out.outcomes[0]?.damage).toBeGreaterThan(0);
    expect(out.outcomes[0]?.conditions).toEqual(['blinded']);
    expect(conditionsOf(fold('seed', [...SETUP, ...out.events]), TARGET)).toContain('blinded');
  });

  /**
   * **And the casting is not ongoing**, which is the half a duration on the
   * definition would have got wrong. Nothing is left for a Dispel Magic to
   * find; the Blinded runs its minute on the clock alone.
   */
  it('leaves no ongoing casting behind, because the spell is Instantaneous', () => {
    const state = fold('seed', [...SETUP, ...flash().events]);
    expect(Object.keys(state.ongoing)).toEqual([]);
    expect(ongoingSpellsOn(state, TARGET)).toEqual([]);
  });

  /** A minute later it is gone, without anybody having rolled anything. */
  it('lifts after its minute', () => {
    const log: readonly GameEvent[] = [
      ...SETUP,
      ...flash().events,
      { type: 'time-advanced', seconds: 59, reason: 'most of a minute' },
    ];
    expect(conditionsOf(fold('seed', log), TARGET)).toContain('blinded');

    const later: readonly GameEvent[] = [
      ...log,
      { type: 'time-advanced', seconds: 1, reason: 'the last second' },
    ];
    expect(conditionsOf(fold('seed', later), TARGET)).not.toContain('blinded');
  });

  /**
   * "A creature Blinded by this spell makes **another Constitution saving
   * throw** at the end of each of its turns, ending the effect **on itself**
   * on a success."
   *
   * *Another* — the one this spell already rolled, which is why the rider
   * names no ability of its own and reads the host's. *On itself* — so one
   * creature blinking the glare away leaves everybody else in the Sphere
   * blind.
   */
  it('repeats the host’s save at the boundary, and frees only the creature that made it', () => {
    const log = [...SETUP, ...flash().events];
    expect(conditionsOf(fold('seed', log), TARGET)).toContain('blinded');
    expect(conditionsOf(fold('seed', log), OTHER)).toContain('blinded');

    // The caster's turn ends and the target's begins: nothing is owed yet.
    const theirs = nextTurn(log);
    expect(conditionsOf(fold('seed', theirs), TARGET)).toContain('blinded');

    const rolled = unwrap(
      resolveTurn(fold('seed', theirs), supply('blink', 40)),
      'the target blinks it away',
    );
    const state = fold('seed', [...theirs, ...rolled.events]);
    expect(savesIn(rolled.events, 'Sunburst')).toHaveLength(1);
    expect(conditionsOf(state, TARGET)).not.toContain('blinded');
    expect(conditionsOf(state, OTHER)).toContain('blinded');
  });

  /** And a failed repeat save leaves it standing, or the rule above is vacuous. */
  it('leaves the Blinded standing when the repeat save fails', () => {
    const theirs = nextTurn([...SETUP, ...flash().events]);
    const rolled = unwrap(
      resolveTurn(fold('seed', theirs), supply('blink', -40)),
      'the target fails to blink it away',
    );
    expect(conditionsOf(fold('seed', [...theirs, ...rolled.events]), TARGET)).toContain('blinded');
  });
});

// — the order riders are applied in ————————————————————————————————————————

describe('the order within a slot is the order the definition writes', () => {
  /**
   * **The cross-slot order is unobservable today, and saying so is the point.**
   *
   * `applyRiders` fixes it — conditions, then modifiers, then delayed — and it
   * is decided once there rather than by whichever host branch a reader
   * happens to be looking at. What no test here can pin is that it *stays*
   * fixed: no castable definition carries two slots at once, so a mutation
   * that swapped the two loops changes no event anybody can produce. A
   * homebrew definition carrying both would validate and still could not be
   * cast, because `definitionFor` reads the catalogue rather than state.
   *
   * So this claims only what it can drive: **within** a slot the riders are
   * applied in the order the definition lists them. A title claiming the
   * stronger thing would be the kind of unchecked claim the honesty guards in
   * this repository exist to refuse, arriving in a test file.
   */
  it('applies two grants in the order the SRD sentence names them', () => {
    const killer = cast(SETUP, { spellId: 'phantasmal-killer', targets: [TARGET], slotLevel: 4 }, -40);
    const granted = killer.events.filter((e) => e.type === 'roll-modifier-granted');
    expect(granted).toHaveLength(2);
    // "Disadvantage on ability checks and attack rolls" — two families in one
    // clause, in that order, which is why `modifiers` is a list.
    expect(
      granted.map((e) => (e.type === 'roll-modifier-granted' ? e.modifier.modifier.selector.roll : '')),
    ).toEqual(['ability-check', 'attack']);
  });

  /** And two conditions likewise: Prone before Incapacitated, as printed. */
  it('applies two conditions in the order the SRD sentence names them', () => {
    const out = cast(SETUP, { spellId: 'hideous-laughter', targets: [TARGET], slotLevel: 1 }, -40);
    expect(
      out.events
        .filter((e) => e.type === 'condition-applied')
        .map((e) => (e.type === 'condition-applied' ? e.condition : '')),
    ).toEqual(['prone', 'incapacitated']);
  });
});
