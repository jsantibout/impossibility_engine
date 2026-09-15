import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap, type CharacterId, type Result } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { checkContent } from './content.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { beginRest } from './rest.js';
import { attuneItem, equipItem, resolveAttack, resolveAttackDamage } from './commands.js';
import { standingAttackDamage } from './standing.js';
import type { DamageDefenses } from './attack.js';

/**
 * Extra damage narrowed to the weapon that dealt it.
 *
 * `flat-bonus` gained `onlyWithItem` when the +1 weapons were transcribed:
 * SRD *Weapon, +1* says "a bonus to attack rolls and damage rolls **made with
 * this magic weapon**", so a +1 Longsword does nothing for the bow in the same
 * pack. `attack-damage` — the neighbouring member, the shape a feature's extra
 * die is written in — had no such clause, and it is the commonest sentence a
 * magic weapon prints:
 *
 * - **Vicious Weapon** — "This magic weapon deals an extra 2d6 damage to any
 *   creature it hits. This extra damage is of the same type as the weapon's
 *   normal damage." The whole item, and the reason it was not in the
 *   catalogue at all until the narrowing existed.
 * - **Sword of Wounding** — "the target takes an extra 2d6 Necrotic damage".
 * - **Frost Brand** — "When you hit with an attack roll using this magic
 *   weapon, the target takes an extra 1d6 Cold damage".
 *
 * Without the narrowing the die is hung on the *creature*, so a character who
 * owned one of these would add it to every weapon they swung — which is a
 * better weapon than the book prints, and the failure the flat bonus's own
 * brief found is the part most easily got wrong.
 */

const id = (s: string) => asCharacterId(s);
const FIGHTER = id('fighter');
const GOBLIN = id('goblin');

const VICIOUS = 'vicious-weapon';
const WOUNDING = 'sword-of-wounding';
const FROST = 'frost-brand';
const PLAIN = 'longsword';

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 5,
  abilities: { str: 18, dex: 14, con: 14, int: 10, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: null,
  weaponProficiencies: ['simple', 'martial'],
  ...over,
});

const added = (
  who: CharacterId,
  side: string,
  maxHp: number,
  defenses: Readonly<Record<string, DamageDefenses>> = {},
): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet:
    who === GOBLIN
      ? sheet({ abilities: { str: 8, dex: 14, con: 10, int: 10, wis: 8, cha: 8 } })
      : sheet(),
  maxHp,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side,
  defenses,
});

/**
 * The table, with a goblin whose defences the caller chooses.
 *
 * **Immunity to the weapon's own type is what makes an extra typed die
 * readable**: with the Slashing taken to zero the only damage that lands is
 * the sword's Necrotic or the brand's Cold, so the landed total *is* the extra
 * entry — which a die folded anonymously into the weapon's own component could
 * never be.
 */
const table = (defenses: Readonly<Record<string, DamageDefenses>> = {}): readonly GameEvent[] => [
  added(FIGHTER, 'party', 40),
  added(GOBLIN, 'goblins', 200, defenses),
  {
    type: 'items-gained',
    id: FIGHTER,
    items: [
      { id: VICIOUS, quantity: 1 },
      { id: WOUNDING, quantity: 1 },
      { id: FROST, quantity: 1 },
      { id: PLAIN, quantity: 1 },
      { id: 'shortbow', quantity: 1 },
    ],
    source: 'the hoard',
  },
  { type: 'scene-set', extent: { width: 600, depth: 600, height: 40 } },
  { type: 'landmark-added', name: 'the road', at: { x: 200, y: 200, z: 0 } },
  { type: 'creature-placed', id: FIGHTER, placement: { from: { landmark: 'the road' }, feet: 0 } },
  {
    type: 'creature-placed',
    id: GOBLIN,
    placement: { from: { creature: FIGHTER }, feet: 5, bearing: 0 },
  },
];

const supply = (seed = 'swing') => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

const run = (
  log: readonly GameEvent[],
  command: (s: GameState) => Result<GameEvent[]>,
): readonly GameEvent[] => [...log, ...unwrap(command(fold('seed', log)), 'command')];

/** Take it in hand, and attune to it where its own line prints the bracket. */
const wielding = (log: readonly GameEvent[], itemId: string): readonly GameEvent[] => {
  const equipped = run(log, (s) => equipItem(s, SRD_CONTENT, FIGHTER, itemId));
  if (SRD_CONTENT.item(itemId)?.attunement === undefined) return equipped;

  const resting =
    fold('seed', equipped).creatures.fighter?.resting == null
      ? run(equipped, (s) => beginRest(s, FIGHTER, 'short'))
      : equipped;
  return run(resting, (s) => attuneItem(s, SRD_CONTENT, FIGHTER, itemId));
};

const swing = (log: readonly GameEvent[], weapon: string, seed = 'blow') =>
  unwrap(
    resolveAttack(fold('seed', log), FIGHTER, { target: GOBLIN, weapon, free: true }, supply(seed)),
    'attack',
  );

describe('the narrowing bites on damage: “this magic weapon”, and no other', () => {
  /**
   * **The single assertion this whole file exists for.** One character, two
   * weapons in hand, and the extra dice on exactly one of them.
   *
   * The plain Longsword is compared against the *same* swing made by somebody
   * who does not own the Vicious Weapon at all: same seed, same weapon, so any
   * die the narrowing failed to withhold would show up as a difference. It
   * does not, and the byte-identical total is the narrowing working.
   *
   * Mutating `onlyWithItem` away — deleting the `continue` in
   * `standingAttackDamage` — puts the 2d6 on both, and this fails.
   */
  it('deals the extra dice with the Vicious Weapon and not with the plain sword', () => {
    const armed = wielding(table(), VICIOUS);
    const alsoPlain = run(armed, (s) => equipItem(s, SRD_CONTENT, FIGHTER, PLAIN));

    const vicious = swing(alsoPlain, VICIOUS);
    const plain = swing(alsoPlain, PLAIN);
    const noVicious = swing(run(table(), (s) => equipItem(s, SRD_CONTENT, FIGHTER, PLAIN)), PLAIN);

    expect(vicious.attack!.hit).toBe(true);
    expect(plain.attack!.hit).toBe(true);

    // The plain sword swung with the Vicious Weapon on the same belt deals
    // exactly what it deals with the Vicious Weapon nowhere near it.
    expect(plain.damage).toBe(noVicious.damage);

    // And the Vicious Weapon's own swing carries 2d6 the plain one does not.
    const extra = vicious.damage! - plain.damage!;
    expect(extra).toBeGreaterThanOrEqual(2);
    expect(extra).toBeLessThanOrEqual(12);
  });

  /** The same, for a bow the holder never enchanted. */
  it('follows nobody onto a second weapon of a different kind', () => {
    const apart = (log: readonly GameEvent[]): readonly GameEvent[] => [
      ...log,
      {
        type: 'creature-moved',
        id: GOBLIN,
        placement: { from: { creature: FIGHTER }, feet: 30, bearing: 0 },
      },
    ];

    const withSword = swing(
      apart(run(wielding(table(), VICIOUS), (s) => equipItem(s, SRD_CONTENT, FIGHTER, 'shortbow'))),
      'shortbow',
    );
    const without = swing(
      apart(run(table(), (s) => equipItem(s, SRD_CONTENT, FIGHTER, 'shortbow'))),
      'shortbow',
    );
    expect(withSword.attack!.hit).toBe(true);
    expect(withSword.damage).toBe(without.damage);
  });

  /**
   * The entry is the item's own, by name, rather than a die folded into the
   * weapon's component: `standingAttackDamage` is what the damage path reads,
   * and what it hands back says which object dealt it.
   */
  it('names the item that dealt it', () => {
    const state = fold('seed', wielding(table(), VICIOUS));
    const context = {
      ability: 'str' as const,
      melee: true,
      weapon: SRD_CONTENT.item(VICIOUS)?.weapon ?? null,
      mode: 'normal' as const,
      target: GOBLIN,
      turn: null,
    };

    expect(standingAttackDamage(state, FIGHTER, { ...context, withItem: VICIOUS }).bonuses).toEqual([
      { source: 'Vicious Weapon', dice: '2d6' },
    ]);
    expect(
      standingAttackDamage(state, FIGHTER, { ...context, withItem: PLAIN }).bonuses,
    ).toEqual([]);
    // A caller who does not say reads as a roll made with nothing, which is the
    // conservative direction and the one `BonusContext` already takes.
    expect(standingAttackDamage(state, FIGHTER, context).bonuses).toEqual([]);
  });
});

describe('the hold narrows on the same fact the swing does', () => {
  /**
   * SRD Divine Smite is taken "immediately after hitting a target", so an
   * attack can land and have its damage rolled a command later. The weapon it
   * was made with is written into `attack-landed` at that moment, which is the
   * whole reason a held attack survives a reload — and it is what the
   * narrowing reads on the second half.
   *
   * Two weapons in hand and two held attacks: the Vicious Weapon's carries the
   * 2d6 and the plain Longsword's carries nothing, exactly as the unheld pair
   * above. A call site that forgot to pass `withItem` here would put the die
   * on both, and nothing else in the suite would say so.
   */
  it('deals the held Vicious Weapon’s dice, and no other held weapon’s', () => {
    const armed = run(wielding(table(), VICIOUS), (s) =>
      equipItem(s, SRD_CONTENT, FIGHTER, PLAIN),
    );

    const held = (weapon: string): number => {
      const landed = unwrap(
        resolveAttack(
          fold('seed', armed),
          FIGHTER,
          { target: GOBLIN, weapon, free: true, hold: true },
          supply('held'),
        ),
        'hold',
      );
      expect(landed.attack!.hit).toBe(true);
      const log = [...armed, ...landed.events];
      const dealt = unwrap(
        resolveAttackDamage(fold('seed', log), FIGHTER, {}, supply('damage')),
        'held damage',
      );
      return dealt.damage!;
    };

    const extra = held(VICIOUS) - held(PLAIN);
    expect(extra).toBeGreaterThanOrEqual(2);
    expect(extra).toBeLessThanOrEqual(12);
  });
});

describe('each finished item, through the public API', () => {
  /**
   * SRD Vicious Weapon: "This extra damage is of the same type as the weapon's
   * normal damage." So it is a *bonus* rather than *extra* — it meets the
   * target's defences with the blade, and a creature Immune to Slashing takes
   * nothing from either half.
   */
  it('gives the Vicious Weapon’s 2d6 the weapon’s own type', () => {
    const immune = wielding(table({ slashing: { immune: true } }), VICIOUS);
    expect(swing(immune, VICIOUS).damage).toBe(0);

    const ordinary = wielding(table(), VICIOUS);
    expect(swing(ordinary, VICIOUS).damage!).toBeGreaterThan(0);
  });

  /**
   * SRD Sword of Wounding: "the target takes an extra 2d6 Necrotic damage".
   * Necrotic, so Slashing Immunity does nothing to it — and with the sword's
   * own damage taken to zero the landed total *is* the extra entry.
   */
  it('lands the Sword of Wounding’s 2d6 as Necrotic beside the blade', () => {
    const out = swing(wielding(table({ slashing: { immune: true } }), WOUNDING), WOUNDING);
    expect(out.attack!.hit).toBe(true);
    expect(out.damage!).toBeGreaterThanOrEqual(2);
    expect(out.damage!).toBeLessThanOrEqual(12);
  });

  /**
   * SRD Frost Brand: "When you hit with an attack roll using this magic
   * weapon, the target takes an extra 1d6 Cold damage."
   */
  it('lands the Frost Brand’s 1d6 as Cold beside the blade', () => {
    const out = swing(wielding(table({ slashing: { immune: true } }), FROST), FROST);
    expect(out.attack!.hit).toBe(true);
    expect(out.damage!).toBeGreaterThanOrEqual(1);
    expect(out.damage!).toBeLessThanOrEqual(6);
  });

  /**
   * The bracket is a requirement, not a label: both swords print "(Requires
   * Attunement)", and a character who has only picked one up gets nothing.
   */
  it('withholds a bracketed sword’s die until the attunement', () => {
    const held = run(table({ slashing: { immune: true } }), (s) =>
      equipItem(s, SRD_CONTENT, FIGHTER, WOUNDING),
    );
    expect(swing(held, WOUNDING).damage).toBe(0);
  });
});

describe('the validator refuses the narrowing where it could never hold', () => {
  /**
   * The mirror of `item_narrowing_on_a_feature` for the flat bonus, and the
   * same door in the same wall: the clause is read against the granting
   * *item's* id, and a class feature has none — so a Barbarian's Rage Damage
   * written this way would grant nothing at all, silently.
   */
  it('refuses it on a class feature, which names no item', () => {
    const fighter = SRD_CONTENT.classes.find((definition) => definition.id === 'fighter');
    if (fighter === undefined) throw new Error('no Fighter to borrow a table from');

    const problems = checkContent({
      classes: [
        {
          ...fighter,
          features: [
            {
              id: 'fighter:a-narrowed-die',
              name: 'A Narrowed Die',
              level: 1,
              automation: 'engine',
              note: 'Extra damage narrowed to an item no class feature has.',
              grants: {
                kind: 'standing',
                reach: 'self',
                effects: [{ kind: 'attack-damage', dice: '1d6', onlyWithItem: true }],
              },
            },
          ],
        },
      ],
    });
    expect(problems.map((problem) => problem.code)).toContain('item_narrowing_on_a_feature');
  });

  /** And accepts the same effect without it, which is what Rage Damage is. */
  it('accepts a feature’s extra die that narrows to nothing', () => {
    const fighter = SRD_CONTENT.classes.find((definition) => definition.id === 'fighter');
    if (fighter === undefined) throw new Error('no Fighter to borrow a table from');

    const problems = checkContent({
      classes: [
        {
          ...fighter,
          features: [
            {
              id: 'fighter:an-open-die',
              name: 'An Open Die',
              level: 1,
              automation: 'engine',
              note: 'Extra damage on every weapon, which is what a feature grants.',
              grants: {
                kind: 'standing',
                reach: 'self',
                effects: [{ kind: 'attack-damage', dice: '1d6' }],
              },
            },
          ],
        },
      ],
    });
    expect(problems).toEqual([]);
  });
});
