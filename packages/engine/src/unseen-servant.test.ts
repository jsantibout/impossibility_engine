import { describe, expect, it } from 'vitest';
import { SPELL_DEFINITIONS, SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap, type CharacterId, type Result } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { declaredCasting } from './spellcasting.js';
import { checkSpellDefinition } from './spell-schema.js';
import type { SpellDefinition, SpellEffect } from './spell-definitions.js';
import { actionRulesOn } from './standing.js';
import {
  damageCreature,
  dismissStrandedSummons,
  resolveSpell,
  strandedSummons,
} from './commands.js';
import { summonedId } from './commands/spell-effect-summon.js';

/**
 * A stat block printed inside a spell — SRD Unseen Servant.
 *
 * > _Level 1 Conjuration (Bard, Warlock, Wizard) (Ritual)._ **Casting Time:**
 * > Action or Ritual. **Range:** 60 feet. **Duration:** 1 hour.
 * > "This spell creates an Invisible, mindless, shapeless, Medium force that
 * > performs simple tasks at your command until the spell ends. The servant
 * > springs into existence in an unoccupied space on the ground within range.
 * > It has AC 10, 1 Hit Point, and a Strength of 2, and it can't attack. If it
 * > drops to 0 Hit Points, the spell ends."
 *
 * The one stat block in the book that is in neither chapter: three numbers in
 * one sentence, printed nowhere a bestiary could transcribe them from. So the
 * `summon` effect takes it **inline** and adapts it through the same road a
 * bestiary block takes — the servant is a creature, with the Armour Class, the
 * Hit Point and the Strength the spell prints, Invisible from the condition
 * vocabulary, forbidden the Attack action, held by the casting for its hour —
 * and the sentence that ends it is a fifth cause on the casting's own record:
 * the creature it is sustaining dropping to 0.
 */

const id = (s: string) => asCharacterId(s);
const WIZ = id('wiz');
const FOE = id('foe');

const sheet = (): CharacterSheet => ({
  level: 5,
  abilities: { str: 10, dex: 14, con: 12, int: 18, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'int',
});

const added = (who: CharacterId, side: string): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(),
  maxHp: 40,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side,
});

const SETUP: readonly GameEvent[] = [
  added(WIZ, 'party'),
  added(FOE, 'foes'),
  {
    type: 'spellcasting-declared',
    id: WIZ,
    spellcasting: declaredCasting({ ability: 'int', prepared: ['unseen-servant'] }),
  },
  {
    type: 'resource-pool-declared',
    id: WIZ,
    pool: { key: 'spell-slot:1', label: 'level 1', max: 4, recovers: 'long-rest' },
  },
  { type: 'scene-set', extent: { width: 200, depth: 200, height: 40 } },
  { type: 'landmark-added', name: 'the hall', at: { x: 50, y: 50, z: 0 } },
  { type: 'creature-placed', id: WIZ, placement: { from: { landmark: 'the hall' }, feet: 0 } },
  { type: 'creature-placed', id: FOE, placement: { from: { creature: WIZ }, feet: 10, bearing: 0 } },
];

const supply = (seed = 'servant') => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

const must = <T,>(result: Result<T>): T => unwrap(result, 'the servant');
const state = (log: readonly GameEvent[]): GameState => fold('seed', log);

const conjured = (): { log: readonly GameEvent[]; casting: string; servant: CharacterId } => {
  const cast = must(
    resolveSpell(state(SETUP), WIZ, { spellId: 'unseen-servant', targets: [WIZ], slotLevel: 1 }, supply()),
  );
  const casting = cast.castingId!;
  return { log: [...SETUP, ...cast.events], casting, servant: summonedId(casting, 'inline:unseen-servant') };
};

describe('the definition is written to the book', () => {
  const servant = (): SpellDefinition => SPELL_DEFINITIONS.find((one) => one.id === 'unseen-servant')!;

  it('prints its stat block inline on the summons, and the ending on the casting', () => {
    const summon = servant().effects[0] as Extract<SpellEffect, { kind: 'summon' }>;
    expect(summon.kind).toBe('summon');
    expect(summon.monster).toBeUndefined();
    expect(summon.inline).toMatchObject({
      name: 'Unseen Servant',
      armorClass: 10,
      hitPoints: 1,
      abilities: { str: 2 },
      size: 'medium',
      conditions: ['invisible'],
    });
    expect(summon.cannotAttack).toBe(true);
    expect(servant().endsEarly).toEqual([{ on: 'summon-drops-to-0', ends: 'casting' }]);
    expect(checkSpellDefinition(servant())).toEqual([]);
  });

  it('refuses a summons naming both a block and an inline one, or neither', () => {
    const summon = servant().effects[0] as Extract<SpellEffect, { kind: 'summon' }>;
    const codes = (effect: object): readonly string[] =>
      checkSpellDefinition({ ...servant(), effects: [effect as SpellEffect] }).map((p) => p.code);
    expect(codes({ ...summon, monster: 'goblin-warrior' })).toContain('two_stat_blocks');
    const bare: Record<string, unknown> = { ...summon };
    delete bare['inline'];
    expect(codes(bare)).toContain('unknown_monster');
    expect(codes({ ...summon, inline: { ...summon.inline!, hitPoints: 0 } })).toContain(
      'bad_inline_block',
    );
    expect(codes({ ...summon, inline: { ...summon.inline!, conditions: ['sleepy'] } })).toContain(
      'unknown_condition',
    );
  });
});

describe('the servant', () => {
  it('stands at AC 10 with 1 Hit Point and a Strength of 2, Medium, Invisible, and cannot attack', () => {
    const { log, casting, servant } = conjured();
    const after = state(log);
    const creature = after.creatures[servant];
    expect(creature?.name).toBe('Unseen Servant');
    expect(creature?.sheet.stated?.armorClass).toBe(10);
    expect(creature?.vitals.hpMax).toBe(1);
    expect(creature?.vitals.hp).toBe(1);
    expect(creature?.sheet.abilities.str).toBe(2);
    expect(creature?.size).toBe('medium');
    // The book gives the force no creature type, and the engine invents none.
    expect(creature?.creatureType).toBeNull();
    expect(creature?.conditions.instances.map((one) => one.condition)).toEqual(['invisible']);
    expect(creature?.conditions.instances[0]?.source).toContain(casting);
    expect(
      actionRulesOn(after, servant).some(
        (rule) => rule.rule.kind === 'forbids' && (rule.rule.actions ?? []).includes('attack'),
      ),
    ).toBe(true);
    // Held by the casting for its hour, on the summoner's side.
    expect(creature?.summonedBy).toEqual({ by: WIZ, castingId: casting });
    expect(creature?.side).toBe('party');
    expect(after.ongoing[casting]).toBeDefined();
  });

  it('ends the spell when it drops to 0 Hit Points, and is then owed its departure', () => {
    const { log, casting, servant } = conjured();
    const struck = must(damageCreature(state(log), servant, { amount: 1, source: 'a dagger', by: FOE }));
    const after = state([...log, ...struck]);
    expect(after.creatures[servant]?.vitals.hp).toBe(0);
    expect(after.ongoing[casting]).toBeUndefined();
    expect(strandedSummons(after)).toEqual([servant]);
    const gone = must(dismissStrandedSummons(after));
    expect(state([...log, ...struck, ...gone]).creatures[servant]).toBeUndefined();
  });

  it('is untouched by a blow on somebody else', () => {
    const { log, casting } = conjured();
    const struck = must(damageCreature(state(log), FOE, { amount: 1, source: 'a dagger', by: WIZ }));
    expect(state([...log, ...struck]).ongoing[casting]).toBeDefined();
  });
});
