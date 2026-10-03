/**
 * A check that uses a tool, and the sheet that says who is proficient with one
 * (E-AIM).
 *
 * > SRD 5.2.1, Equipment, "Tool Proficiency": "If you have proficiency with a
 * > tool, add your Proficiency Bonus to any ability check you make that uses
 * > the tool. If you have proficiency in a skill that's used with that check,
 * > you have Advantage on the check too."
 *
 * > Playing the Game, "The Bonus Doesn't Stack": "Your Proficiency Bonus can't
 * > be added to a die roll or another number more than once."
 *
 * The tools door drives the Rogue's lock; this file holds what no tool reaches
 * on its own: where the proficiency comes from at creation, Jack of All Trades
 * standing aside for a check that already uses the bonus, and the save that
 * takes no tool.
 */

import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, type Result } from '@ie/shared';
import { abilityModifier, proficiencyBonus } from './character.js';
import { createCharacter, planCharacter, type CharacterChoices } from './creation.js';
import { createRng, type Rng } from './dice.js';
import { fold, type GameEvent } from './events.js';
import { createRollIssuer } from './rolls.js';
import { resolveTest } from './commands.js';
import { parseClassDefinition } from './content.js';

const HERO = asCharacterId('hero');

const supply = (seed: string) => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

const unwrap = <T>(result: Result<T>, label = 'ok'): T => {
  if (!result.ok) throw new Error(`${label}: ${result.code} — ${result.reason}`);
  return result.value;
};

const common = {
  backgroundId: 'sage',
  languages: ['Dwarvish', 'Orc'],
  alignment: 'Neutral',
  spellbook: [],
  backgroundEquipment: 'A' as const,
  classEquipment: 'A' as const,
  equipped: [],
  hitPoints: { method: 'fixed' as const },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
  cantrips: [],
  preparedSpells: [],
  feats: {
    'sage:magic-initiate-wizard': {
      featId: 'magic-initiate',
      spellList: 'wizard',
      spellcastingAbility: 'int' as const,
      cantrips: ['mage-hand', 'light'],
      levelOneSpell: 'find-familiar',
    },
  },
};

/** A Human Rogue 1 and a Sage: the background's tool is Calligrapher's Supplies. */
const rogue = (): CharacterChoices => ({
  ...common,
  name: 'Nim',
  classId: 'rogue',
  level: 1,
  speciesId: 'human',
  abilities: {
    method: 'manual',
    assignment: { str: 8, dex: 16, con: 13, int: 14, wis: 12, cha: 10 },
  },
  abilityIncreases: { con: 2, int: 1 },
  classSkills: ['stealth', 'sleight-of-hand', 'acrobatics', 'investigation'],
  featureChoices: {
    'human:skillful': ['perception'],
    'rogue:expertise': ['stealth', 'sleight-of-hand'],
  },
  feats: { ...common.feats, 'human:versatile': { featId: 'alert' } },
});

/** A Halfling Bard 2: Jack of All Trades, and a Sage's Calligrapher's Supplies. */
const bard = (): CharacterChoices => ({
  ...common,
  name: 'Ilva',
  classId: 'bard',
  level: 2,
  speciesId: 'halfling',
  abilities: {
    method: 'manual',
    assignment: { str: 8, dex: 14, con: 13, int: 10, wis: 12, cha: 15 },
  },
  abilityIncreases: { con: 2, int: 1 },
  classSkills: ['persuasion', 'performance', 'deception'],
  cantrips: ['vicious-mockery', 'light'],
  preparedSpells: ['healing-word', 'charm-person', 'faerie-fire', 'thunderwave', 'heroism'],
  featureChoices: { 'bard:expertise': ['persuasion', 'performance'] },
});

describe('where a tool proficiency comes from', () => {
  it('records the background’s tool and the starting class’s on the sheet', () => {
    const plan = unwrap(planCharacter(SRD_CONTENT, rogue()), 'rogue');
    expect(plan.sheet.tools).toEqual({
      "Calligrapher's Supplies": 'proficient',
      "Thieves' Tools": 'proficient',
    });
    expect(plan.toolProficiencies).toEqual(["Calligrapher's Supplies", "Thieves' Tools"]);
  });

  it('pins them into the creature the fold builds, so the check reads no catalogue for them', () => {
    const state = fold('seed', unwrap(createCharacter(SRD_CONTENT, rogue(), HERO), 'rogue'));
    expect(state.creatures[HERO]!.sheet.tools?.["Thieves' Tools"]).toBe('proficient');
  });

  it('records the tools a class taken later grants — its "As a Multiclass Character" list', () => {
    const plan = unwrap(
      planCharacter(SRD_CONTENT, {
        ...common,
        name: 'Corin',
        classId: 'fighter',
        level: 1,
        multiclass: [{ classId: 'rogue', level: 1 }],
        speciesId: 'dwarf',
        abilities: {
          method: 'manual',
          assignment: { str: 15, dex: 14, con: 13, int: 10, wis: 12, cha: 8 },
        },
        abilityIncreases: { con: 2, int: 1 },
        classSkills: ['athletics', 'perception'],
        languages: ['Elvish', 'Goblin'],
        featureChoices: {
          'fighter:weapon-mastery': ['longsword', 'handaxe', 'javelin'],
          'rogue:expertise': ['athletics', 'perception'],
        },
        feats: { ...common.feats, 'fighter:fighting-style': { featId: 'defense' } },
      }),
      'fighter / rogue',
    );
    // A Sage's Calligrapher's Supplies, and the Rogue's Thieves' Tools though
    // the Rogue came second.
    expect(plan.sheet.tools?.["Thieves' Tools"]).toBe('proficient');
  });

  it('records a class that grants none as granting none', () => {
    const plan = unwrap(planCharacter(SRD_CONTENT, bard()), 'bard');
    expect(plan.sheet.tools).toEqual({ "Calligrapher's Supplies": 'proficient' });
  });

  it('reads a class’s tools out of JSON, and refuses a list that is not one', () => {
    const rogueClass = SRD_CONTENT.classById('rogue')!;
    const parsed = unwrap(parseClassDefinition(JSON.parse(JSON.stringify(rogueClass))), 'parse');
    expect(parsed.toolProficiencies).toEqual(["Thieves' Tools"]);
    const broken = parseClassDefinition({
      ...JSON.parse(JSON.stringify(rogueClass)),
      toolProficiencies: 'Thieves’ Tools',
    });
    expect(broken.ok).toBe(false);
  });
});

describe('a check that uses a tool', () => {
  it('lets Jack of All Trades stand aside: the check already uses the Proficiency Bonus', () => {
    // Acrobatics is not one of this Bard's skills, so a bare Acrobatics check
    // takes the half bonus — and one made with a tool the Bard is proficient
    // with takes the whole bonus and not the half beside it.
    const state = fold('seed', unwrap(createCharacter(SRD_CONTENT, bard(), HERO), 'bard'));
    const sheet = state.creatures[HERO]!.sheet;
    const dex = abilityModifier(sheet.abilities.dex);
    const pb = proficiencyBonus(sheet);

    const bare = unwrap(
      resolveTest(state, HERO, { kind: 'ability-check', ability: 'dex', skill: 'acrobatics', dc: 10 }, supply('a')),
    );
    expect(bare.test!.total - bare.test!.natural).toBe(dex + Math.floor(pb / 2));

    const tooled = unwrap(
      resolveTest(
        state,
        HERO,
        { kind: 'ability-check', ability: 'dex', skill: 'acrobatics', dc: 10, tool: 'calligraphers-supplies' },
        supply('a'),
      ),
    );
    expect(tooled.test!.total - tooled.test!.natural).toBe(dex + pb);
    // Not proficient in the skill, so no Advantage: the second sentence wants both.
    expect(tooled.test!.modeSources).toEqual([]);
  });

  it('refuses a tool on a saving throw, which no rule lets a tool reach', () => {
    const state = fold('seed', unwrap(createCharacter(SRD_CONTENT, rogue(), HERO), 'rogue'));
    const out = resolveTest(
      state,
      HERO,
      { kind: 'saving-throw', ability: 'dex', dc: 10, tool: 'thieves-tools' },
      supply('b'),
    );
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe('tool_on_save');
  });

  it('refuses a tool not carried, a thing that is not a tool, and nothing at all, before the die', () => {
    // The Bard is a Sage: Calligrapher's Supplies in the pack, and no Thieves'
    // Tools, and a Rapier is not a tool whatever it is carrying.
    const state = fold('seed', unwrap(createCharacter(SRD_CONTENT, bard(), HERO), 'bard'));
    const dice = supply('d');
    const code = (tool: string): string | null => {
      const out = resolveTest(state, HERO, { kind: 'ability-check', ability: 'dex', dc: 10, tool }, dice);
      return out.ok ? null : out.code;
    };
    expect(code('thieves-tools')).toBe('no_tool');
    expect(code('rapier')).toBe('not_a_tool');
    expect(code('a-tool-nobody-printed')).toBe('unknown_item');
    expect(dice.issuer.count).toBe(0);
  });

  it('writes nothing new on a check that names no tool', () => {
    const state = fold('seed', unwrap(createCharacter(SRD_CONTENT, rogue(), HERO), 'rogue'));
    const out = unwrap(
      resolveTest(state, HERO, { kind: 'ability-check', ability: 'dex', dc: 10 }, supply('c')),
    );
    const roll = out.events.find((event: GameEvent) => event.type === 'roll-recorded');
    expect(roll?.type === 'roll-recorded' && roll.label).toBe('Dexterity check');
  });
});
