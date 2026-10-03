import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, isErr, expect as unwrap, type CharacterId, type Result } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { createCharacter, type CharacterChoices } from './creation.js';
import { addCreature, resolveSpell } from './commands.js';
import { hearsAndUnderstands } from './languages.js';
import { checkSpellDefinition } from './spell-schema.js';
import type { SpellDefinition } from './spell-definitions.js';

/**
 * SRD Suggestion: "You suggest a course of activity … to one creature you can
 * see within range **that can hear and understand you**."
 *
 * Two facts, and the engine holds both now. **Hearing** is the Deafened
 * condition. **Understanding** is a language the caster speaks and the target
 * understands: a character's off its record, which the owner's ruling sends
 * the question to, and a stat block's off its Languages line, which the parser
 * reads (`speech`). A casting at a creature that cannot hear the caster, or
 * shares no language with them, is refused before a slot is spent. Where
 * nothing the engine holds can say — a creature with no record and no line, or
 * a shared tongue that could only be one of the GM's "other languages" — the
 * casting goes ahead and says so. (E-L1)
 */

const id = (s: string): CharacterId => asCharacterId(s);
const BARD = id('bard');
const OGRE = id('ogre');
const GIANT = id('giant');
const WOLF = id('wolf');
const LEMURE = id('lemure');
const GOBLIN = id('goblin');
const STRANGER = id('stranger');
const MAGE = id('mage');

const bard = (): CharacterChoices => ({
  name: 'Ilva',
  classId: 'bard',
  level: 3,
  speciesId: 'human',
  backgroundId: 'sage',
  languages: ['Dwarvish', 'Orc'],
  alignment: 'Neutral',
  abilities: {
    method: 'manual',
    assignment: { str: 8, dex: 14, con: 13, int: 10, wis: 12, cha: 17 },
  },
  abilityIncreases: { con: 2, int: 1 },
  classSkills: ['performance', 'stealth', 'deception'],
  subclassId: 'college-of-lore',
  cantrips: ['vicious-mockery', 'dancing-lights'],
  spellbook: [],
  preparedSpells: ['bane', 'charm-person', 'dissonant-whispers', 'heroism', 'suggestion', 'hold-person'],
  backgroundEquipment: 'A',
  classEquipment: 'A',
  equipped: [],
  hitPoints: { method: 'fixed' },
  featureChoices: {
    'human:skillful': ['perception'],
    'bard:expertise': ['performance', 'stealth'],
    'college-of-lore:bonus-proficiencies': ['acrobatics', 'athletics', 'insight'],
  },
  feats: {
    'sage:magic-initiate-wizard': {
      featId: 'magic-initiate',
      spellList: 'wizard',
      spellcastingAbility: 'int',
      cantrips: ['mage-hand', 'light'],
      levelOneSpell: 'find-familiar',
    },
    'human:versatile': { featId: 'alert' },
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
});

const plain = (): CharacterSheet => ({
  level: 1,
  abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: null,
});

const supply = (state: GameState) => ({
  issuer: createRollIssuer('r', state.rollsIssued),
  rng: createRng('suggest') as Rng,
  content: SRD_CONTENT,
});

const ROOM: readonly GameEvent[] = (() => {
  const log: GameEvent[] = [...(unwrap(createCharacter(SRD_CONTENT, bard(), BARD), 'bard') as GameEvent[])];
  const add = (who: CharacterId, block: string) => {
    log.push(...unwrap(addCreature(fold('s', log), SRD_CONTENT, who, block), block).events);
  };
  add(OGRE, 'ogre');
  add(GIANT, 'hill-giant');
  add(WOLF, 'wolf');
  add(LEMURE, 'lemure');
  add(GOBLIN, 'goblin-warrior');
  add(MAGE, 'mage');
  log.push({
    type: 'creature-added',
    id: STRANGER,
    name: STRANGER,
    sheet: plain(),
    maxHp: 10,
    diesAtZero: false,
    creatureType: 'Humanoid',
  });
  log.push({ type: 'scene-set', extent: { width: 300, depth: 300, height: 40 } });
  log.push({ type: 'landmark-added', name: 'the hall', at: { x: 150, y: 150, z: 0 } });
  log.push({ type: 'creature-placed', id: BARD, placement: { from: { landmark: 'the hall' }, feet: 0 } });
  [OGRE, GIANT, WOLF, LEMURE, GOBLIN, STRANGER, MAGE].forEach((who, at) => {
    log.push({
      type: 'creature-placed',
      id: who,
      placement: { from: { creature: BARD }, feet: 20, bearing: at * 45 },
    });
    log.push({ type: 'sight-declared', from: BARD, to: who, seen: true });
  });
  return log;
})();

const suggest = (target: CharacterId, log: readonly GameEvent[] = ROOM) =>
  resolveSpell(
    fold('s', log),
    BARD,
    { spellId: 'suggestion', targets: [target], slotLevel: 2 },
    supply(fold('s', log)),
  ) as Result<{ readonly events: readonly GameEvent[]; readonly unverified: readonly string[] }>;

const code = (result: Result<unknown>): string | null => (isErr(result) ? result.code : null);

describe('SRD Suggestion: a target that can hear and understand you', () => {
  it('is cast at an ogre, which speaks Common', () => {
    const out = unwrap(suggest(OGRE), 'ogre');
    expect(out.events.some((event) => event.type === 'spell-cast')).toBe(true);
    expect(out.unverified.join(' ')).not.toContain('hear and understand');
  });

  it('is refused at a hill giant, which speaks only Giant, and nothing is spent', () => {
    const refused = suggest(GIANT);
    expect(code(refused)).toBe('does_not_understand');
  });

  it('is refused at a wolf, which comprehends no language', () => {
    expect(code(suggest(WOLF))).toBe('does_not_understand');
  });

  it('is refused at a lemure, which understands only Infernal', () => {
    expect(code(suggest(LEMURE))).toBe('does_not_understand');
  });

  it('is refused at a goblin that cannot hear', () => {
    const deaf: GameEvent = {
      type: 'condition-applied',
      id: GOBLIN,
      condition: 'deafened',
      source: 'the bell',
    };
    expect(code(suggest(GOBLIN))).toBeNull();
    expect(code(suggest(GOBLIN, [...ROOM, deaf]))).toBe('cannot_hear');
  });

  it('goes ahead at a creature nothing describes, and says what it could not check', () => {
    const out = unwrap(suggest(STRANGER), 'stranger');
    expect(out.events.some((event) => event.type === 'spell-cast')).toBe(true);
    expect(out.unverified.join(' ')).toContain('hear and understand');
  });
});

describe('hearsAndUnderstands, between two stat blocks', () => {
  it('cannot say where the shared tongue could only be one the GM chooses', () => {
    // A hill giant speaks Giant; a mage speaks "Common plus three other
    // languages", which may or may not include it.
    const state = fold('s', ROOM);
    expect(hearsAndUnderstands(state, SRD_CONTENT, GIANT, MAGE).answer).toBe('unknown');
    expect(hearsAndUnderstands(state, SRD_CONTENT, OGRE, GIANT).answer).toBe('yes');
    expect(hearsAndUnderstands(state, SRD_CONTENT, GIANT, OGRE).answer).toBe('yes');
  });
});

describe('the validator holds the clause to what it can mean', () => {
  const suggestion = SRD_CONTENT.spell('suggestion')!;
  const codes = (targets: unknown): readonly string[] =>
    checkSpellDefinition({ ...suggestion, targets } as SpellDefinition).map((one) => one.code);

  it('accepts Suggestion, and refuses a malformed flag', () => {
    expect(suggestion.targets.hearsAndUnderstands).toBe(true);
    expect(codes(suggestion.targets)).toEqual([]);
    expect(codes({ ...suggestion.targets, hearsAndUnderstands: 'yes' })).toContain('malformed_field');
  });
});
