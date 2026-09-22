/**
 * The bestiary's door: a monster added by id, armed with what its block
 * prints, and sized by what the book already answered.
 *
 * Three claims, and each was a hole before this file existed.
 *
 * **A monster arrives by id and never as a value.** `add_creature` takes the
 * stat block's id and nothing else about it — no Armour Class, no hit points,
 * no size — which is the reason `addCreature` takes an id rather than a block
 * in the first place. `unknown_monster` is the refusal that makes the id real,
 * and it has to be answerable through the field that names the monster, or a
 * caller reads "that is not a stat block this world holds" and has nowhere to
 * put a better one.
 *
 * **A monster that is not armed cannot fight.** `resolveAttack` refuses a
 * weapon its wielder does not own, so a goblin placed without its Scimitar is
 * a goblin that cannot make the attack its own block prints. The gear is
 * printed as *names* — "Javelins (6)", "Leather Armor" — and turning a name
 * into a catalogue id is this package's job rather than the engine's: the
 * engine holds no catalogue and reads no name. What does not resolve is
 * reported through `unverified` and the creature still arrives, because a
 * Wand nobody can find is not a reason there is no wizard.
 *
 * **The size is the book's answer, not the caller's.** `creature-added` pins
 * it and `placeCreatureInScene` reads the pinned one when a caller states
 * none, so `place_creature` stopped asking for the fact a stat block prints.
 */

import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { sizeOf } from '@ie/engine';
import { createCampaign, createSurface, type ToolOutcome } from '@ie/tools';

function table(seed = 'a-bestiary') {
  const campaign = createCampaign({ content: SRD_CONTENT, seed });
  const surface = createSurface(campaign);
  let calls = 0;
  const call = (tool: string, input: unknown = {}): ToolOutcome => {
    calls += 1;
    return surface.call({ tool, input, commandId: `toolu_${calls}` });
  };
  return { campaign, surface, call };
}

const expectOk = (outcome: ToolOutcome) => {
  if (outcome.status !== 'ok') {
    throw new Error(`expected ok, got ${outcome.status}: ${JSON.stringify(outcome).slice(0, 600)}`);
  }
  return outcome;
};

const carrying = (t: ReturnType<typeof table>, id: string): readonly string[] =>
  t.surface.observe().creatures.find((c) => c.id === id)!.carrying;

/** A room with one landmark, which is all a placement needs. */
function room(t: ReturnType<typeof table>) {
  expectOk(t.call('set_scene', { width: 60, depth: 40, height: 20 }));
  expectOk(t.call('add_landmark', { name: 'the fire', at: { x: 10, y: 10 } }));
}

describe('a monster comes through the door by its id', () => {
  it('puts the stat block in the game and reports what arrived', () => {
    const t = table();
    const added = expectOk(t.call('add_creature', { id: 'grish', monsterId: 'goblin-warrior' }));

    expect(added.resolution['added']).toBe('grish');
    expect(added.resolution['monsterId']).toBe('goblin-warrior');
    expect(added.events.some((event) => event.type === 'creature-added')).toBe(true);

    const grish = t.surface.observe().creatures.find((c) => c.id === 'grish')!;
    // Every number is the engine's, read out of the block this call named.
    expect(grish.name).toBe('Goblin Warrior');
    expect(grish.armorClass).toBe(15);
    expect(grish.hpMax).toBe(10);
    expect(grish.creatureType).toBe('Fey');
  });

  it('refuses a stat block this world does not hold, naming what it was sent', () => {
    const t = table();
    const out = t.call('add_creature', { id: 'thing', monsterId: 'wyrm-of-the-north' });
    expect(out.status).toBe('refused');
    if (out.status !== 'refused') return;
    expect(out.code).toBe('unknown_monster');
    expect(out.reason).toContain('wyrm-of-the-north');
    expect(t.campaign.log()).toHaveLength(0);
  });

  it('answers that refusal through a field, so a caller can send a better id', () => {
    const t = table();
    const missing = t.call('add_creature', { id: 'thing' });
    expect(missing.status).toBe('invalid');
    if (missing.status !== 'invalid') return;
    expect(missing.issues.map((issue) => issue.path)).toContain('monsterId');
  });

  it('takes no number out of the block from the caller', () => {
    const t = table();
    // The fields a stat block would tempt a caller to state. Zod strips what
    // the schema has not, so the proof is that they changed nothing.
    expectOk(
      t.call('add_creature', {
        id: 'grish',
        monsterId: 'goblin-warrior',
        armorClass: 25,
        hp: 400,
        size: 'gargantuan',
      }),
    );
    const grish = t.surface.observe().creatures.find((c) => c.id === 'grish')!;
    expect(grish.armorClass).toBe(15);
    expect(grish.hpMax).toBe(10);
  });

  it('refuses a second creature under a taken id, and is a no-op on a retry', () => {
    const t = table();
    expectOk(t.call('add_creature', { id: 'grish', monsterId: 'goblin-warrior' }));
    const before = t.campaign.log().length;

    const taken = t.call('add_creature', { id: 'grish', monsterId: 'ogre' });
    expect(taken.status).toBe('refused');
    if (taken.status === 'refused') expect(taken.code).toBe('already_present');

    // The same call under the transport's own id: a retry, not a second ogre.
    const again = expectOk(
      t.surface.call({
        tool: 'add_creature',
        input: { id: 'grish', monsterId: 'goblin-warrior' },
        commandId: 'toolu_1',
      }),
    );
    expect(again.resolution['duplicate']).toBe(true);
    expect(again.events).toHaveLength(0);
    expect(t.campaign.log()).toHaveLength(before);
  });
});

describe('a monster arrives holding what its block prints', () => {
  it('hands over the gear the catalogue resolves', () => {
    const t = table();
    const added = expectOk(t.call('add_creature', { id: 'grish', monsterId: 'goblin-warrior' }));

    // SRD Goblin Warrior: "Leather Armor, Scimitar, Shield, Shortbow".
    expect([...carrying(t, 'grish')].sort()).toEqual([
      'leather-armor',
      'scimitar',
      'shield',
      'shortbow',
    ]);
    expect(added.resolution['armed']).toEqual(['leather-armor', 'scimitar', 'shield', 'shortbow']);
    expect(added.events.some((event) => event.type === 'items-gained')).toBe(true);
  });

  it('hands over the count the book prints beside a plural', () => {
    const t = table();
    // SRD Bugbear Stalker: "Chain Shirt, Javelins (6), Morningstar".
    expectOk(t.call('add_creature', { id: 'stalker', monsterId: 'bugbear-stalker' }));
    const gained = t.campaign.log().find((event) => event.type === 'items-gained')!;
    expect(gained.type).toBe('items-gained');
    if (gained.type !== 'items-gained') return;
    const javelins = gained.items.find((line) => line.id === 'javelin')!;
    expect(javelins.quantity).toBe(6);
  });

  it('lets a monster swing the weapon its own block prints', () => {
    const t = table();
    expectOk(t.call('create_character', { id: 'kessa', choices: WIZARD }));
    expectOk(t.call('add_creature', { id: 'grish', monsterId: 'goblin-warrior' }));
    room(t);
    expectOk(t.call('place_creature', { who: 'kessa', fromLandmark: 'the fire', feet: 0 }));
    expectOk(t.call('place_creature', { who: 'grish', fromCreature: 'kessa', feet: 5, bearing: 0 }));

    const swung = expectOk(
      t.call('attack', { attacker: 'grish', target: 'kessa', weapon: 'scimitar' }),
    );
    expect(typeof swung.resolution['natural']).toBe('number');
  });

  it('arrives anyway when the catalogue cannot find the gear, and says which', () => {
    const t = table();
    // SRD Mage: "Wand". The SRD prices an Arcane Focus and lists a wand among
    // its forms; there is no `wand` in the equipment tables, so nothing
    // resolves — and the Mage is still a Mage.
    const added = expectOk(t.call('add_creature', { id: 'the-mage', monsterId: 'mage' }));
    expect(t.surface.observe().creatures.find((c) => c.id === 'the-mage')).toBeDefined();
    expect(carrying(t, 'the-mage')).toEqual([]);
    expect(added.resolution['armed']).toEqual([]);
    expect(added.unverified.join(' ')).toContain('Wand');
    expect(added.events.some((event) => event.type === 'items-gained')).toBe(false);
  });

  it('reports the stat block’s own unverified clauses beside the gear it could not find', () => {
    const t = table();
    // The Vampire Familiar prints "Charmed (except from its vampire master)",
    // which `addCreature` withholds and reports. Its gear — "Daggers (10)" —
    // resolves, so this is the two reports living together.
    const added = expectOk(t.call('add_creature', { id: 'renfield', monsterId: 'vampire-familiar' }));
    expect(added.unverified.length).toBeGreaterThan(0);
    expect(carrying(t, 'renfield')).toContain('dagger');
  });
});

describe('the size comes from the book, not from the caller', () => {
  it('places a creature at the size its stat block pinned', () => {
    const t = table();
    expectOk(t.call('add_creature', { id: 'grish', monsterId: 'goblin-warrior' }));
    room(t);
    expectOk(t.call('place_creature', { who: 'grish', fromLandmark: 'the fire', feet: 0 }));

    // Nobody said "small". The book did, and `creature-added` pinned it.
    expect(sizeOf(t.campaign.state().scene!, 'grish' as never)).toBe('small');
  });

  it('places a Large one the same way, with no size in the call', () => {
    const t = table();
    expectOk(t.call('add_creature', { id: 'brute', monsterId: 'ogre' }));
    room(t);
    expectOk(t.call('place_creature', { who: 'brute', fromLandmark: 'the fire', feet: 0 }));
    expect(sizeOf(t.campaign.state().scene!, 'brute' as never)).toBe('large');
  });

  it('still lets a caller state one, for the creature whose record pins none', () => {
    const t = table();
    expectOk(t.call('create_character', { id: 'kessa', choices: WIZARD }));
    room(t);
    expectOk(
      t.call('place_creature', { who: 'kessa', fromLandmark: 'the fire', feet: 0, size: 'small' }),
    );
    expect(sizeOf(t.campaign.state().scene!, 'kessa' as never)).toBe('small');
  });

  it('and lets one beat a pinned size, because shrinking a hound is the table’s', () => {
    const t = table();
    expectOk(t.call('add_creature', { id: 'grish', monsterId: 'goblin-warrior' }));
    room(t);
    // The block pins Small. The caller says Medium, and the caller wins — the
    // engine's own rule, and the reason the field survives the narrowing at
    // all rather than being read as "the pinned size, always".
    expectOk(
      t.call('place_creature', { who: 'grish', fromLandmark: 'the fire', feet: 0, size: 'medium' }),
    );
    expect(sizeOf(t.campaign.state().scene!, 'grish' as never)).toBe('medium');
  });

  it('no longer asks for one on a move or a teleport, where the record has it', () => {
    const t = table();
    const schemaOf = (name: string) => t.surface.tools.find((tool) => tool.name === name)!.schema;

    const moved = schemaOf('move').safeParse({
      who: 'grish',
      fromCreature: 'kessa',
      feet: 5,
      size: 'gargantuan',
    });
    expect(moved.success).toBe(true);
    expect((moved.data as Record<string, unknown>)['size']).toBeUndefined();

    // And `place_creature` does have it, so the assertion above is a
    // statement about `move` rather than about the probe.
    const placed = schemaOf('place_creature').safeParse({
      who: 'grish',
      fromLandmark: 'the fire',
      feet: 0,
      size: 'large',
    });
    expect(placed.success).toBe(true);
    expect((placed.data as Record<string, unknown>)['size']).toBe('large');
  });
});

/** `fight.test.ts`'s wizard, transcribed, so two files fight the same character. */
const BOOK = [
  'magic-missile',
  'shield',
  'detect-magic',
  'feather-fall',
  'mage-armor',
  'sleep',
  'thunderwave',
  'hold-person',
  'misty-step',
  'web',
];

const WIZARD: Record<string, unknown> = {
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
  classSkills: ['investigation', 'insight'],
  languages: ['Draconic', 'Elvish'],
  alignment: 'Chaotic Good',
  subclassId: 'evoker',
  cantrips: ['fire-bolt', 'light', 'prestidigitation'],
  spellbook: BOOK.slice(0, 10).map((spellId, index) => ({
    spellId,
    acquiredAt: index < 6 ? 1 : Math.ceil((index - 5) / 2) + 1,
    origin: 'level' as const,
  })),
  preparedSpells: [
    'magic-missile',
    'shield',
    'mage-armor',
    'hold-person',
    'burning-hands',
    'scorching-ray',
  ],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: [],
  hitPoints: { method: 'fixed' },
  featureChoices: {
    'wizard:scholar': ['arcana'],
    'human:skillful': ['perception'],
    'evoker:evocation-savant': ['burning-hands', 'scorching-ray'],
  },
  feats: {
    'sage:magic-initiate-wizard': {
      featId: 'magic-initiate',
      spellList: 'wizard',
      spellcastingAbility: 'int',
      cantrips: ['mage-hand', 'ray-of-frost'],
      levelOneSpell: 'find-familiar',
    },
    'human:versatile': { featId: 'skilled', proficiencies: ['stealth', 'nature', 'survival'] },
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard package only' },
};

/**
 * And the fourth claim, which was a shut door until now: **a monster swings
 * with a line its own block prints.**
 *
 * `AttackCommand.action` is the third source of an attack's numbers, beside a
 * catalogue weapon and a spell, and it is the one a bestiary needs — a Wolf's
 * `Bite` is not an item, so no `weapon` names it and an Unarmed Strike is not
 * what the book printed. The field existed in the engine and reached no tool,
 * so the only swing a model could ask a Wolf for was one the Wolf does not
 * make.
 *
 * **It is a name and never a line**, for the reason `add_creature` takes a
 * monster's id: an entry point that accepted an attack bonus would be the door
 * a model-authored +12 walked through. The `+4` and the `1d6 + 2` are read off
 * the block the engine pinned when the creature entered the game.
 *
 * Every assertion below is one a *stripped* field cannot produce. Zod drops a
 * key no schema has heard of in silence, so "the call succeeded" proves nothing
 * at all — `unknown_action` and `two_attacks` are refusals only the engine
 * writes, and only when the field arrived.
 */
describe('a monster swings with a line its own block prints', () => {
  /** A wolf and something to bite, five feet apart. */
  const pack = (seed = 'the-bite-lands') => {
    const t = table(seed);
    room(t);
    expectOk(t.call('add_creature', { id: 'fang', monsterId: 'wolf' }));
    expectOk(t.call('add_creature', { id: 'grish', monsterId: 'goblin-warrior' }));
    expectOk(t.call('place_creature', { who: 'fang', fromLandmark: 'the fire', feet: 0 }));
    expectOk(t.call('place_creature', { who: 'grish', fromCreature: 'fang', feet: 5, bearing: 0 }));
    return t;
  };

  it('elects the Bite, which no weapon on this creature could have answered', () => {
    const t = pack();
    // The Wolf's block prints no gear, so there is nothing for `weapon` to
    // name: without `action` the only swing available is an Unarmed Strike.
    expect(carrying(t, 'fang')).toEqual([]);

    const swung = expectOk(t.call('attack', { attacker: 'fang', target: 'grish', action: 'Bite' }));
    expect(swung.resolution['hit']).toBe(true);
    // The numbers are the block's and not the caller's: nothing in the call
    // said +4 or 1d6 + 2, and the die the engine threw is in the log.
    expect(swung.events.some((event) => event.type === 'roll-recorded')).toBe(true);
    // And the line that landed is the Bite rather than an Unarmed Strike,
    // said by the engine rather than inferred: the Wolf's printed line ends
    // "If the target is a Medium or smaller creature, it has the Prone
    // condition", and the engine executes that sentence. An Unarmed Strike has
    // no such line, so a goblin left standing would mean the wrong line was
    // swung. (It used to read as an `unverified` clause instead, which is
    // where the same sentence went before the engine could apply it.)
    expect(
      swung.events.some(
        (event) =>
          event.type === 'condition-applied' && event.id === 'grish' && event.condition === 'prone',
      ),
    ).toBe(true);
  });

  it('refuses a line the block does not print, which is the field arriving', () => {
    const t = pack('no-such-line');
    const refusal = t.call('attack', { attacker: 'fang', target: 'grish', action: 'Headbutt' });
    expect(refusal.status).toBe('refused');
    if (refusal.status !== 'refused') return;
    expect(refusal.code).toBe('unknown_action');
    expect(refusal.reason).toContain('Headbutt');
    // A refusal that cost nothing, as every pre-flight refusal here does.
    expect(t.campaign.state().rollsIssued).toBe(0);
  });

  it('refuses a swing whose numbers would come from two places', () => {
    const t = pack('two-sources');
    expectOk(t.call('add_creature', { id: 'snarl', monsterId: 'goblin-warrior' }));
    expectOk(t.call('place_creature', { who: 'snarl', fromCreature: 'fang', feet: 5, bearing: 90 }));

    const refusal = t.call('attack', {
      attacker: 'snarl',
      target: 'grish',
      weapon: 'scimitar',
      action: 'Scimitar',
    });
    expect(refusal.status).toBe('refused');
    if (refusal.status !== 'refused') return;
    expect(refusal.code).toBe('two_attacks');
  });

  /**
   * And the other half of what a door owes: a fact merely missing comes back
   * as homework rather than as a verdict, with the tool that would settle it
   * named on *this* surface.
   */
  it('asks where the creature is standing rather than refusing the Bite', () => {
    const t = table('unplaced');
    room(t);
    expectOk(t.call('add_creature', { id: 'fang', monsterId: 'wolf' }));
    expectOk(t.call('add_creature', { id: 'grish', monsterId: 'goblin-warrior' }));
    expectOk(t.call('place_creature', { who: 'fang', fromLandmark: 'the fire', feet: 0 }));

    const asked = t.call('attack', { attacker: 'fang', target: 'grish', action: 'Bite' });
    expect(asked.status).toBe('needs-context');
    if (asked.status !== 'needs-context') return;
    expect(asked.establish.map((one) => one.kind)).toContain('position');
    expect(asked.establish[0]!.tools).toContain('place_creature');
    // And the question is asked about the Bite by name, which is the field
    // arriving: an Unarmed Strike would have asked the same question about a
    // different reach.
    expect(asked.establish[0]!.because).toContain('Bite');
    expect(t.campaign.state().rollsIssued).toBe(0);
  });
});
