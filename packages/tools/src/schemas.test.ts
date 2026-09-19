/**
 * Every tool's schema rejects a malformed call, and says something a caller
 * could act on.
 *
 * The sweep is the load-bearing half: a tool added later without a schema
 * that rejects anything fails here rather than in production, and the
 * "`invalid` is never a rules refusal" line is what makes the difference
 * worth enforcing — a caller told the *rules* said no would go looking for a
 * rule to work around, and there is none, because the engine was never asked.
 */

import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { createCampaign, createSurface, TOOL_NAMES, TOOLS, type ToolOutcome } from '@ie/tools';

const surface = () => createSurface(createCampaign({ content: SRD_CONTENT, seed: 'schemas' }));

const send = (tool: string, input: unknown): ToolOutcome =>
  surface().call({ tool, input, commandId: 'toolu_schema' });

/** The three calls that legitimately take no arguments. */
const NO_ARGUMENTS = ['end_turn', 'look', 'settle_area_effects'];

describe('every schema rejects a malformed call', () => {
  it.each(TOOLS.map((definition) => definition.name))(
    '%s refuses arguments that are not even an object',
    (name) => {
      const outcome = send(name, 42);
      expect(outcome.status).toBe('invalid');
      if (outcome.status !== 'invalid') return;
      expect(outcome.code).toBe('malformed_arguments');
      expect(outcome.reason).toContain(name);
      expect(outcome.issues.length).toBeGreaterThan(0);
      expect(outcome.issues[0]!.message.length).toBeGreaterThan(0);
    },
  );

  it('accepts an empty object for exactly the calls that take no arguments', () => {
    const accepting = TOOL_NAMES.filter((name) => send(name, {}).status !== 'invalid');
    expect(accepting.sort()).toEqual(NO_ARGUMENTS);
  });

  it('names the field at fault, so a caller can fix it', () => {
    const outcome = send('attack', { attacker: 7, target: 'vex' });
    expect(outcome.status).toBe('invalid');
    if (outcome.status !== 'invalid') return;
    expect(outcome.issues.map((issue) => issue.path)).toContain('attacker');
  });

  it('names a field inside an array', () => {
    const outcome = send('cast_spell', { caster: 'kessa', spellId: 'fire-bolt', targets: [7] });
    expect(outcome.status).toBe('invalid');
    if (outcome.status !== 'invalid') return;
    expect(outcome.issues.map((issue) => issue.path)).toContain('targets.0');
  });

  it('says which of the allowed words it wanted', () => {
    const outcome = send('take_action', { who: 'kessa', kind: 'shove' });
    expect(outcome.status).toBe('invalid');
    if (outcome.status !== 'invalid') return;
    expect(outcome.reason).toContain('kind');
  });

  it('treats an unknown tool as invalid rather than as a rules refusal', () => {
    const outcome = send('swing_from_chandelier', {});
    expect(outcome.status).toBe('invalid');
    if (outcome.status !== 'invalid') return;
    expect(outcome.code).toBe('unknown_tool');
    expect(outcome.reason).toContain('attack');
  });
});

describe('a placement needs exactly one anchor', () => {
  it('refuses neither', () => {
    const outcome = send('place_creature', { who: 'kessa', feet: 10 });
    expect(outcome.status).toBe('invalid');
    if (outcome.status !== 'invalid') return;
    expect(outcome.reason).toContain('exactly one of fromLandmark or fromCreature');
  });

  it('refuses both', () => {
    const outcome = send('place_creature', {
      who: 'kessa',
      feet: 10,
      fromLandmark: 'the bar',
      fromCreature: 'vex',
    });
    expect(outcome.status).toBe('invalid');
  });
});

/**
 * The first inviolable rule, as it reaches creation.
 *
 * Four things the engine offers a human DM and this surface does not: dice
 * results (`hitPoints: 'rolled'`), scores nothing checked (`abilities:
 * 'manual'`), gold, and a magic item — which is the sharpest of them,
 * because a granted wand is mechanically live and casts a spell at a DC the
 * item sets. Each is a *schema* that rejects it rather than a paragraph
 * saying it should not be sent, which is the difference the brief asked for.
 */
describe('creation takes no number, and no grant, the caller made up', () => {
  const choices = (over: Record<string, unknown>) => ({
    name: 'Kessa',
    classId: 'wizard',
    level: 3,
    speciesId: 'human',
    backgroundId: 'sage',
    abilities: {
      method: 'standard-array',
      assignment: { str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 10 },
    },
    abilityIncreases: { int: 2, con: 1 },
    classSkills: [],
    languages: [],
    alignment: 'Chaotic Good',
    cantrips: [],
    spellbook: [],
    preparedSpells: [],
    classEquipment: 'A',
    backgroundEquipment: 'A',
    equipped: [],
    hitPoints: { method: 'fixed' },
    featureChoices: {},
    feats: {},
    ...over,
  });

  it('refuses rolled hit points', () => {
    const outcome = send('create_character', {
      id: 'kessa',
      choices: choices({ hitPoints: { method: 'rolled', rolls: [8, 8] } }),
    });
    expect(outcome.status).toBe('invalid');
    if (outcome.status !== 'invalid') return;
    expect(outcome.issues.some((issue) => issue.path.startsWith('choices.hitPoints'))).toBe(true);
  });

  it('refuses a magic item the caller granted itself', () => {
    const outcome = send('create_character', {
      id: 'kessa',
      choices: choices({
        level: 3,
        dmGrants: { items: [], goldPieces: 0, magicItems: ['wand-of-fireballs'], note: 'a gift' },
      }),
    });
    expect(outcome.status).toBe('invalid');
    if (outcome.status !== 'invalid') return;
    expect(outcome.issues.some((issue) => issue.path.startsWith('choices.dmGrants'))).toBe(true);
  });

  it('refuses gold the caller granted itself, and keeps the note', () => {
    const outcome = send('create_character', {
      id: 'kessa',
      choices: choices({
        level: 3,
        dmGrants: { items: [], goldPieces: 500, magicItems: [], note: 'a purse' },
      }),
    });
    expect(outcome.status).toBe('invalid');
    if (outcome.status !== 'invalid') return;
    expect(outcome.issues.some((issue) => issue.path.includes('goldPieces'))).toBe(true);
    // The empty grant with a note is the answer the engine wanted, and it
    // still passes the schema — the field was narrowed, not removed.
    expect(
      send('create_character', {
        id: 'kessa',
        choices: choices({
          level: 3,
          dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard package only' },
        }),
      }).status,
    ).not.toBe('invalid');
  });

  it('refuses ability scores nothing checked', () => {
    const outcome = send('create_character', {
      id: 'kessa',
      choices: choices({
        abilities: {
          method: 'manual',
          assignment: { str: 18, dex: 18, con: 18, int: 18, wis: 18, cha: 18 },
        },
      }),
    });
    expect(outcome.status).toBe('invalid');
    if (outcome.status !== 'invalid') return;
    expect(outcome.issues.some((issue) => issue.path.startsWith('choices.abilities'))).toBe(true);
  });
});
