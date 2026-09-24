/**
 * SRD Wild Shape, executed: a creature wearing another creature's statistics.
 *
 * > "As a Bonus Action, you shape-shift into a Beast form that you have
 * > learned for this feature. You stay in that form for a number of hours
 * > equal to half your Druid level or until you use Wild Shape again, have the
 * > Incapacitated condition, or die. You can also leave the form early as a
 * > Bonus Action."
 *
 * What is proved here, in the order the sentence prints it: the forms a
 * character knows are validated when the character is made and the numbers
 * the Beast Shapes table prints are resolved at the class level; a use spends
 * the Bonus Action and one use of the pool, lays the block's sheet over the
 * character's with the retained half kept line by line, grants the Temporary
 * Hit Points, and files a deadline in hours; the four endings — the deadline,
 * a second use, Incapacitated and a Bonus Action — each put the original sheet
 * back without a second event saying so; nothing is cast from inside a form;
 * merged gear grants nothing while the form lasts; and a log with a shape in
 * it folds byte-identically and survives JSON.
 *
 * The owner's four rulings of 2026-09-20 are the ones this file builds to:
 * gear merges, the Armour Class is always the block's, an oversized form is
 * the forced-movement rule (so the scene's copy of the size follows the form),
 * and known forms are chosen the way a Cleric prepares spells.
 */

import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, type CharacterId, type Result } from '@ie/shared';
import type { CharacterChoices } from './creation.js';
import { checkCharacter, createCharacter } from './creation.js';
import { applyEvent, fold, type GameEvent, type GameState } from './events.js';
import { armorClassOf, sheetAsItStands, speedOf } from './standing.js';
import { initiativeModifier, saveModifier, skillModifier } from './character.js';
import { remaining } from './resources.js';
import {
  advanceTime,
  applyConditionTo,
  assumeShape,
  attuneItem,
  castSpell,
  equipItem,
  revertShape,
} from './commands.js';
import { beginRest, endRest } from './rest.js';

const DRUID: CharacterId = asCharacterId('fenn');

/** `trades.test.ts`'s level 5 Druid, with four forms learned. */
const druid = (over: Partial<CharacterChoices> = {}): CharacterChoices => ({
  name: 'Fenn',
  classId: 'druid',
  level: 5,
  subclassId: 'circle-of-the-land',
  speciesId: 'human',
  backgroundId: 'acolyte',
  abilities: {
    method: 'standard-array',
    assignment: { str: 10, dex: 14, con: 13, int: 8, wis: 15, cha: 12 },
  },
  abilityIncreases: { wis: 2, cha: 1 },
  classSkills: ['nature', 'perception'],
  languages: ['Elvish', 'Dwarvish'],
  alignment: 'Neutral',
  cantrips: ['druidcraft', 'guidance', 'shillelagh'],
  spellbook: [],
  preparedSpells: [
    'aid',
    'barkskin',
    'call-lightning',
    'cure-wounds',
    'dispel-magic',
    'faerie-fire',
    'fog-cloud',
    'goodberry',
    'healing-word',
  ],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: ['leather-armor'],
  hitPoints: { method: 'fixed' },
  featureChoices: {
    'human:skillful': ['acrobatics'],
    'druid:primal-order': ['Magician'],
    'druid:primal-order:cantrip': ['mending'],
  },
  feats: {
    'acolyte:magic-initiate-cleric': {
      featId: 'magic-initiate',
      spellList: 'cleric',
      spellcastingAbility: 'wis',
      cantrips: ['guidance', 'sacred-flame'],
      levelOneSpell: 'bless',
    },
    'human:versatile': { featId: 'alert' },
    'druid:ability-score-improvement': {
      featId: 'ability-score-improvement',
      abilities: ['wis', 'wis'],
    },
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard package only' },
  // SRD: "The Rat, Riding Horse, Spider, and Wolf are recommended."
  knownForms: ['wolf', 'rat', 'spider', 'riding-horse'],
  ...over,
});

/** The same Druid before anybody has said which forms it knows. */
const unlearned = (): CharacterChoices => {
  const { knownForms, ...rest } = druid();
  void knownForms;
  return rest;
};

/** The value, or the refusal as a thrown error with its code in the message. */
const unwrap = <T>(result: Result<T>): T => {
  if (!result.ok) throw new Error(`${result.code} — ${result.reason}`);
  return result.value;
};

const made = (choices: CharacterChoices = druid()): readonly GameEvent[] => {
  const built = createCharacter(SRD_CONTENT, choices, DRUID);
  if (!built.ok) throw new Error(`${built.code} — ${built.reason}`);
  return built.value;
};

const stepped = (events: readonly GameEvent[]): GameState =>
  events.reduce((state, event) => applyEvent(state, event), fold('shape', []));

const fresh = (choices?: CharacterChoices): GameState => fold('shape', [...made(choices)]);

const after = (state: GameState, result: ReturnType<typeof assumeShape>): GameState =>
  unwrap(result).reduce((s, event) => applyEvent(s, event), state);

const shape = (state: GameState, form = 'wolf', commandId?: string) =>
  assumeShape(
    state,
    DRUID,
    { feature: 'druid:wild-shape', form, ...(commandId === undefined ? {} : { commandId }) },
    SRD_CONTENT,
  );

const creature = (state: GameState) => state.creatures[DRUID]!;

const FIGHTING: GameEvent = {
  type: 'combat-started',
  combatants: [{ id: DRUID, initiative: 20, speed: 30 }],
};

const refused = (result: { ok: boolean; code?: string }): string => {
  expect(result.ok, JSON.stringify(result)).toBe(false);
  return (result as { code: string }).code;
};

describe('the forms a character knows', () => {
  it('compiles the Beast Shapes row for the class level onto the sheet', () => {
    const sheet = creature(fresh()).sheet;
    // Level 5 reads the level 4 row: six forms, CR 1/2, no Fly Speed; and
    // "half your Druid level" in hours, rounded down as every fraction is.
    expect(sheet.shapeShifts).toEqual([
      {
        feature: 'druid:wild-shape',
        name: 'Wild Shape',
        action: 'bonus-action',
        pool: 'wild-shape',
        formType: 'Beast',
        known: 6,
        maxChallengeRating: 0.5,
        flying: false,
        hours: 2,
        temporaryHitPoints: 5,
        keeps: ['int', 'wis', 'cha'],
        forbidsCasting: true,
        knownForms: ['rat', 'riding-horse', 'spider', 'wolf'],
      },
    ]);
  });

  it('refuses a form the book does not print, one above the CR ceiling, a flier, a repeat, and too many', () => {
    const problems = (choices: CharacterChoices): readonly string[] =>
      checkCharacter(SRD_CONTENT, choices).map((p) => `${p.code}:${p.field}`);
    expect(problems(druid({ knownForms: ['wolf', 'direwolf-of-nowhere'] }))).toEqual([
      'unknown_form:knownForms[1]',
    ]);
    // A Brown Bear is CR 1 and a Druid 5 may take CR 1/2.
    expect(problems(druid({ knownForms: ['brown-bear'] }))).toEqual([
      'form_not_eligible:knownForms[0]',
    ]);
    // A Giant Bat is CR 1/4 and flies; Fly Speeds arrive at level 8.
    expect(problems(druid({ knownForms: ['giant-bat'] }))).toEqual([
      'form_not_eligible:knownForms[0]',
    ]);
    // A Giant Eagle is a Celestial in this book, whatever it looks like.
    expect(problems(druid({ knownForms: ['giant-eagle'] }))).toEqual([
      'form_not_eligible:knownForms[0]',
    ]);
    expect(problems(druid({ knownForms: ['wolf', 'wolf'] }))).toEqual([
      'duplicate_form:knownForms[1]',
    ]);
    expect(
      problems(
        druid({ knownForms: ['wolf', 'rat', 'spider', 'riding-horse', 'boar', 'cat', 'deer'] }),
      ),
    ).toEqual(['too_many_forms:knownForms']);
  });

  it('refuses known forms on a character with nothing to shift into', () => {
    // A Druid 1 has no Wild Shape yet; a level 5 character of another class never will.
    const codes = (choices: CharacterChoices): readonly string[] =>
      checkCharacter(SRD_CONTENT, choices)
        .filter((p) => p.field.startsWith('knownForms'))
        .map((p) => p.code);
    expect(codes(druid({ level: 1, knownForms: ['wolf'] }))).toEqual(['forms_without_a_shape']);
  });

  it('is a choice a character need not have made yet', () => {
    const sheet = creature(fresh(unlearned())).sheet;
    expect(sheet.shapeShifts?.[0]?.knownForms).toEqual([]);
    expect(refused(shape(fresh(unlearned())))).toBe('form_not_known');
  });
});

describe('assuming a form', () => {
  it('spends a use, lays the block over the sheet, keeps the retained half, grants the Temporary Hit Points and files the hours', () => {
    const before = fresh();
    const own = creature(before).sheet;
    const events = unwrap(shape(before, 'wolf', 'w1'));

    expect(events.map((e) => e.type)).toEqual([
      'resource-spent',
      'feature-activated',
      'shape-assumed',
      'temporary-hp-granted',
      'effect-scheduled',
    ]);
    expect(events[0]).toEqual({ type: 'resource-spent', id: DRUID, key: 'wild-shape', amount: 1 });
    expect(events[3]).toEqual({ type: 'temporary-hp-granted', id: DRUID, amount: 5 });
    expect(events[4]).toMatchObject({
      type: 'effect-scheduled',
      target: { kind: 'feature', on: DRUID, feature: 'druid:wild-shape' },
      deadline: { kind: 'elapsed', at: before.elapsed + 2 * 3600 },
    });
    const assumed = events[2];
    expect(assumed).toMatchObject({
      type: 'shape-assumed',
      id: DRUID,
      feature: 'druid:wild-shape',
      form: 'wolf',
      size: 'medium',
    });
    // The command's own event carries its stamp.
    expect((assumed as { command?: { id: string } }).command?.id).toBe('w1');

    const state = events.reduce((s, e) => applyEvent(s, e), before);
    const it = creature(state);
    expect(it.activeFeatures).toEqual(['druid:wild-shape']);
    expect(it.shape).toEqual({
      feature: 'druid:wild-shape',
      form: 'wolf',
      original: { sheet: own, size: 'medium', sceneSize: null },
    });
    expect(remaining(it.resources, 'wild-shape')).toBe(1);
    expect(it.vitals.temporaryHp).toBe(5);
    // Hit Points are retained: the Wolf's 11 are nowhere on this creature.
    expect(it.vitals.hpMax).toBe(creature(before).vitals.hpMax);
    expect(it.vitals.hp).toBe(creature(before).vitals.hp);

    const sheet = sheetAsItStands(state, DRUID)!;
    // The block's physical scores and the Druid's mental ones.
    expect(sheet.abilities).toEqual({ str: 14, dex: 15, con: 12, int: 8, wis: 19, cha: 13 });
    // The Armour Class is always the block's; the leather armour has merged.
    expect(armorClassOf(state, DRUID)).toBe(12);
    expect(sheet.armor).toBeNull();
    expect(speedOf(state, DRUID)).toBe(40);
    expect(initiativeModifier(sheet)).toBe(2);
    expect(sheet.stated?.attacks?.map((a) => a.name)).toEqual(['Bite']);
    expect(sheet.level).toBe(5);
    // A Druid 5's Proficiency Bonus is +3 and the Wolf's is +2: "use your
    // Proficiency Bonus for them". Wisdom saves are proficient: +4 +3 = +7,
    // over the block's +1. Strength is the Wolf's +2 either way.
    expect(saveModifier(sheet, 'wis')).toBe(7);
    expect(saveModifier(sheet, 'str')).toBe(2);
    expect(saveModifier(sheet, 'int')).toBe(2);
    // "If a skill ... modifier in the Beast's stat block is higher than yours,
    // use the one in the stat block": Stealth +4 beats the Wolf's Dexterity
    // alone; Perception +4 +3 = +7 beats the block's +5; Nature is untouched.
    expect(skillModifier(sheet, 'stealth')).toBe(4);
    expect(skillModifier(sheet, 'perception')).toBe(7);
    expect(skillModifier(sheet, 'nature')).toBe(3 - 1);
    // Class features come along: the shape itself, and the trades on it.
    expect(sheet.shapeShifts?.[0]?.feature).toBe('druid:wild-shape');
    expect(sheet.trades?.length).toBeGreaterThan(0);
    // And the block's own printed rule comes with it: the Wolf's Pack Tactics.
    expect(
      sheet.stated?.traits?.some(
        (t) => t.kind === 'advantage-when-ally-is-within-5-feet-of-the-target',
      ),
    ).toBe(true);
  });

  it('follows the form into the scene: a Riding Horse is Large where a Human was Medium', () => {
    const placed = stepped([
      ...made(),
      { type: 'scene-set', extent: { width: 200, depth: 200, height: 40 } },
      { type: 'landmark-added', name: 'the gate', at: { x: 50, y: 50, z: 0 } },
      { type: 'creature-placed', id: DRUID, placement: { from: { landmark: 'the gate' }, feet: 0 } },
    ]);
    expect(placed.scene?.sizes[DRUID]).toBe('medium');
    const state = after(placed, shape(placed, 'riding-horse'));
    expect(creature(state).size).toBe('large');
    expect(state.scene?.sizes[DRUID]).toBe('large');
    expect(creature(state).shape?.original).toEqual({
      sheet: creature(placed).sheet,
      size: 'medium',
      sceneSize: 'medium',
    });

    const back = after(state, revertShape(state, DRUID, {}));
    expect(creature(back).size).toBe('medium');
    expect(back.scene?.sizes[DRUID]).toBe('medium');
  });

  it('refuses a form not learned, a form the book lacks, a feature the character lacks, and an empty pool', () => {
    const state = fresh();
    expect(refused(shape(state, 'boar'))).toBe('form_not_known');
    expect(refused(shape(state, 'a-beast-of-nowhere'))).toBe('unknown_monster');
    expect(
      refused(
        assumeShape(state, DRUID, { feature: 'druid:wild-companion', form: 'wolf' }, SRD_CONTENT),
      ),
    ).toBe('no_such_feature');

    const spent = fold('shape', [
      ...made(),
      { type: 'resource-spent', id: DRUID, key: 'wild-shape', amount: 2 },
    ]);
    expect(refused(shape(spent))).toBe('exhausted');
  });

  it('refuses a form the sheet lists but the book no longer allows', () => {
    // A sheet that learned a flier before it may fly: the use-time check is
    // what stands between a stale list and a Druid 5 in the air.
    const state = fresh();
    const it = creature(state);
    const doctored: GameState = {
      ...state,
      creatures: {
        ...state.creatures,
        [DRUID]: {
          ...it,
          sheet: {
            ...it.sheet,
            shapeShifts: it.sheet.shapeShifts!.map((s) => ({ ...s, knownForms: ['giant-bat'] })),
          },
        },
      },
    };
    expect(refused(shape(doctored, 'giant-bat'))).toBe('form_not_eligible');
  });

  it('cannot be entered while Incapacitated', () => {
    const state = fresh();
    const stunned = unwrap(applyConditionTo(state, DRUID, 'incapacitated', 'a test')).reduce(
      (s, e) => applyEvent(s, e),
      state,
    );
    expect(refused(shape(stunned))).toBe('incapacitated');
  });

  it('is idempotent under its command id', () => {
    const state = fresh();
    const first = after(state, shape(state, 'wolf', 'once'));
    const again = unwrap(shape(first, 'wolf', 'once'));
    expect(again).toEqual([]);
  });
});

describe('the four endings', () => {
  it('ends when the hours run out, and the sheet comes back with the armour still on', () => {
    const shaped = after(fresh(), shape(fresh()));
    const own = creature(fresh()).sheet;

    const almost = unwrap(advanceTime(shaped, 2 * 3600 - 1, 'nearly two hours')).reduce(
      (s, e) => applyEvent(s, e),
      shaped,
    );
    expect(creature(almost).shape?.form).toBe('wolf');

    const over = unwrap(advanceTime(almost, 1, 'the last second')).reduce(
      (s, e) => applyEvent(s, e),
      almost,
    );
    const it = creature(over);
    expect(it.shape).toBeNull();
    expect(it.activeFeatures).toEqual([]);
    expect(it.sheet).toEqual(own);
    expect(armorClassOf(over, DRUID)).toBe(armorClassOf(fresh(), DRUID));
    // Temporary Hit Points outlive the form: the SRD gives them no other end,
    // and the ruling of 2026-09-18 says an unstated lifetime is the Long Rest.
    expect(it.vitals.temporaryHp).toBe(5);
    // And the deadline is spent.
    expect(Object.values(over.timers).some((t) => t.target.kind === 'feature')).toBe(false);
  });

  it('ends on the Incapacitated condition without an event saying so', () => {
    const shaped = after(fresh(), shape(fresh()));
    const events = unwrap(applyConditionTo(shaped, DRUID, 'incapacitated', 'a test'));
    expect(events.map((e) => e.type)).not.toContain('feature-ended');
    const state = events.reduce((s, e) => applyEvent(s, e), shaped);
    expect(creature(state).shape).toBeNull();
    expect(creature(state).sheet).toEqual(creature(fresh()).sheet);
    expect(Object.values(state.timers).some((t) => t.target.kind === 'feature')).toBe(false);
  });

  it('ends on death', () => {
    const shaped = after(fresh(), shape(fresh()));
    const it = creature(shaped);
    const dead: GameState = {
      ...shaped,
      creatures: {
        ...shaped.creatures,
        [DRUID]: { ...it, vitals: { ...it.vitals, hp: 0, dead: true } },
      },
    };
    // Any event reaches the derived passes; a clock tick is the emptiest.
    const state = applyEvent(dead, { type: 'time-advanced', seconds: 1, reason: 'a breath' });
    expect(creature(state).shape).toBeNull();
    expect(creature(state).activeFeatures).toEqual([]);
  });

  it('ends on a second use, which replaces the form and spends a second use', () => {
    const wolf = after(fresh(), shape(fresh(), 'wolf'));
    const events = unwrap(shape(wolf, 'rat'));
    expect(events.map((e) => e.type)).toEqual([
      'resource-spent',
      'feature-ended',
      'feature-activated',
      'shape-assumed',
      'temporary-hp-granted',
      'effect-scheduled',
    ]);
    const rat = events.reduce((s, e) => applyEvent(s, e), wolf);
    const it = creature(rat);
    expect(it.shape?.form).toBe('rat');
    // The original is the Druid's own sheet, never the Wolf's.
    expect(it.shape?.original.sheet).toEqual(creature(fresh()).sheet);
    expect(it.size).toBe('tiny');
    expect(remaining(it.resources, 'wild-shape')).toBe(0);
    expect(armorClassOf(rat, DRUID)).toBe(10);
    // One timer, the new one.
    expect(Object.values(rat.timers).filter((t) => t.target.kind === 'feature')).toHaveLength(1);
  });

  it('ends on a Bonus Action, which costs nothing else and refunds nothing', () => {
    const shaped = after(fresh(), shape(fresh()));
    const events = unwrap(revertShape(shaped, DRUID, { commandId: 'back' }));
    expect(events).toEqual([
      {
        type: 'feature-ended',
        id: DRUID,
        feature: 'druid:wild-shape',
        reason: 'dismissed',
        command: { id: 'back', fingerprint: expect.any(String) },
      },
    ]);
    const state = events.reduce((s, e) => applyEvent(s, e), shaped);
    expect(creature(state).shape).toBeNull();
    expect(creature(state).sheet).toEqual(creature(fresh()).sheet);
    expect(remaining(creature(state).resources, 'wild-shape')).toBe(1);

    expect(refused(revertShape(state, DRUID, {}))).toBe('not_shaped');
  });
});

describe('in a fight', () => {
  const fighting = (): GameState => fold('shape', [...made(), FIGHTING]);

  it('spends the Bonus Action to enter, and the turn has only one', () => {
    const state = fighting();
    const events = unwrap(shape(state));
    expect(events[0]?.type).toBe('bonus-action-spent');
    const shaped = events.reduce((s, e) => applyEvent(s, e), state);
    // The Bonus Action is gone, so neither leaving nor a second form fits in this turn.
    expect(refused(revertShape(shaped, DRUID, {}))).toBe('no_bonus_action');
    expect(refused(shape(shaped, 'rat'))).toBe('no_bonus_action');
    // The deadline is in hours even inside a fight: a second is a second.
    const timer = Object.values(shaped.timers).find((t) => t.target.kind === 'feature');
    expect(timer?.deadline).toEqual({ kind: 'elapsed', at: state.elapsed + 7200 });
  });

  it('spends the Bonus Action to leave', () => {
    const state = fighting();
    const shaped = after(state, shape(state));
    const next = applyEvent(shaped, { type: 'turn-advanced' });
    const left = unwrap(revertShape(next, DRUID, {}));
    expect(left.map((e) => e.type)).toEqual(['bonus-action-spent', 'feature-ended']);
  });
});

describe('what a form forbids and what it merges', () => {
  it('casts nothing from inside a form', () => {
    const shaped = after(fresh(), shape(fresh()));
    const cast = castSpell(shaped, DRUID, { spell: 'Cure Wounds', level: 1, slotLevel: 1 });
    expect(refused(cast)).toBe('shape_shifted');
  });

  it("a worn item's grant is silent while the form lasts, and speaks again after", () => {
    const ringed = druid({
      dmGrants: {
        items: [{ id: 'ring-of-protection', quantity: 1 }],
        goldPieces: 0,
        magicItems: ['Ring of Protection'],
        note: 'a ring, to prove it falls silent',
      },
    });
    // SRD: attunement is "a Short Rest spent focused on it".
    let state = fresh(ringed);
    const steps: readonly ((s: GameState) => Result<readonly GameEvent[]>)[] = [
      (s: GameState) => beginRest(s, DRUID, 'short'),
      (s: GameState) => attuneItem(s, SRD_CONTENT, DRUID, 'ring-of-protection'),
      (s: GameState) => advanceTime(s, 3600, 'the rest'),
      (s: GameState) => {
        const rested = endRest(s, DRUID);
        return rested.ok ? { ok: true as const, value: rested.value.events } : rested;
      },
      (s: GameState) => equipItem(s, SRD_CONTENT, DRUID, 'ring-of-protection'),
    ];
    for (const step of steps) {
      state = unwrap(step(state)).reduce((s, e) => applyEvent(s, e), state);
    }
    // Leather 11 + Dex 2 + the ring's 1.
    expect(armorClassOf(state, DRUID)).toBe(14);

    const shaped = after(state, shape(state));
    expect(armorClassOf(shaped, DRUID)).toBe(12);
    expect(sheetAsItStands(shaped, DRUID)?.armor).toBeNull();

    const back = after(shaped, revertShape(shaped, DRUID, {}));
    expect(armorClassOf(back, DRUID)).toBe(14);
  });
});

describe('the log', () => {
  it('folds byte-identically, and survives JSON', () => {
    const log: GameEvent[] = [...made()];
    const s1 = fold('shape', log);
    log.push(...unwrap(shape(s1, 'riding-horse', 'a')));
    const s2 = fold('shape', log);
    log.push(...unwrap(advanceTime(s2, 3600, 'an hour')));
    const s3 = fold('shape', log);
    log.push(...unwrap(shape(s3, 'wolf', 'b')));
    const s4 = fold('shape', log);
    log.push(...unwrap(revertShape(s4, DRUID, { commandId: 'c' })));

    const folded = fold('shape', log);
    expect(folded).toStrictEqual(stepped(log));
    const throughJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
    expect(fold('shape', throughJson(log))).toStrictEqual(folded);
    expect(throughJson(folded)).toStrictEqual(folded);
    expect(creature(folded).shape).toBeNull();
    expect(creature(folded).sheet).toEqual(creature(fold('shape', made())).sheet);
  });
});
