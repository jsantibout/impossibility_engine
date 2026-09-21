/**
 * What a creature's own stat block prints, where a caller can read it.
 *
 * `attack.printed` has always demanded an attack **the block prints, by its
 * printed name** — a Wolf's `Bite` — and `unknown_action` is what a caller
 * meets for anything else. Until this file, nothing on either surface said
 * what those names were: `add_creature` reported the id it was sent and the
 * gear it resolved, and `look` reported hit points, Armour Class and
 * conditions. So a human DM had to know the block out of band, and a model —
 * which has no book — could not be told one at all. The single legal swing was
 * the one it could guess.
 *
 * The claims below are each a question a caller could not answer before:
 *
 * - **What can this creature do?** The printed attacks, the printed Actions
 *   lines and the printed Bonus Actions lines, under the headings the book
 *   prints them under, which are the strings `action` and a spend take.
 * - **What has it already spent?** A line with a recharge is gone until it
 *   comes back, `line_expended` is the refusal that says so, and the report
 *   agrees with that refusal rather than being a second opinion about it.
 * - **How many swings is its Attack action, and of what?** A Multiattack is a
 *   *named sequence*: a Ghoul makes two **Bite** attacks, and it also prints a
 *   Claw — so a count alone would be a rule nobody printed.
 *
 * Nothing here is derived. Every field is read off the sheet `adaptMonster`
 * built when the creature entered the game, so a report cannot disagree with
 * what the engine will accept, and a block nobody added is a block nobody can
 * read: `look` reaches into no catalogue, which the last test is the guard
 * for.
 */

import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { createCampaign, createSurface, type ObservedBlock, type ToolOutcome } from '@ie/tools';

function table(seed: string) {
  const campaign = createCampaign({ content: SRD_CONTENT, seed });
  const surface = createSurface(campaign);
  let calls = 0;
  const call = (tool: string, input: unknown = {}): ToolOutcome =>
    surface.call({ tool, input, commandId: `toolu_${(calls += 1)}` });
  return { campaign, surface, call };
}

type Table = ReturnType<typeof table>;

const expectOk = (outcome: ToolOutcome) => {
  if (outcome.status !== 'ok') {
    throw new Error(`expected ok, got ${outcome.status}: ${JSON.stringify(outcome).slice(0, 600)}`);
  }
  return outcome;
};

const expectRefused = (outcome: ToolOutcome) => {
  if (outcome.status !== 'refused') {
    throw new Error(`expected refused, got ${outcome.status}: ${JSON.stringify(outcome).slice(0, 600)}`);
  }
  return outcome;
};

const seen = (t: Table, id: string) => t.surface.observe().creatures.find((one) => one.id === id)!;

/** The block, insisted upon: a creature the caller can see states one or it does not. */
const blockOf = (t: Table, id: string): ObservedBlock => {
  const printed = seen(t, id).printed;
  if (printed === null) throw new Error(`${id} states no stat block`);
  return printed;
};

/** A room with one landmark, which is all a placement needs. */
function room(t: Table) {
  expectOk(t.call('set_scene', { width: 120, depth: 80, height: 20 }));
  expectOk(t.call('add_landmark', { name: 'the fire', at: { x: 10, y: 10 } }));
}

/** One monster and something to swing at, a stated distance apart. */
function pair(seed: string, monsterId: string, feet: number): Table {
  const t = table(seed);
  room(t);
  expectOk(t.call('add_creature', { id: 'beast', monsterId }));
  expectOk(t.call('add_creature', { id: 'grish', monsterId: 'goblin-warrior' }));
  expectOk(t.call('place_creature', { who: 'beast', fromLandmark: 'the fire', feet: 0 }));
  expectOk(t.call('place_creature', { who: 'grish', fromCreature: 'beast', feet, bearing: 0 }));
  return t;
}

const fighter = (name: string): Record<string, unknown> => ({
  name,
  classId: 'fighter',
  level: 1,
  speciesId: 'dwarf',
  backgroundId: 'criminal',
  abilities: {
    method: 'standard-array',
    assignment: { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 },
  },
  abilityIncreases: { con: 2, dex: 1 },
  classSkills: ['athletics', 'perception'],
  languages: ['Dwarvish', 'Goblin'],
  alignment: 'Neutral',
  cantrips: [],
  spellbook: [],
  preparedSpells: [],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: [],
  hitPoints: { method: 'fixed' },
  featureChoices: { 'fighter:weapon-mastery': ['longsword', 'handaxe', 'javelin'] },
  feats: { 'criminal:alert': { featId: 'alert' }, 'fighter:fighting-style': { featId: 'defense' } },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard package only' },
});

describe('a caller can read the attacks a block prints', () => {
  it("names a Wolf's Bite as the printed name `action` demands", () => {
    const t = pair('the-bite-is-named', 'wolf', 5);

    const block = blockOf(t, 'beast');
    expect(block.attacks.map((one) => one.name)).toEqual(['Bite']);

    const bite = block.attacks[0]!;
    expect(bite.kind).toBe('melee');
    expect(bite.reach).toBe(5);
    expect(bite.range).toBeNull();
    // The Wolf's line ends in a sentence the engine hands back rather than
    // applies, and a caller electing the Bite is owed it before it swings.
    expect(bite.rider).toContain('Prone');
    expect(bite.recharge).toBeNull();
    expect(bite.expended).toBe(false);

    // The round trip: the name that was read is the name the engine takes.
    const swung = expectOk(
      t.call('attack', { attacker: 'beast', target: 'grish', action: bite.name }),
    );
    expect(typeof swung.resolution['hit']).toBe('boolean');
  });

  it('states no block for a creature whose sheet prints none', () => {
    const t = table('a-character-prints-nothing');
    expectOk(t.call('create_character', { id: 'bram', choices: fighter('Bram') }));
    expect(seen(t, 'bram').printed).toBeNull();
  });
});

describe('a caller can read what a line costs and whether it is gone', () => {
  it("reports the Ape's Rock, what brings it back, and that it is still there", () => {
    const t = pair('the-rock-is-there', 'ape', 25);

    const block = blockOf(t, 'beast');
    const rock = block.attacks.find((one) => one.name === 'Rock (Recharge 6)')!;
    expect(rock.kind).toBe('ranged');
    expect(rock.range).toEqual({ normal: 25, long: 50 });
    // The book's own answer to "when does this come back", in the words a
    // refusal quotes: a die at the start of its turn, or either rest.
    expect(rock.recharge).toContain('1d6');
    expect(rock.recharge).toContain('Short or Long Rest');
    expect(rock.expended).toBe(false);
    expect(block.expendedLines).toEqual([]);

    // The Fist beside it prints no recharge at all, which is the other half of
    // the same fact: a line a caller may take every turn.
    expect(block.attacks.find((one) => one.name === 'Fist')!.recharge).toBeNull();
  });

  it('says the line is gone once it has been thrown, and agrees with the refusal', () => {
    const t = pair('the-rock-is-thrown', 'ape', 25);
    expectOk(t.call('attack', { attacker: 'beast', target: 'grish', action: 'Rock (Recharge 6)' }));

    const block = blockOf(t, 'beast');
    expect(block.expendedLines).toEqual(['Rock (Recharge 6)']);
    expect(block.attacks.find((one) => one.name === 'Rock (Recharge 6)')!.expended).toBe(true);
    // Unspent lines are untouched by another line's spending.
    expect(block.attacks.find((one) => one.name === 'Fist')!.expended).toBe(false);

    // And the report is the engine's own answer rather than a second opinion:
    // the swing it describes as gone is the swing the engine refuses.
    const again = expectRefused(
      t.call('attack', { attacker: 'beast', target: 'grish', action: 'Rock (Recharge 6)' }),
    );
    expect(again.code).toBe('line_expended');
  });
});

describe('a caller can read the lines a block prints besides its attacks', () => {
  it("reports a Blink Dog's Bonus Action, its sentence and its recharge", () => {
    const t = pair('the-dog-blinks', 'blink-dog', 5);

    const block = blockOf(t, 'beast');
    expect(block.bonusActions).toHaveLength(1);

    const teleport = block.bonusActions[0]!;
    // The heading as printed, including what the book prints inside it, which
    // is the string a spend and a log both carry.
    expect(teleport.name.startsWith('Teleport')).toBe(true);
    expect(teleport.name).toContain('Recharge');
    // The sentence, because the engine applies none of it: a line handed over
    // without its text is a creature doing something nobody can act on.
    expect(teleport.text).toContain('teleports up to 40 feet');
    expect(teleport.recharge).toContain('Short or Long Rest');
    expect(teleport.expended).toBe(false);
  });

  it("reports a Winter Wolf's Cold Breath, which is an Actions line nobody parsed", () => {
    const t = pair('the-breath-is-printed', 'winter-wolf', 15);

    const block = blockOf(t, 'beast');
    const breath = block.actions.find((one) => one.name.startsWith('Cold Breath'))!;
    expect(breath.text).toContain('Cold damage');
    expect(breath.recharge).toContain('Short or Long Rest');
    expect(breath.expended).toBe(false);
    // It is not one of the attacks, which is the distinction the report keeps:
    // the engine rolls an attack and hands this one over.
    expect(block.attacks.map((one) => one.name)).not.toContain(breath.name);
  });
});

describe('a Multiattack reports as the sequence it is', () => {
  it('says two Bite attacks, and not two of whatever the Ghoul prints', () => {
    const t = pair('two-bites', 'ghoul', 5);

    const block = blockOf(t, 'beast');
    // The Ghoul prints a Claw as well, so a bare count would have been a rule
    // nobody printed: its Attack action is two Bites.
    expect(block.attacks.map((one) => one.name)).toEqual(['Bite', 'Claw']);

    const multiattack = block.multiattack!;
    expect(multiattack.sequences).toEqual([{ clauses: [{ count: 2, attacks: ['Bite'] }], requires: null }]);
    expect(multiattack.handOver).toBeNull();
  });

  it("reports a Clay Golem's alternation, and the line the longer one is gated on", () => {
    // Fifteen feet, because a Clay Golem is Large and five would be occupied.
    const t = pair('the-golem-hastens', 'clay-golem', 15);

    const block = blockOf(t, 'beast');
    const sequences = block.multiattack!.sequences;
    expect(sequences).toHaveLength(2);

    const [ordinary, gated] = sequences;
    expect(ordinary).toEqual({ clauses: [{ count: 2, attacks: ['Slam'] }], requires: null });
    expect(gated!.clauses).toEqual([{ count: 3, attacks: ['Slam'] }]);
    // The gate is a Bonus Action line the same block prints, by its heading —
    // so a caller can find what it must take first.
    expect(gated!.requires).toBe(block.bonusActions[0]!.name);
    expect(gated!.requires).toContain('Hasten');
  });

  it('states no Multiattack where the block prints none', () => {
    const t = pair('one-bite', 'wolf', 5);
    expect(blockOf(t, 'beast').multiattack).toBeNull();
  });
});

describe('a block nobody can see is a block nobody can read', () => {
  it('reports no block for a creature that is not in this game', () => {
    const t = pair('nothing-leaks', 'wolf', 5);

    // The Basilisk is in this campaign's content and not in its game. Its
    // Petrifying Gaze is exactly the kind of thing a caller would want and
    // must not be handed: `look` reads the creatures the log added, and opens
    // no catalogue to do it.
    expect(SRD_CONTENT.monsters.some((one) => one.id === 'basilisk')).toBe(true);
    expect(t.surface.observe().creatures.map((one) => one.id)).toEqual(['beast', 'grish']);
    expect(JSON.stringify(t.surface.observe())).not.toContain('Petrifying Gaze');
    expect(JSON.stringify(t.surface.observe())).not.toContain('Basilisk');
  });
});
