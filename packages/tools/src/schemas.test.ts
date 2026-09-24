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
import {
  characterChoicesSchema,
  createCampaign,
  createSurface,
  TOOL_NAMES,
  TOOLS,
  type ToolOutcome,
} from '@ie/tools';

const surface = () => createSurface(createCampaign({ content: SRD_CONTENT, seed: 'schemas' }));

const send = (tool: string, input: unknown): ToolOutcome =>
  surface().call({ tool, input, commandId: 'toolu_schema' });

/**
 * The calls that legitimately take no arguments.
 *
 * Each of them is an instruction to do the one thing the engine is owed, and
 * the engine knows which thing: a turn boundary, a look, an area effect it is
 * holding, a damage roll it is holding. There is nothing to name because there
 * is only ever one of them open at a time.
 *
 * **`declare_dawn` is the one that is empty for a different reason**, and it
 * is the narrowest form invariant 1 takes on this surface. Nothing is owed and
 * nothing is open; a morning simply happens to the world rather than to a
 * person, so there is no creature to name, and what it gives back — which
 * pools, how many charges, which dice — is read off each pool's own recovery
 * tag by the engine. A field here would be the caller producing one of those
 * answers.
 */
const NO_ARGUMENTS = [
  'declare_dawn',
  'dismiss_stranded_summons',
  'end_turn',
  'look',
  'settle_area_effects',
  'settle_damage',
  // The seventh, and `settle_area_effects`' twin in every way that matters:
  // the debt is in state, the DC was pinned when the moment raised it, and the
  // caller is instructing the engine to settle what it is owed rather than
  // naming one. A field here would be a caller producing a number.
  'settle_saves',
];

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

  /**
   * A size is a choice, and a choice a schema strips is a choice nobody can
   * make.
   *
   * Zod objects drop an unknown key in silence, so `create_character` carrying
   * no `size` would not *refuse* a stated one — it would accept the call,
   * create the character, and throw the word away, which is the failure mode
   * `doors.test.ts` was written about: "asserting that it succeeds proves
   * nothing at all". So the field is proved the way that file proves one, with
   * a value no string field can take, and then proved again by watching the
   * word survive validation with its case intact.
   *
   * **The case is the point of the second assertion.** The engine matches this
   * against the word the species prints, without regard to case — a language
   * and an alignment are matched the same way — so what has to arrive is what
   * the caller wrote, not something this layer normalised on the way past.
   * What creation then *does* with the word is the engine's: an answer the
   * species does not offer comes back as `bad_size` naming the field, which is
   * why the field is a plain string rather than this file's own six-word enum.
   */
  it('carries a stated size rather than stripping it', () => {
    const outcome = send('create_character', { id: 'kessa', choices: choices({ size: -1 }) });
    expect(outcome.status).toBe('invalid');
    if (outcome.status !== 'invalid') return;
    expect(outcome.issues.map((issue) => issue.path)).toContain('choices.size');

    // And the word itself, through validation and out the other side.
    expect(characterChoicesSchema.parse(choices({ size: 'Small' })).size).toBe('Small');

    // Still a call this schema accepts, with the size stated and without it:
    // the field was added, not made compulsory. Whether a *particular* word is
    // one the species offers is creation's answer and not this file's, so a
    // `bad_size` refusal would leave both of these assertions standing.
    expect(
      send('create_character', { id: 'kessa', choices: choices({ size: 'Small' }) }).status,
    ).not.toBe('invalid');
    expect(send('create_character', { id: 'kessa', choices: choices({}) }).status).not.toBe(
      'invalid',
    );
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
