import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap, type CharacterId, type Result } from '@ie/shared';
import { bonusesFor, bonusesInForce } from './bonuses.js';
import type { CatalogueItem } from './catalogue.js';
import { itemConferral } from './catalogue.js';
import type { CharacterSheet } from './character.js';
import { checkContent } from './content.js';
import { createRng, restoreRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { beginRest, endRest } from './rest.js';
import { declaredCasting } from './spellcasting.js';
import { armorClassOf, speedOf } from './standing.js';
import {
  advanceTime,
  attuneItem,
  endConcentration,
  equipItem,
  resolveAttack,
  resolveSpell,
  resolveTest,
  resolveTurn,
  useItem,
} from './commands.js';

/**
 * SRD "Combining Spell Effects" (`raw/spells.md`):
 *
 * > "The effects of different spells add together while their durations
 * > overlap. In contrast, the effects of the same spell cast multiple times
 * > don't combine. Instead, the most potent effect—such as the highest
 * > bonus—from those castings applies while their durations overlap. The most
 * > recent effect applies if the castings are equally potent and their
 * > durations overlap. For example, if two Clerics cast _Bless_ on the same
 * > target, that target gains the spell's benefit only once; the target
 * > doesn't receive two bonus dice. But if the durations of the spells
 * > overlap, the effect continues until the duration of the second _Bless_
 * > ends."
 *
 * And two potions that print "the effect of" a spell, so count as it: SRD
 * Potion of Speed ("you gain the effect of the _Haste_ spell") and SRD Potion
 * of Heroism ("you are under the effect of the _Bless_ spell").
 *
 * Each test says whether it failed before the rule was read (**red**) or
 * already held and must keep holding (**guard**).
 */

const id = (s: string) => asCharacterId(s);
const CLERIC = id('cleric');
const PRIEST = id('priest');
const WIZARD = id('wizard');
const MAGE = id('mage');
const FIGHTER = id('fighter');
const GOBLIN = id('goblin');

const sheet = (): CharacterSheet => ({
  level: 9,
  abilities: { str: 16, dex: 14, con: 12, int: 18, wis: 18, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'int',
  weaponProficiencies: ['simple', 'martial'],
});

const added = (who: CharacterId, side: string): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(),
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

const EVERYONE = [CLERIC, PRIEST, WIZARD, MAGE, FIGHTER, GOBLIN];

/** Two Clerics, two Wizards, a Fighter with a sword and a goblin to swing at. */
const TABLE: readonly GameEvent[] = [
  ...[CLERIC, PRIEST, WIZARD, MAGE, FIGHTER].map((who) => added(who, 'party')),
  added(GOBLIN, 'foes'),
  ...[CLERIC, PRIEST].map(
    (who): GameEvent => ({
      type: 'spellcasting-declared',
      id: who,
      spellcasting: declaredCasting({
        ability: 'wis',
        classId: 'cleric',
        prepared: ['bless', 'bane', 'shield-of-faith'],
      }),
    }),
  ),
  ...[WIZARD, MAGE].map(
    (who): GameEvent => ({
      type: 'spellcasting-declared',
      id: who,
      spellcasting: declaredCasting({
        ability: 'int',
        classId: 'wizard',
        prepared: ['haste', 'slow', 'longstrider'],
      }),
    }),
  ),
  ...[CLERIC, PRIEST, WIZARD, MAGE].flatMap(slots),
  {
    type: 'items-gained',
    id: FIGHTER,
    items: [
      { id: 'longsword', quantity: 1 },
      { id: 'potion-of-speed', quantity: 1 },
      { id: 'potion-of-heroism', quantity: 1 },
      { id: 'ring-of-protection', quantity: 1 },
    ],
    source: 'the kit',
  },
  { type: 'item-equipped', id: FIGHTER, item: 'longsword', armor: null },
  { type: 'scene-set', extent: { width: 400, depth: 400, height: 40 } },
  { type: 'landmark-added', name: 'the yard', at: { x: 100, y: 100, z: 0 } },
  { type: 'landmark-added', name: 'the pit', at: { x: 100, y: 105, z: 0 } },
  { type: 'creature-placed', id: FIGHTER, placement: { from: { landmark: 'the yard' }, feet: 0 } },
  { type: 'creature-placed', id: GOBLIN, placement: { from: { landmark: 'the pit' }, feet: 0 } },
  // Both Wizards within a touch of the Fighter, for Longstrider.
  { type: 'creature-placed', id: WIZARD, placement: { from: { creature: FIGHTER }, feet: 5, bearing: 90 } },
  { type: 'creature-placed', id: MAGE, placement: { from: { creature: FIGHTER }, feet: 5, bearing: 270 } },
  { type: 'creature-placed', id: CLERIC, placement: { from: { creature: FIGHTER }, feet: 10, bearing: 180 } },
  { type: 'creature-placed', id: PRIEST, placement: { from: { creature: FIGHTER }, feet: 15, bearing: 180 } },
  ...EVERYONE.flatMap((from) =>
    EVERYONE.filter((to) => to !== from).map(
      (to): GameEvent => ({ type: 'sight-declared', from, to, seen: true }),
    ),
  ),
];

const FIGHT: GameEvent = {
  type: 'combat-started',
  combatants: [
    { id: CLERIC, initiative: 20, speed: 30 },
    { id: PRIEST, initiative: 19, speed: 30 },
    { id: WIZARD, initiative: 18, speed: 30 },
    { id: MAGE, initiative: 17, speed: 30 },
    { id: FIGHTER, initiative: 15, speed: 30 },
    { id: GOBLIN, initiative: 10, speed: 30 },
  ],
};

const supply = (state: GameState, flat?: number) => ({
  issuer: createRollIssuer('r', state.rollsIssued),
  rng: (state.rng === null ? createRng('combining') : restoreRng(state.rng)) as Rng,
  ...(flat === undefined ? {} : { bonuses: [{ source: 'the test insists', flat }] }),
  content: SRD_CONTENT,
});

/** A save nobody could make. */
const DOOMED = -40;

type Emitted = readonly GameEvent[] | { readonly events: readonly GameEvent[] };

class Game {
  readonly events: GameEvent[];

  constructor(fighting = true) {
    this.events = fighting ? [...TABLE, FIGHT] : [...TABLE];
  }

  get state(): GameState {
    return fold('combining', this.events);
  }

  run(command: (s: GameState) => Result<Emitted>, label: string): this {
    const out = unwrap(command(this.state), label);
    this.events.push(...(Array.isArray(out) ? out : (out as { events: readonly GameEvent[] }).events));
    return this;
  }

  cast(
    caster: CharacterId,
    spellId: string,
    targets: readonly CharacterId[],
    extra: Record<string, unknown> = {},
    flat?: number,
  ): this {
    this.until(caster);
    return this.run(
      (s) => resolveSpell(s, caster, { spellId, targets: [...targets], ...extra }, supply(s, flat)),
      `${caster} casts ${spellId}`,
    );
  }

  haste(caster: CharacterId): this {
    return this.cast(caster, 'haste', [FIGHTER], { willing: [FIGHTER] });
  }

  slow(caster: CharacterId): this {
    return this.cast(
      caster,
      'slow',
      [GOBLIN],
      { at: { x: 100, y: 145, z: 0 }, towards: { x: 100, y: 105, z: 0 } },
      DOOMED,
    );
  }

  drink(item: string): this {
    this.until(FIGHTER);
    return this.run((s) => useItem(s, FIGHTER, { item }, supply(s)), `drink ${item}`);
  }

  letGo(caster: CharacterId): this {
    return this.run((s) => endConcentration(s, caster, 'voluntary'), `${caster} lets go`);
  }

  turn(): this {
    return this.run((s) => resolveTurn(s, supply(s)), 'turn');
  }

  /** Advance the order to this creature's turn; a no-op outside a fight. */
  until(who: CharacterId): this {
    for (let guard = 0; guard < 14; guard += 1) {
      const combat = this.state.combat;
      if (combat === null || combat.order[combat.turnIndex]?.id === who) return this;
      this.turn();
    }
    throw new Error(`the order never reached ${who}`);
  }

  /** Round the table once and come back to the Fighter's turn start. */
  nextFighterTurn(): this {
    this.until(FIGHTER).turn();
    return this.until(FIGHTER);
  }

  /** The dice the Fighter's attack roll threw for bonuses, by label. */
  attackDice(): readonly string[] {
    this.until(FIGHTER);
    const state = this.state;
    const out = unwrap(
      resolveAttack(
        state,
        FIGHTER,
        { target: GOBLIN, weapon: 'longsword', commandId: `swing:${this.events.length}` },
        supply(state),
      ),
      'swing',
    );
    this.events.push(...out.events);
    return (out.attack?.bonuses ?? []).filter((b) => b.roll !== null).map((b) => b.source);
  }

  /** The dice a Dexterity save of the Fighter's threw for bonuses, by label. */
  saveDice(): readonly string[] {
    const state = this.state;
    const out = unwrap(
      resolveTest(
        state,
        FIGHTER,
        { kind: 'saving-throw', ability: 'dex', dc: 10, commandId: `save:${this.events.length}` },
        supply(state),
      ),
      'save',
    );
    this.events.push(...out.events);
    return (out.test?.bonuses ?? []).filter((b) => b.roll !== null).map((b) => b.source);
  }

  saveMode(): string | undefined {
    const state = this.state;
    const out = unwrap(
      resolveTest(
        state,
        FIGHTER,
        { kind: 'saving-throw', ability: 'dex', dc: 10, commandId: `mode:${this.events.length}` },
        supply(state),
      ),
      'save',
    );
    this.events.push(...out.events);
    return out.test?.mode;
  }

  ac(who: CharacterId = FIGHTER): number {
    return armorClassOf(this.state, who);
  }

  extraActions(): readonly unknown[] {
    return this.state.combat?.budgets[FIGHTER]?.extraActions ?? [];
  }

  castingIdOf(spell: string, caster: CharacterId): string {
    const found = Object.values(this.state.ongoing).find(
      (o) => o.spell === spell && o.caster === caster,
    );
    if (found === undefined) throw new Error(`${caster} is running no ${spell}`);
    return found.castingId;
  }
}

const BASE_AC = armorClassOf(fold('combining', [...TABLE]), FIGHTER);
const BASE_GOBLIN_AC = armorClassOf(fold('combining', [...TABLE]), GOBLIN);

const HASTED_ACTION = {
  only: ['attack', 'dash', 'disengage', 'hide', 'utilize'],
  attacksCap: 1,
};

describe('two Clerics’ Bless on one Fighter (SRD’s own example)', () => {
  const blessedTwice = (): Game =>
    new Game().cast(CLERIC, 'bless', [FIGHTER]).cast(PRIEST, 'bless', [FIGHTER]);

  it('red: an attack roll carries one 1d4, in the gatherer and on the roll', () => {
    const game = blessedTwice();
    // Both records stand; the book suppresses one while both run.
    expect(game.state.creatures[FIGHTER]!.bonuses.filter((b) => b.bonus.source === 'Bless')).toHaveLength(2);
    expect(bonusesFor(game.state.creatures[FIGHTER]!.bonuses, 'attack')).toEqual([
      { source: 'Bless', dice: '1d4' },
    ]);
    expect(game.attackDice()).toEqual(['Bless']);
  });

  it('guard: a save carries one 1d4', () => {
    expect(blessedTwice().saveDice()).toEqual(['Bless']);
  });

  it('red: the one that applies is the more recent casting', () => {
    const game = blessedTwice();
    const second = game.castingIdOf('Bless', PRIEST);
    expect(
      bonusesInForce(game.state.creatures[FIGHTER]!.bonuses, 'attack').map((b) => b.source),
    ).toEqual([`Bless#${second}`]);
  });

  it('red: ending the second casting leaves the first giving its 1d4', () => {
    const game = blessedTwice().letGo(PRIEST);
    const first = game.castingIdOf('Bless', CLERIC);
    expect(
      bonusesInForce(game.state.creatures[FIGHTER]!.bonuses, 'attack').map((b) => b.source),
    ).toEqual([`Bless#${first}`]);
    expect(game.attackDice()).toEqual(['Bless']);
  });

  it('guard: ending both leaves none', () => {
    const game = blessedTwice().letGo(PRIEST).letGo(CLERIC);
    expect(bonusesFor(game.state.creatures[FIGHTER]!.bonuses, 'attack')).toEqual([]);
    expect(game.attackDice()).toEqual([]);
  });
});

describe('Haste and a Potion of Speed on one Fighter, in either order', () => {
  /** Haste on the Wizard's turn, then the potion on the Fighter's, same round. */
  const drunkSecond = (): Game => new Game().haste(WIZARD).drink('potion-of-speed');
  /** The potion first, and Haste a round later. */
  const castSecond = (): Game => new Game().drink('potion-of-speed').turn().haste(WIZARD);

  it('red: Armour Class is two higher, not four', () => {
    expect(drunkSecond().ac()).toBe(BASE_AC + 2);
    expect(castSecond().ac()).toBe(BASE_AC + 2);
  });

  it('red: one extra action at the next turn start, the later one’s, drunk second', () => {
    const game = drunkSecond().nextFighterTurn();
    expect(game.extraActions()).toEqual([{ source: 'Potion of Speed', ...HASTED_ACTION }]);
  });

  it('red: one extra action at the next turn start, the later one’s, cast second', () => {
    const game = castSecond().until(FIGHTER);
    expect(game.extraActions()).toEqual([{ source: 'Haste', ...HASTED_ACTION }]);
  });

  it('guard: the Speed is doubled once', () => {
    expect(speedOf(drunkSecond().state, FIGHTER)).toBe(60);
    expect(speedOf(castSecond().state, FIGHTER)).toBe(60);
  });

  it('guard: Advantage on Dexterity saving throws', () => {
    expect(drunkSecond().saveMode()).toBe('advantage');
  });

  it('guard: after the potion’s minute, with Haste still running, +2 and one action', () => {
    // Drunk in the first round, Haste cast in the fifth, so the potion's
    // minute runs out with four rounds of the spell still to go.
    const game = new Game().drink('potion-of-speed');
    for (let round = 0; round < 4; round += 1) game.nextFighterTurn();
    game.haste(WIZARD);
    const potionOn = (): boolean =>
      game.state.creatures[FIGHTER]!.bonuses.some((b) => b.source === 'item:potion-of-speed');
    for (let guard = 0; guard < 80 && potionOn(); guard += 1) game.turn();
    expect(potionOn()).toBe(false);
    game.nextFighterTurn();
    expect(game.castingIdOf('Haste', WIZARD)).toBeDefined();
    expect(game.ac()).toBe(BASE_AC + 2);
    expect(game.extraActions()).toEqual([{ source: 'Haste', ...HASTED_ACTION }]);
  });
});

describe('two Hastes from two casters on one Fighter', () => {
  const twice = (): Game => new Game().haste(WIZARD).haste(MAGE);

  it('red: +2 to Armour Class', () => {
    expect(twice().ac()).toBe(BASE_AC + 2);
  });

  it('red: one extra action', () => {
    expect(twice().until(FIGHTER).extraActions()).toEqual([{ source: 'Haste', ...HASTED_ACTION }]);
  });
});

describe('Bless and Bane on one creature: different spells add together', () => {
  it('guard: an attack roll carries +1d4 and −1d4', () => {
    const game = new Game()
      .cast(CLERIC, 'bless', [FIGHTER])
      .cast(PRIEST, 'bane', [FIGHTER], {}, DOOMED);
    const gathered = bonusesFor(game.state.creatures[FIGHTER]!.bonuses, 'attack');
    expect(gathered).toEqual([
      { source: 'Bane', dice: '1d4', direction: 'subtract' },
      { source: 'Bless', dice: '1d4' },
    ]);
  });
});

describe('Shield of Faith, beside a Ring of Protection and beside itself', () => {
  const ringed = (): Game => {
    const game = new Game(false);
    game
      .run((s) => equipItem(s, SRD_CONTENT, FIGHTER, 'ring-of-protection'), 'wear')
      .run((s) => beginRest(s, FIGHTER, 'short'), 'rest')
      .run((s) => attuneItem(s, SRD_CONTENT, FIGHTER, 'ring-of-protection'), 'attune')
      .run((s) => advanceTime(s, 3600, 'the rest'), 'an hour');
    return game.run((s) => {
      const rested = endRest(s, FIGHTER);
      return rested.ok ? { ok: true as const, value: rested.value.events } : rested;
    }, 'rested');
  };

  it('guard: the ring’s +1 and the spell’s +2 are different things, and add', () => {
    const game = ringed();
    expect(game.ac()).toBe(BASE_AC + 1);
    game.cast(CLERIC, 'shield-of-faith', [FIGHTER]);
    expect(game.ac()).toBe(BASE_AC + 3);
  });

  it('red: two Clerics’ Shields of Faith give +2, not +4', () => {
    const game = new Game()
      .cast(CLERIC, 'shield-of-faith', [FIGHTER])
      .cast(PRIEST, 'shield-of-faith', [FIGHTER]);
    expect(game.ac()).toBe(BASE_AC + 2);
  });
});

describe('Bless beside a Potion of Heroism, which is "the effect of the Bless spell"', () => {
  it('red: a save carries one 1d4, though the two are labelled differently', () => {
    const game = new Game().cast(CLERIC, 'bless', [FIGHTER]).drink('potion-of-heroism');
    expect(game.saveDice()).toHaveLength(1);
    // The potion was drunk second, so it is the one that applies.
    expect(game.saveDice()).toEqual(['Potion of Heroism']);
  });
});

describe('two Slows from two casters on one goblin', () => {
  it('red: −2 to Armour Class, not −4', () => {
    const game = new Game().slow(WIZARD).slow(MAGE);
    expect(game.state.creatures[GOBLIN]!.bonuses.filter((b) => b.applies.includes('ac'))).toHaveLength(2);
    expect(game.ac(GOBLIN)).toBe(BASE_GOBLIN_AC - 2);
  });
});

describe('two Longstriders from two casters on one Fighter', () => {
  it('red: the walking Speed is ten feet higher, not twenty', () => {
    const game = new Game(false).cast(WIZARD, 'longstrider', [FIGHTER]).cast(MAGE, 'longstrider', [FIGHTER]);
    expect(game.state.creatures[FIGHTER]!.speedModifiers).toHaveLength(2);
    expect(speedOf(game.state, FIGHTER)).toBe(40);
  });
});

describe('potency before recency, in a log written by hand', () => {
  const LOG: readonly GameEvent[] = [
    added(FIGHTER, 'party'),
    {
      type: 'bonus-applied',
      id: FIGHTER,
      bonus: { source: 'X#cast:1', bonus: { source: 'X', flat: 3 }, applies: ['ac'], direction: 'add', effectOf: 'x' },
    },
    {
      type: 'bonus-applied',
      id: FIGHTER,
      bonus: { source: 'X#cast:2', bonus: { source: 'X', flat: 1 }, applies: ['ac'], direction: 'add', effectOf: 'x' },
    },
  ];
  const bare = armorClassOf(fold('hand', [added(FIGHTER, 'party')]), FIGHTER);

  it('red: the older, stronger +3 applies over the newer +1', () => {
    expect(armorClassOf(fold('hand', LOG), FIGHTER)).toBe(bare + 3);
  });

  it('guard: and once the +3 is taken off, the +1 applies', () => {
    const removed: GameEvent = { type: 'bonus-removed', id: FIGHTER, source: 'X#cast:1' };
    expect(armorClassOf(fold('hand', [...LOG, removed]), FIGHTER)).toBe(bare + 1);
  });

  it('stamps the order the fold saw them in, on these and on nothing else', () => {
    const held = fold('hand', LOG).creatures[FIGHTER]!.bonuses;
    expect(held.map((b) => b.appliedAt)).toEqual([2, 3]);
  });
});

describe('an old log reads as it was written', () => {
  const blessed = (n: number): GameEvent => ({
    type: 'bonus-applied',
    id: FIGHTER,
    bonus: { source: `Bless#cast:${n}`, bonus: { source: 'Bless', dice: '1d4' }, applies: ['attack', 'save'], direction: 'add' },
  });
  const state = fold('old', [added(FIGHTER, 'party'), blessed(1), blessed(2)]);

  it('guard: two Blesses written with no identity both reach the attack', () => {
    expect(bonusesFor(state.creatures[FIGHTER]!.bonuses, 'attack')).toHaveLength(2);
  });

  it('guard: and the fold stamps no order on them', () => {
    expect(JSON.stringify(state)).not.toContain('appliedAt');
  });

  it('guard: the second frozen log folds with neither field anywhere in it', () => {
    const here = fileURLToPath(new URL('.', import.meta.url));
    const golden = JSON.parse(
      readFileSync(`${here}../fixtures/golden-log-2.json`, 'utf8'),
    ) as GameEvent[];
    const folded = JSON.stringify(fold('golden-2', golden, SRD_CONTENT));
    expect(folded).not.toContain('effectOf');
    expect(folded).not.toContain('appliedAt');
  });
});

describe('a conferral that names the spell it is the effect of', () => {
  const potion = (effectOf: string): CatalogueItem =>
    ({
      id: 'homebrew-draught',
      name: 'Homebrew Draught',
      kind: 'potion',
      weightLb: 0.5,
      costCp: null,
      armor: null,
      weapon: null,
      contents: [],
      grants: [
        {
          kind: 'confers',
          action: 'bonus-action',
          durationSeconds: 60,
          effectOf,
          effects: [{ kind: 'buff', bonus: { source: 'Draught', flat: 1 }, applies: ['ac'], direction: 'add' }],
        },
      ],
    }) as unknown as CatalogueItem;

  // A catalogue holding no spells at all judges no spell an item names — the
  // rule `checkContent` keeps for a fixture of items alone — so each carries one.
  it('red: is refused when that spell is not in its content', () => {
    const codes = checkContent({ spells: [SRD_CONTENT.spell('haste')!], items: [potion('no-such-spell')] }).map(
      (p) => p.code,
    );
    expect(codes).toContain('conferral_effect_of_unknown_spell');
  });

  it('is accepted when it is', () => {
    const codes = checkContent({ spells: [SRD_CONTENT.spell('haste')!], items: [potion('haste')] }).map(
      (p) => p.code,
    );
    expect(codes).not.toContain('conferral_effect_of_unknown_spell');
  });

  it('red: the SRD catalogue still builds, and its two potions name their spells', () => {
    expect(itemConferral(SRD_CONTENT.item('potion-of-speed')!)?.effectOf).toBe('haste');
    expect(itemConferral(SRD_CONTENT.item('potion-of-heroism')!)?.effectOf).toBe('bless');
  });
});
