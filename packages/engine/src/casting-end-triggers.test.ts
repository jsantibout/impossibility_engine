import { describe, expect, it } from 'vitest';
import { asCharacterId, expect as unwrap, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { declaredCasting } from './spellcasting.js';
import { armorClassOf } from './standing.js';
import { definitionFor } from './spell-definitions.js';
import { checkSpellDefinition } from './spell-schema.js';
import {
  equipItem,
  ongoingSpellOf,
  resolveAttack,
  resolveDamage,
  resolveSpell,
  withheldEndings,
} from './commands.js';

/**
 * A casting the SRD ends before its time, and the derived pass that ends it.
 *
 * Five sentences in the book stop a running spell when something *happens* —
 * the target swings, the target casts, the target puts armour on, the caster
 * or an ally hits the creature they charmed. Nobody decides any of those, so
 * this is derived after every event exactly as a lost Concentration and an
 * expired deadline are: no event, no command, no obligation for a caller to
 * remember.
 *
 * | Member | SRD |
 * |---|---|
 * | `target-attacks`, `target-deals-damage`, `target-casts` | Invisibility: "The spell ends early immediately after the target makes an attack roll, deals damage, or casts a spell." |
 * | `target-dons-armor` | Mage Armor: "The spell ends early if the target dons armor." |
 * | `caster-or-ally-damages-target` | Animal Friendship: "If you or one of your allies deals damage to the target, the spells ends." |
 *
 * **The scope is printed too, and it is not one answer.** Animal Friendship
 * and Mage Armor say "the spell ends"; Charm Person says the Charmed condition
 * lasts "until the spell ends or until you or your allies damage **it**", and
 * Mass Suggestion spells it out — "the spell ends for a target". So a trigger
 * says which, and the two are `releaseCasting` and `releaseOnTarget`, both of
 * which already existed.
 */

const id = (s: string) => asCharacterId(s);
const WIZ = id('wiz');
const ALLY = id('ally');
const STRANGER = id('stranger');
const FOE = id('foe');
const BEAST = id('beast');

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 9,
  abilities: { str: 14, dex: 14, con: 12, int: 18, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'int',
  weaponProficiencies: ['simple', 'martial'],
  ...over,
});

const PREPARED = [
  'invisibility',
  'mage-armor',
  'animal-friendship',
  'charm-person',
  'suggestion',
  'fire-bolt',
  'greater-invisibility',
];

const added = (
  who: CharacterId,
  side: string | null,
  creatureType: string,
  over: Partial<CharacterSheet> = {},
): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(over),
  maxHp: 80,
  diesAtZero: false,
  creatureType,
  ...(side === null ? {} : { side }),
});

const casts = (who: CharacterId): readonly GameEvent[] => [
  {
    type: 'spellcasting-declared',
    id: who,
    spellcasting: declaredCasting({ ability: 'int', prepared: PREPARED }),
  },
  ...[1, 2, 3, 4].map(
    (level): GameEvent => ({
      type: 'resource-pool-declared',
      id: who,
      pool: { key: `spell-slot:${level}`, label: `level ${level}`, max: 4, recovers: 'long-rest' },
    }),
  ),
];

/**
 * A Wisdom the save cannot make, so the charm always lands.
 *
 * Forcing the branch rather than waiting for a seed that reaches it: the save
 * DC is 16 and a −5 modifier needs a 21, so every fixture below starts from
 * the state it is actually about. Nothing here is testing the saving throw.
 */
const DOOMED: Partial<CharacterSheet> = {
  abilities: { str: 14, dex: 14, con: 12, int: 10, wis: 1, cha: 10 },
};

const supply = (seed = 'ends') => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
});

/**
 * Everybody within touch of the wizard, so Range: Touch is never the reason a
 * casting is refused and the fixture is testing what it says it is.
 */
const setup = (sides: { wiz?: string | null; ally?: string | null } = {}): GameEvent[] => [
  added(WIZ, sides.wiz === undefined ? 'party' : sides.wiz, 'Humanoid'),
  added(ALLY, sides.ally === undefined ? 'party' : sides.ally, 'Humanoid'),
  added(STRANGER, null, 'Humanoid', DOOMED),
  added(FOE, 'foes', 'Humanoid', DOOMED),
  added(BEAST, 'foes', 'Beast', DOOMED),
  ...casts(WIZ),
  { type: 'scene-set', extent: { width: 600, depth: 600, height: 40 } },
  { type: 'landmark-added', name: 'the hall', at: { x: 200, y: 200, z: 0 } },
  { type: 'creature-placed', id: WIZ, placement: { from: { landmark: 'the hall' }, feet: 0 } },
  { type: 'creature-placed', id: ALLY, placement: { from: { creature: WIZ }, feet: 5, bearing: 0 } },
  {
    type: 'creature-placed',
    id: STRANGER,
    placement: { from: { creature: WIZ }, feet: 5, bearing: 90 },
  },
  { type: 'creature-placed', id: FOE, placement: { from: { creature: ALLY }, feet: 5, bearing: 0 } },
  {
    type: 'creature-placed',
    id: BEAST,
    placement: { from: { creature: WIZ }, feet: 5, bearing: 270 },
  },
  { type: 'sight-declared', from: WIZ, to: ALLY, seen: true },
  { type: 'sight-declared', from: WIZ, to: STRANGER, seen: true },
  { type: 'sight-declared', from: WIZ, to: FOE, seen: true },
  { type: 'sight-declared', from: WIZ, to: BEAST, seen: true },
  { type: 'sight-declared', from: ALLY, to: FOE, seen: true },
  {
    type: 'items-gained',
    id: ALLY,
    items: [
      { id: 'chain-shirt', quantity: 1 },
      { id: 'shield', quantity: 1 },
    ],
    source: 'the quartermaster',
  },
];

class Game {
  constructor(readonly events: GameEvent[]) {}

  get state(): GameState {
    return fold('seed', this.events);
  }

  push(more: readonly GameEvent[]): this {
    this.events.push(...more);
    return this;
  }

  /**
   * `fought` is IE-030's stated fact, required by the two Charms; every
   * fixture here answers "none of them", because what is under test is what
   * ends the casting rather than how its save came out.
   */
  cast(
    who: CharacterId,
    spellId: string,
    targets: readonly CharacterId[],
    slotLevel?: number,
  ): string {
    const fought = ['charm-person', 'charm-monster'].includes(spellId) ? { fought: [] } : {};
    const out = unwrap(
      resolveSpell(
        this.state,
        who,
        { spellId, targets, ...fought, ...(slotLevel === undefined ? {} : { slotLevel }) },
        supply(spellId),
      ),
      `${who} casting ${spellId}`,
    );
    this.push(out.events);
    return out.castingId;
  }

  /** Damage one creature, naming who dealt it — the fact the trigger reads. */
  hit(target: CharacterId, by: CharacterId | null, amount = 5): this {
    const out = unwrap(
      resolveDamage(
        this.state,
        target,
        { amount, source: 'a blow', ...(by === null ? {} : { by }) },
        supply(`hit-${target}-${String(by)}`),
      ),
      `damaging ${target}`,
    );
    return this.push(out.events);
  }

  running(castingId: string): boolean {
    return ongoingSpellOf(this.state, castingId) !== null;
  }

  on(castingId: string): readonly string[] {
    return ongoingSpellOf(this.state, castingId)?.on ?? [];
  }

  conditions(who: CharacterId): readonly string[] {
    return this.state.creatures[who]?.conditions.conditions ?? [];
  }
}

/** A fight, so a weapon attack spends the Attack action and says so. */
const IN_COMBAT: readonly GameEvent[] = [
  {
    type: 'combat-started',
    combatants: [
      { id: ALLY, initiative: 20, speed: 30 },
      { id: FOE, initiative: 10, speed: 30 },
    ],
  },
];

describe('Invisibility ends early when its target acts', () => {
  it('ends when the target makes an attack roll', () => {
    const game = new Game([...setup(), ...IN_COMBAT]);
    const casting = game.cast(WIZ, 'invisibility', [ALLY]);
    expect(game.conditions(ALLY)).toContain('invisible');

    const swing = unwrap(
      resolveAttack(game.state, ALLY, { target: FOE, weapon: null }, supply('swing')),
      'the invisible ally swings',
    );
    game.push(swing.events);

    expect(game.running(casting)).toBe(false);
    expect(game.conditions(ALLY)).not.toContain('invisible');
  });

  it('ends when the target deals damage', () => {
    const game = new Game(setup());
    const casting = game.cast(WIZ, 'invisibility', [ALLY]);

    game.hit(FOE, ALLY);

    expect(game.running(casting)).toBe(false);
    expect(game.conditions(ALLY)).not.toContain('invisible');
  });

  it('ends when the target casts a spell', () => {
    const game = new Game(setup());
    const casting = game.cast(WIZ, 'invisibility', [WIZ]);
    expect(game.conditions(WIZ)).toContain('invisible');

    game.cast(WIZ, 'fire-bolt', [FOE]);

    expect(game.running(casting)).toBe(false);
    expect(game.conditions(WIZ)).not.toContain('invisible');
  });

  /**
   * The trigger reads the creature the casting is **on**, never whoever the
   * event names. A fixture whose invisible creature is also the one acting
   * cannot tell those two readings apart.
   */
  it('is unmoved by somebody else acting', () => {
    const game = new Game([...setup(), ...IN_COMBAT]);
    const casting = game.cast(WIZ, 'invisibility', [STRANGER]);

    game.push(
      unwrap(
        resolveAttack(game.state, ALLY, { target: FOE, weapon: null }, supply('bystander')),
        'a bystander swings',
      ).events,
    );
    game.hit(FOE, ALLY);

    expect(game.running(casting)).toBe(true);
    expect(game.conditions(STRANGER)).toContain('invisible');
  });

  /**
   * Greater Invisibility prints the first sentence and not the second, which
   * is the whole of the difference between the two spells — so a trigger list
   * the engine applied to both would be a neighbouring spell's clause lent to
   * one that never had it.
   */
  it('leaves Greater Invisibility alone, which prints no such sentence', () => {
    const game = new Game(setup());
    const casting = game.cast(WIZ, 'greater-invisibility', [ALLY]);

    game.hit(FOE, ALLY);

    expect(game.running(casting)).toBe(true);
    expect(game.conditions(ALLY)).toContain('invisible');
  });
});

describe('Mage Armor ends when its target dons armour', () => {
  it('ends the casting and takes the Armour Class it granted with it', () => {
    const game = new Game(setup());
    const casting = game.cast(WIZ, 'mage-armor', [ALLY]);
    // 13 + Dex 2, against the unarmoured 10 + 2 it would otherwise be.
    expect(armorClassOf(game.state, ALLY)).toBe(15);

    game.push(unwrap(equipItem(game.state, ALLY, 'chain-shirt'), 'donning armour'));

    expect(game.running(casting)).toBe(false);
    expect(game.state.creatures[ALLY]?.armorClasses).toEqual([]);
    // Chain Shirt is 13 + Dex (max 2).
    expect(armorClassOf(game.state, ALLY)).toBe(15);
  });

  /**
   * **A Shield is not armour you don**, and only a Shield can tell the two
   * readings apart. The spell's own targeting clause already reads the body
   * slot — `mustBeUnarmored`, and `shieldAllowed: true` beside the base — so
   * the ending reads the same slot, and a Shield taken up leaves the casting
   * standing with its +2 on top of the granted base.
   */
  it('is unmoved by a Shield, which is not the slot the sentence names', () => {
    const game = new Game(setup());
    const casting = game.cast(WIZ, 'mage-armor', [ALLY]);

    game.push(unwrap(equipItem(game.state, ALLY, 'shield'), 'taking up a shield'));

    expect(game.running(casting)).toBe(true);
    expect(armorClassOf(game.state, ALLY)).toBe(17);
  });

  it('is unmoved by somebody else donning armour', () => {
    const game = new Game(setup());
    const casting = game.cast(WIZ, 'mage-armor', [WIZ]);

    game.push(unwrap(equipItem(game.state, ALLY, 'chain-shirt'), 'donning armour'));

    expect(game.running(casting)).toBe(true);
  });
});

describe('a charm ends when the caster or an ally damages the target', () => {
  it('ends Animal Friendship outright, which is what its sentence says', () => {
    const game = new Game(setup());
    const casting = game.cast(WIZ, 'animal-friendship', [BEAST]);
    expect(game.conditions(BEAST)).toContain('charmed');

    game.hit(BEAST, WIZ);

    expect(game.running(casting)).toBe(false);
    expect(game.conditions(BEAST)).not.toContain('charmed');
  });

  it('ends it for a declared ally of the caster too', () => {
    const game = new Game(setup());
    const casting = game.cast(WIZ, 'animal-friendship', [BEAST]);

    game.hit(BEAST, ALLY);

    expect(game.running(casting)).toBe(false);
  });

  it('is unmoved by a creature on another side', () => {
    const game = new Game(setup());
    const casting = game.cast(WIZ, 'animal-friendship', [BEAST]);

    game.hit(BEAST, FOE);

    expect(game.running(casting)).toBe(true);
    expect(game.conditions(BEAST)).toContain('charmed');
  });

  /**
   * SRD Charm Person releases the **condition** on the creature that was hit
   * and says nothing about the others, which is exactly what `releaseOnTarget`
   * is for. A one-target fixture cannot tell that from ending the casting.
   */
  it('releases a multi-target charm on the damaged target only', () => {
    const game = new Game(setup());
    const casting = game.cast(WIZ, 'charm-person', [FOE, STRANGER], 2);
    expect(game.on(casting)).toEqual([FOE, STRANGER].sort());

    game.hit(FOE, WIZ);

    expect(game.running(casting)).toBe(true);
    expect(game.on(casting)).toEqual([STRANGER]);
    expect(game.conditions(FOE)).not.toContain('charmed');
    expect(game.conditions(STRANGER)).toContain('charmed');
  });

  it('ends Suggestion on its target', () => {
    const game = new Game(setup());
    const casting = game.cast(WIZ, 'suggestion', [FOE]);
    expect(game.conditions(FOE)).toContain('charmed');

    game.hit(FOE, ALLY);

    expect(game.conditions(FOE)).not.toContain('charmed');
    expect(game.on(casting)).toEqual([]);
  });
});

describe('an ally nobody has declared is withheld, not invented', () => {
  it('leaves the casting running when the dealer has no declared side', () => {
    const game = new Game(setup());
    const casting = game.cast(WIZ, 'animal-friendship', [BEAST]);

    game.hit(BEAST, STRANGER);

    expect(game.running(casting)).toBe(true);
    expect(game.conditions(BEAST)).toContain('charmed');
  });

  it('leaves it running when the caster has no declared side', () => {
    const game = new Game(setup({ wiz: null }));
    const casting = game.cast(WIZ, 'animal-friendship', [BEAST]);

    game.hit(BEAST, ALLY);

    expect(game.running(casting)).toBe(true);
  });

  /** The caster is never in doubt: "you or one of your allies" names them. */
  it('still ends it when the caster themself deals the damage', () => {
    const game = new Game(setup({ wiz: null }));
    const casting = game.cast(WIZ, 'animal-friendship', [BEAST]);

    game.hit(BEAST, WIZ);

    expect(game.running(casting)).toBe(false);
  });

  /**
   * A derived pass has no `unverified` line to write, so the fact that an
   * ending was withheld is a question a caller asks rather than a sentence
   * nobody reads.
   */
  it('says which castings and which creatures it cannot judge', () => {
    const game = new Game(setup());
    const casting = game.cast(WIZ, 'animal-friendship', [BEAST]);

    const withheld = withheldEndings(game.state);
    expect(withheld.map((entry) => entry.castingId)).toEqual([casting]);
    expect(withheld[0]?.spell).toBe('Animal Friendship');
    expect(withheld[0]?.unjudged).toEqual([STRANGER]);
    expect(withheld[0]?.reason.length).toBeGreaterThan(20);
  });

  it('asks nothing when every side is declared', () => {
    const game = new Game(setup().filter((e) => !(e.type === 'creature-added' && e.id === STRANGER)));
    game.cast(WIZ, 'animal-friendship', [BEAST]);
    expect(withheldEndings(game.state)).toEqual([]);
  });

  it('asks nothing about a casting with no such trigger', () => {
    const game = new Game(setup());
    game.cast(WIZ, 'invisibility', [ALLY]);
    expect(withheldEndings(game.state)).toEqual([]);
  });
});

describe('the triggers are pinned on the record at the cast', () => {
  /**
   * IE-007's rule, applied to one more field: a correction to a definition
   * must not reach a casting made before it. The fold reads the record, so a
   * record written without the field ends nothing however the catalogue reads
   * now — and a record that carries one ends even for a spell whose definition
   * has none.
   */
  it('leaves a version 2 record with no triggers alone', () => {
    const game = new Game(setup());
    const casting = game.cast(WIZ, 'invisibility', [ALLY]);
    const record = ongoingSpellOf(game.state, casting);
    expect(record?.endsEarly).toBeDefined();

    const stripped = new Game(
      game.events.map((event) =>
        event.type === 'spell-ongoing'
          ? {
              ...event,
              casting: Object.fromEntries(
                Object.entries(event.casting).filter(([key]) => key !== 'endsEarly'),
              ) as typeof event.casting,
            }
          : event,
      ),
    );
    stripped.hit(FOE, ALLY);
    expect(stripped.running(casting)).toBe(true);
  });

  it('ends a casting whose record carries a trigger its definition does not', () => {
    const game = new Game(setup());
    const casting = game.cast(WIZ, 'greater-invisibility', [ALLY]);
    expect(definitionFor('greater-invisibility')?.endsEarly).toBeUndefined();

    const lent = new Game(
      game.events.map((event) =>
        event.type === 'spell-ongoing'
          ? {
              ...event,
              casting: {
                ...event.casting,
                endsEarly: [{ on: 'target-deals-damage', ends: 'casting' }],
              },
            }
          : event,
      ),
    );
    lent.hit(FOE, ALLY);
    expect(lent.running(casting)).toBe(false);
  });
});

describe('the validator holds a trigger list to the SRD shapes', () => {
  const base = definitionFor('invisibility')!;

  const codes = (over: Record<string, unknown>): readonly string[] =>
    checkSpellDefinition({ ...base, ...over } as never).map((problem) => problem.code);

  it('accepts the catalogue as it stands', () => {
    expect(codes({})).toEqual([]);
  });

  /**
   * **An empty list is a rule rather than a guard against a throw**, and it
   * needs a definition that would otherwise validate clean — Invisibility,
   * which persists — or `end_trigger_without_casting` answers first and the
   * case proves nothing. That is how it was first written, and a mutation
   * removing the rule left it green.
   *
   * A spell that prints no such sentence omits the field; an empty list is an
   * author who meant to write one, which is the same reading `unaffected`
   * takes when it elides its own empty list.
   */
  it('refuses an empty list, on a definition nothing else would refuse', () => {
    expect(codes({})).toEqual([]);
    expect(codes({ endsEarly: [] })).toEqual(['malformed_field']);
  });

  it('refuses a cause the engine cannot detect', () => {
    expect(codes({ endsEarly: [{ on: 'target-sneezes', ends: 'casting' }] })).toContain(
      'unknown_end_trigger',
    );
  });

  it('refuses a scope that is neither the casting nor the target', () => {
    expect(codes({ endsEarly: [{ on: 'target-casts', ends: 'maybe' }] })).toContain(
      'unknown_end_scope',
    );
  });

  it('refuses the same cause written twice', () => {
    expect(
      codes({
        endsEarly: [
          { on: 'target-casts', ends: 'casting' },
          { on: 'target-casts', ends: 'target' },
        ],
      }),
    ).toContain('duplicate_end_trigger');
  });

  /**
   * A casting that never becomes ongoing is over the moment it resolves, so a
   * trigger on it names a moment that can never arrive — the same rule
   * `grant_without_lifetime` applies to a grant with nothing to end it.
   */
  it('refuses a trigger on a casting that never runs', () => {
    expect(
      codes({
        concentration: false,
        durationSeconds: undefined,
        untilDispelled: undefined,
        endsEarly: [{ on: 'target-casts', ends: 'casting' }],
      }),
    ).toContain('end_trigger_without_casting');
  });
});

describe('the derived pass settles, and settles once', () => {
  /**
   * One event, two causes, two castings — which is the case the loop exists
   * for. The ally strikes the charmed Beast: that is `target-deals-damage`
   * for the invisible ally *and* `caster-or-ally-damages-target` for the
   * Beast, both off one `damage-taken`.
   *
   * The measure that makes the loop terminate is `|ongoing| + Σ|on|`: every
   * pass either deletes a record or takes the subject out of `on`, and the
   * match requires the subject to have been in it.
   */
  it('ends two castings that one event triggers', () => {
    const game = new Game(setup());
    const invisibility = game.cast(WIZ, 'invisibility', [ALLY]);
    const friendship = game.cast(WIZ, 'animal-friendship', [BEAST]);
    expect(game.running(invisibility)).toBe(true);
    expect(game.running(friendship)).toBe(true);

    game.hit(BEAST, ALLY);

    expect(game.running(invisibility)).toBe(false);
    expect(game.running(friendship)).toBe(false);
  });

  /** Two castings on one creature, ended by one blow. */
  it('ends every casting the same creature carries', () => {
    const game = new Game(setup());
    const first = game.cast(WIZ, 'invisibility', [ALLY]);
    const second = game.cast(WIZ, 'invisibility', [ALLY], 3);

    game.hit(FOE, ALLY);

    expect(game.running(first)).toBe(false);
    expect(game.running(second)).toBe(false);
  });

  /**
   * Derived means the log says nothing, so the only proof the pass settles is
   * that the fold is a function of the log — at every prefix, and the same
   * twice.
   */
  it('folds the same log to the same state, at every prefix', () => {
    const game = new Game(setup());
    game.cast(WIZ, 'invisibility', [ALLY]);
    game.cast(WIZ, 'animal-friendship', [BEAST]);
    game.hit(BEAST, ALLY);

    for (let n = 0; n <= game.events.length; n += 1) {
      const slice = game.events.slice(0, n);
      expect(() => fold('seed', slice)).not.toThrow();
      expect(JSON.stringify(fold('seed', slice))).toEqual(JSON.stringify(fold('seed', slice)));
    }
  });

  /**
   * And it writes nothing. Expiry and a broken Concentration are derived for
   * the same reason and record nothing either — the audit trade CLAUDE.md
   * already states — so a `spell-ended` here would be the engine claiming
   * somebody decided this.
   */
  it('records no event for an ending nobody decided', () => {
    const game = new Game(setup());
    const casting = game.cast(WIZ, 'animal-friendship', [BEAST]);
    const before = game.events.length;
    game.hit(BEAST, WIZ);

    const written = game.events.slice(before).map((event) => event.type);
    expect(written).not.toContain('spell-ended');
    expect(game.running(casting)).toBe(false);
  });
});

describe('a pre-versioned record is read from the catalogue, as its area is', () => {
  /**
   * IE-007's compatibility path, applied to one more field. A record written
   * before `endsEarly` existed never wrote the fact down, so the catalogue is
   * the only place it was ever recorded — which is exactly `upgradeOngoing`'s
   * own argument for the area, and is why version 2 was not bumped: running a
   * version 2 record through the upgrade would overwrite a **pinned** area
   * with the book as it reads now, which is the hazard pinning it was for.
   */
  it('fills the triggers for a record with no version', () => {
    const game = new Game(setup());
    const casting = game.cast(WIZ, 'invisibility', [ALLY]);

    const legacy = new Game(
      game.events.map((event) => {
        if (event.type !== 'spell-ongoing') return event;
        const rest = Object.fromEntries(
          Object.entries(event.casting).filter(
            ([key]) => key !== 'version' && key !== 'endsEarly',
          ),
        );
        return { ...event, casting: rest as typeof event.casting };
      }),
    );
    expect(ongoingSpellOf(legacy.state, casting)?.endsEarly).toEqual(
      definitionFor('invisibility')?.endsEarly,
    );

    legacy.hit(FOE, ALLY);
    expect(legacy.running(casting)).toBe(false);
  });
});
