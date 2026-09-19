import { SRD_CONTENT } from '@ie/content';
import { describe, expect, it } from 'vitest';
import {
  asCharacterId,
  isErr,
  expect as unwrap,
  type CharacterId,
  type Result,
} from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { declaredCasting, type SpellcastingState } from './spellcasting.js';
import {
  awardItems,
  castSpell,
  chargesLeft,
  equipItem,
  releaseReady,
  resolveSpell,
  takeReady,
} from './commands.js';

/**
 * SRD "Armor Training": "If you wear armor that you lack training with, you
 * have Disadvantage on any D20 Test that involves Strength or Dexterity, and
 * **you can't cast spells**."
 *
 * The refusal is one line in `castSpellWith`, which is the only place a
 * casting is paid for — so every door that pays already reaches it. **Nothing
 * here fixes anything.** STATUS records that a character in untrained armour
 * can still cast and that this is the half of the Armor Training clause the
 * engine has never modelled; neither is true, and this file is what
 * establishes it, because a rule believed to be missing is as good as missing
 * until something fails when it goes. Delete the line in `castSpellWith` and
 * the four refusals below all fail. (STATUS itself is the coordinator's to
 * correct, and until it is, this comment is where the correction lives.)
 *
 * **The armour is worn rather than written on the sheet.** `sheet.armor` is
 * derived from what is equipped, so a fixture that states armour and then
 * equips anything at all has quietly taken it off again. That is how the wand
 * came to look like the gap: the obvious fixture put chain mail on the sheet
 * and a wand in the hand, and the wand's own equip event undressed the caster.
 */

const id = (s: string) => asCharacterId(s);
const CASTER = id('kessa');
const VICTIM = id('victim');

const WAND = 'wand-of-fireballs';
const MAIL = 'chain-mail';
const THERE = { x: 240, y: 200, z: 0 };

/** Trained in nothing: the sheet half of the SRD sentence. */
const UNTRAINED = { light: false, medium: false, heavy: false, shields: false } as const;

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 11,
  abilities: { str: 14, dex: 14, con: 14, int: 20, wis: 12, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'int',
  weaponProficiencies: ['simple'],
  ...over,
});

const added = (who: CharacterId, over: Partial<CharacterSheet> = {}): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(over),
  maxHp: 200,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side: who === CASTER ? 'party' : 'foes',
});

const WIZARDLY: SpellcastingState = declaredCasting({
  ability: 'int',
  classId: 'wizard',
  cantrips: ['fire-bolt'],
  prepared: ['fireball', 'guiding-bolt'],
});

const SLOTS: readonly GameEvent[] = [1, 3].map((level) => ({
  type: 'resource-pool-declared',
  id: CASTER,
  pool: {
    key: `spell-slot:${level}`,
    label: `level ${level} spell slot`,
    max: 2,
    recovers: 'long-rest',
  },
}));

const IN_COMBAT: GameEvent = {
  type: 'combat-started',
  combatants: [
    { id: CASTER, initiative: 20, speed: 30 },
    { id: VICTIM, initiative: 10, speed: 30 },
  ],
};

const prelude = (): readonly GameEvent[] => [
  added(CASTER, { armorTraining: { ...UNTRAINED } }),
  added(VICTIM),
  { type: 'spellcasting-declared', id: CASTER, spellcasting: WIZARDLY },
  ...SLOTS,
  { type: 'scene-set', extent: { width: 900, depth: 900, height: 60 } },
  { type: 'landmark-added', name: 'here', at: { x: 200, y: 200, z: 0 } },
  { type: 'landmark-added', name: 'there', at: THERE },
  { type: 'creature-placed', id: CASTER, placement: { from: { landmark: 'here' }, feet: 0 } },
  { type: 'creature-placed', id: VICTIM, placement: { from: { landmark: 'there' }, feet: 0 } },
  { type: 'sight-declared', from: CASTER, to: VICTIM, seen: true },
  { type: 'sight-declared', from: VICTIM, to: CASTER, seen: true },
];

/**
 * The hoard, handed over through the command a DM hands one over through: a
 * charged copy is labelled and given its pool where it is gained, and a
 * hand-written gain would leave the wand with nothing to spend.
 */
const table = (items: readonly string[]): readonly GameEvent[] => {
  const base = prelude();
  return items.length === 0
    ? base
    : [
        ...base,
        ...unwrap(
          awardItems(
            fold('seed', base),
            supply('the-hoard'),
            CASTER,
            items.map((item) => ({ id: item })),
            'the hoard',
          ),
          'the hoard',
        ),
      ];
};

const state = (log: readonly GameEvent[]): GameState => fold('seed', log);

const supply = (seed = 'armour') => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

const run = (
  log: readonly GameEvent[],
  command: (s: GameState) => Result<readonly GameEvent[]>,
): readonly GameEvent[] => [...log, ...unwrap(command(state(log)), 'command')];

const wearing = (log: readonly GameEvent[]): readonly GameEvent[] =>
  run(log, (s) => equipItem(s, SRD_CONTENT, CASTER, MAIL));

/** The wand, in hand and attuned, with its charges declared by the equip. */
const wielding = (log: readonly GameEvent[]): readonly GameEvent[] => [
  ...run(log, (s) => equipItem(s, SRD_CONTENT, CASTER, WAND)),
  { type: 'attuned', id: CASTER, item: WAND },
];

const refusal = (result: Result<unknown>): string | null => (isErr(result) ? result.code : null);

describe('a caster in armour they lack training with', () => {
  /** The door that has always held it, so the fixture is known good. */
  it('is refused by castSpell', () => {
    expect(
      refusal(
        castSpell(state(wearing(table([MAIL]))), CASTER, {
          spell: 'Guiding Bolt',
          level: 1,
          slotLevel: 1,
        }),
      ),
    ).toBe('untrained_armor');
  });

  it('is refused by resolveSpell, which is the door play uses', () => {
    expect(
      refusal(
        resolveSpell(
          state(wearing(table([MAIL]))),
          CASTER,
          { spellId: 'fireball', targets: [], at: THERE, slotLevel: 3 },
          supply(),
        ),
      ),
    ).toBe('untrained_armor');
  });

  /**
   * **And the wand.** SRD gives an item's casting no exemption: it is a
   * casting, and the sentence is about the caster's armour rather than about
   * where the magic came from.
   *
   * The charge is why this is its own case. It is spent inside the casting's
   * own batch — which is the shape that stops a wand discharging into a
   * refusal — so the only thing that can protect it is the refusal arriving
   * first.
   */
  it('is refused before the wand pays a charge', () => {
    const wand = { spellId: 'fireball', targets: [], at: THERE, item: WAND, charges: 1 };

    const encumbered = wielding(wearing(table([MAIL, WAND])));
    const result = resolveSpell(state(encumbered), CASTER, wand, supply());
    expect(refusal(result)).toBe('untrained_armor');

    // **And the control, which is what makes the refusal mean anything.** The
    // same wand in the same hand with the mail left in the pack casts, and the
    // charge goes — so the refusal above arrived *instead of* the payment
    // rather than beside a wand that could not have cast anyway.
    const unencumbered = wielding(table([WAND]));
    const cast = unwrap(resolveSpell(state(unencumbered), CASTER, wand, supply()), 'the wand');
    expect(chargesLeft(state(unencumbered), SRD_CONTENT, CASTER, WAND)).toBe(7);
    expect(chargesLeft(state([...unencumbered, ...cast.events]), SRD_CONTENT, CASTER, WAND)).toBe(6);
  });

  /**
   * **A readied spell is cast at the Ready.** SRD: "you cast it as normal
   * (expending any resources used to cast it) but hold its energy" — so the
   * slot goes there and the refusal belongs there.
   */
  it('is refused at the Ready, before the slot goes', () => {
    const log = [...wearing(table([MAIL])), IN_COMBAT];
    expect(
      refusal(
        takeReady(
          state(log),
          CASTER,
          {
            trigger: 'the door opens',
            response: { kind: 'spell', spellId: 'guiding-bolt', slotLevel: 1 },
          },
          SRD_CONTENT,
        ),
      ),
    ).toBe('untrained_armor');
  });
});

describe('the release of a readied spell is not a second casting', () => {
  /**
   * **The one door that does not ask, and the SRD sentence that says it should
   * not.** Ready: "you cast it as normal (expending any resources used to cast
   * it) but hold its energy, releasing it with your Reaction when the trigger
   * occurs." The casting is at the Ready — which is why the slot goes there,
   * why the Concentration starts there, and why the refusal above lands there.
   * The release spends nothing and casts nothing, so "you can't cast spells"
   * has already had its say.
   *
   * `castOrRelease` therefore skips `castSpellWith` entirely when it is handed
   * a held casting, and this is the assertion that says the gap is deliberate
   * rather than unnoticed: the spell goes off, in mail its caster was never
   * trained in, because it was cast before the mail went on.
   *
   * The fixture is contrived and worth naming as such — SRD gives Chain Mail a
   * Don time of 10 minutes and a readied spell lasts until the start of your
   * next turn, so no table reaches this. It is here because the *code path* is
   * reachable and silence about it is what this file exists to remove.
   */
  it('lets a spell readied before the armour went on still go off', () => {
    const readied = run([...table([MAIL]), IN_COMBAT], (s) =>
      takeReady(
        s,
        CASTER,
        {
          trigger: 'the door opens',
          response: { kind: 'spell', spellId: 'guiding-bolt', slotLevel: 1 },
        },
        SRD_CONTENT,
      ),
    );

    const released = releaseReady(
      state(wearing(readied)),
      CASTER,
      { targets: [VICTIM] },
      supply(),
    );
    expect(refusal(released)).toBeNull();
    expect(unwrap(released, 'the release').took).toBe(true);
  });
});
