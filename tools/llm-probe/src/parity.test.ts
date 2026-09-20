/**
 * Does the tool surface publish what the engine can actually be asked?
 *
 * Both live experiments lost their worst turn to the same thing, and it was
 * never a rule and never the model:
 *
 * | | The engine had | The surface published | What happened |
 * |---|---|---|---|
 * | Tier 1 | `MoveCommand.forced`, since Thunderwave | nothing | a correctly-ruled shove with nowhere to land |
 * | Tier 2 | `CastSpellRequest.towards` | nothing | four calls hunting for somewhere to put a bearing, turn lost |
 *
 * Twice is a class, not an incident, and the class is invisible from either
 * side on its own: the engine is complete and correct, the tool schema is
 * well-formed, and the gap is only in the join. A refusal naming a parameter
 * the caller has no way to send looks exactly like a rule saying no.
 *
 * So this test reads the engine's **own source** for the request types the
 * surface wraps, and holds every field against a decision. A field that is
 * neither published nor explained fails, which means a new engine parameter
 * fails here the day it is added — and is then either exposed or deliberately
 * excluded with the reason written down, rather than quietly becoming the next
 * lost turn.
 *
 * Parsing source at test time is the technique `spell-tracking.test.ts`
 * already uses on the SRD prose and `bestiary.ts` uses on the stat blocks: the
 * authority is the artefact, not a list somebody maintained beside it.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { expect as unwrap } from '@ie/shared';
import { rollInitiativeAndBeginCombat, speed } from '@ie/engine';
import { TOOLS, dispatch } from './surface.js';
import { createSession, type Session } from './session.js';
import { CLERIC, FIGHTER, MAGE, OGRE, OGRE_SEED, ogreEncounter } from './ogre.js';

/**
 * The command layer's own source, read whole.
 *
 * `commands.ts` is a barrel and the commands live in `commands/`, so the
 * artefact this reads is the directory rather than the file. Reading the
 * barrel would find no interface and no function at all, and every assertion
 * below would then be checking nothing — which is the failure mode this whole
 * file exists to prevent, arriving in its own machinery.
 */
const COMMANDS_DIR = fileURLToPath(
  new URL('../../../packages/engine/src/commands/', import.meta.url),
);

const commandSource = (): string =>
  readdirSync(COMMANDS_DIR)
    .filter((file) => file.endsWith('.ts'))
    .map((file) => readFileSync(`${COMMANDS_DIR}${file}`, 'utf8'))
    .join('\n');

/**
 * The fields an engine request interface declares, read off its own source.
 *
 * Stops at the first line that is a bare `}` in column zero, which is where an
 * exported interface ends in this file; anything nested is indented and cannot
 * end the body early.
 */
function fieldsOf(source: string, name: string): readonly string[] {
  const start = source.indexOf(`export interface ${name}`);
  expect(start, `no interface called ${name}`).toBeGreaterThan(-1);
  const end = source.indexOf('\n}\n', start);
  const body = source.slice(start, end);
  return [...body.matchAll(/^\s+readonly (\w+)\??:/gm)].map((m) => m[1]!);
}

const propertiesOf = (tool: string): ReadonlySet<string> => {
  const spec = TOOLS.find((t) => t.name === tool);
  expect(spec, `no tool called ${tool}`).toBeDefined();
  const params = spec!.parameters as { properties: Record<string, unknown> };
  return new Set(Object.keys(params.properties));
};

/**
 * One engine parameter's fate: the tool property that carries it, or the
 * reason it is deliberately not published.
 *
 * A reason is prose and cannot be checked for honesty — but it has to exist,
 * it has to be written by somebody making the decision, and it sits in a
 * reviewed list rather than in nobody's head. Three reasons recur and are
 * worth naming rather than repeating:
 *
 * - **a number that would decide an outcome.** `attackBonuses`, `bonuses`.
 *   The Inviolable Rule; these must never appear here as `exposed`.
 * - **opens a debt with no settlement.** `hold` on an attack or a casting
 *   opens `pendingAttack` / `pendingCasting`, and nothing on this surface
 *   settles either. Publishing one without the other is how a fight wedges,
 *   which is the failure `settle_area_effects` exists to have already fixed
 *   once.
 * - **no reachable user.** A rule that no creature in either benchmark can
 *   invoke. Honest, and the first thing to revisit when one can.
 */
type Fate = { readonly exposed: string } | { readonly excluded: string };

const expose = (property: string): Fate => ({ exposed: property });
const because = (reason: string): Fate => ({ excluded: reason });

/** Inherited from `CommandIdentity`, and every mutating tool takes one. */
const IDENTITY: readonly string[] = ['commandId'];

const AUDIT: readonly {
  readonly tool: string;
  readonly request: string;
  readonly fates: Readonly<Record<string, Fate>>;
}[] = [
  {
    tool: 'cast_spell',
    request: 'CastSpellRequest',
    fates: {
      spellId: expose('spell_id'),
      targets: expose('targets'),
      at: expose('at'),
      // The Tier 2 fix. Published as a point to aim at — a creature, a
      // landmark or a spot — because that is what the engine takes and because
      // an angle would be the model typing raw geometry.
      towards: expose('towards'),
      anchoring: because(
        'whether an area is centred on a space or on the intersection between four of them, which decides whether its footprint comes out odd or even. A real tactical choice and not a number that decides an outcome — but which of the two a given spell wants is a property of the spell (a 20-foot radius wants an intersection, a 5-foot-wide Line wants a space), so it belongs to the definition rather than to a per-cast decision the DM makes afresh each time. Publish it if and when a definition cannot say',
      ),
      slotLevel: expose('slot_level'),
      slotKind: because(
        'Pact Magic beside Spellcasting slots, which only a Warlock multiclassed into a full caster has; no creature in either benchmark does, and creation refuses two casting classes anyway',
      ),
      slotless: because('casting a Ritual or through a feature that spends nothing; no benchmark reaches it'),
      source: because(
        'which grant supplies a spell, for a caster whose class and a feat both do. Every Magic Initiate spell in Tier 2 is one the class does not also supply, so the default is never ambiguous — publish this the first time a route collides',
      ),
      unaffected: because('Spirit Guardians and Alarm print the clause; neither is castable by anyone here'),
      damageType: because('Spirit Guardians reads the caster alignment; same, nobody can cast it'),
      fought: because(
        'SRD Charm Person: "It does so with Advantage if you or your allies are fighting it." Five spells print the clause, the engine refuses a casting of one that does not answer it, and the answer is a list because an upcast casting names several targets — so this is required rather than optional the day any of them is castable here, and no benchmark character has one prepared',
      ),
      teleportTo: because(
        'where a teleporting spell puts its target. Two spells print the clause — Misty Step and Dimension Door — and the engine refuses a casting of either that names no space, so this is required rather than optional the day one of them is castable here. Neither benchmark character has one prepared, and publishing it means publishing a `Placement`, which is the vocabulary the movement tool would have to expose first',
      ),
      payment: because(
        'a free daily casting *and* a slot both serving. Reachable in principle — all three Tier 2 characters carry a Magic Initiate free casting — and measured as unreachable in practice: Shield refuses on its Reaction trigger first and Mage Armor has no executable definition, so the engine never gets as far as asking',
      ),
      hold: because(
        'opens a pending casting, and nothing on this surface settles a declared casting. Publishing it alone would wedge the fight, which is the deadlock this audit exists to have stopped repeating',
      ),
      ritual: because(
        'SRD casts a Ritual in ten minutes more than the spell normally takes, which makes it a declared casting settled off the clock — so it opens a pending casting exactly as `hold` does, and nothing on this surface settles one. It is also refused outright while a fight is running, and both benchmarks are fights. Publish it with the settlement command, never before',
      ),
      answers: because(
        'which casting a Reaction interrupts, by id. Only Counterspell prints the trigger that reads it, and nothing on this surface opens a pending casting for one to answer — `hold` and `ritual` are both withheld above for that reason. It is also optional where the named caster has exactly one casting open, so the day a settlement command is published this is what a caller re-sends with when they have two',
      ),
      item: because(
        'which magic item casts the spell. A real DM decision and a cheap one to publish — but no creature in either benchmark is holding a casting item, and the surface has no way to give one out or to attune to it, so a published field would refuse every value it could be sent. Publish it beside an inventory tool, not before',
      ),
      charges: because(
        'how many of an item\'s charges a casting spends, which is the wielder\'s decision exactly as a slot level is. Refused without `item` above, so it is the same fact and waits on the same tool — and only the seven wands whose line reads "no more than 3 charges" offer a choice at all; everything else is priced at one number the grant already holds',
      ),
      usingFeatures: because(
        'which of the caster\'s own features this casting uses. SRD writes three of the five damage-altering features as a permission — "you can add your Charisma modifier", "you can deal maximum damage" — and a permission the caller cannot send is a permission nobody ever has. It is a genuine decision and not a number: Overchannel charges escalating Necrotic damage for a second use, so a surface that decided it for the caster would be spending the wizard\'s hit points on their behalf. No creature in either benchmark holds one of the five — they arrive at Sorcerer 6, Wizard 3, 10 and 14 and Ranger 20 — so a published field would refuse every value it could be sent today. Publish it the day a benchmark character has one, and publish the list of what they hold beside it, because a model cannot elect a feature it has not been told about',
      ),
    },
  },
  {
    tool: 'attack',
    request: 'AttackCommand',
    fates: {
      target: expose('target'),
      weapon: expose('weapon'),
      // The other Tier 2 fix. A Javelin is "Melee or Ranged" and which one it
      // is this time is the attacker's choice; without this the engine
      // measured melee reach and the DM closed to melee instead.
      thrown: expose('thrown'),
      twoHanded: because(
        'a Versatile weapon swung in two hands rolls a larger die. Nobody in either benchmark carries one — a Greatsword is two-handed outright and a Mace and a Scimitar are neither',
      ),
      finesseAbility: because('Strength or Dexterity on a Finesse weapon; no Finesse weapon is in play'),
      modes: because(
        'Advantage and Disadvantage. The engine already derives every conditional source itself, and what is left is a DM granting it by fiat — a real DM power, and one that changes an outcome, so it wants deciding on its own evidence rather than as a parity tidy-up',
      ),
      attackBonuses: because('a number that would decide an outcome'),
      damageBonuses: because('a number that would decide an outcome'),
      extraDamage: because(
        'Sneak Attack and Divine Smite shape. Dice rather than amounts, so not forbidden — but the engine derives these from features it already holds, and nobody in either benchmark has one',
      ),
      hold: because(
        'opens `pendingAttack` so a Shield can land between the two rolls, and nothing on this surface settles a held attack',
      ),
      free: because('an attack whose cost is paid elsewhere; the engine passes it internally for an Opportunity Attack and no caller should'),
      bonusAction: because(
        'SRD Martial Arts\' "you can make an Unarmed Strike as a Bonus Action", which is a real decision and not a number — a Monk chooses whether to spend the Bonus Action on a punch or keep it for something else. It is refused outright to anybody whose features grant no such strike, and no character in either benchmark is a Monk, so a published field would refuse every value it could be sent today. Publish it the day a benchmark character has a class that grants one',
      ),
      featureDamageTypes: because('Divine Strike and Primal Strike choose a type per hit; both are level 8 features'),
    },
  },
  {
    tool: 'move',
    request: 'MoveCommand',
    fates: {
      placement: expose('from_landmark'),
      forced: expose('forced'),
      difficultFeet: because(
        'a DM ruling that this ground costs extra. Legitimate authorship rather than a forbidden number, and no beat in either benchmark asked for it — the one persistent area that would, Grease, prints its Difficult Terrain in `unmodelled`',
      ),
      route: because(
        'the 5-foot spaces a move crossed, which the engine asks for only when a declared patch of Difficult Terrain covers some of the ground between the endpoints and not the rest. Nothing in either benchmark declares one, so the question is never put; and it is a fact rather than a number — the engine still works out what the crossing cost',
      ),
    },
  },
  {
    tool: 'ability_check',
    request: 'TestCommand',
    fates: {
      kind: expose('kind'),
      ability: expose('ability'),
      skill: expose('skill'),
      dc: expose('dc'),
      label: expose('label'),
      // A fact about the attempt, which the engine cannot derive: Minor
      // Illusion makes a sound *or* an image, so whether seeing it through
      // needs eyes depends on the illusion.
      senses: expose('requires_sight'),
      modes: because('same as the attack roll: a DM granting Advantage by fiat wants its own decision'),
      bonuses: because('a number that would decide an outcome'),
    },
  },
  {
    tool: 'take_opportunity_attack',
    request: 'OpportunityCommand',
    fates: { weapon: expose('weapon') },
  },
];

describe('every engine parameter is either published or explained', () => {
  const source = commandSource();

  for (const entry of AUDIT) {
    describe(`${entry.request} → ${entry.tool}`, () => {
      /**
       * The half that catches the next gap before a benchmark does.
       *
       * A parameter added to the engine is not in this map, so this fails and
       * somebody has to decide. That is the whole mechanism — the same shape
       * as the debt invariant in `probe.test.ts`, pointed at the request types
       * instead of at `GameState`.
       */
      it('accounts for every field the engine declares', () => {
        const declared = fieldsOf(source, entry.request).filter((f) => !IDENTITY.includes(f));
        const accounted = Object.keys(entry.fates);
        expect(declared.sort(), `${entry.request} has a field nobody has decided about`).toEqual(
          accounted.sort(),
        );
      });

      it('publishes a real tool property for everything it claims to expose', () => {
        const properties = propertiesOf(entry.tool);
        for (const [field, fate] of Object.entries(entry.fates)) {
          if (!('exposed' in fate)) continue;
          expect(properties, `${entry.request}.${field} claims ${fate.exposed}`).toContain(
            fate.exposed,
          );
        }
      });

      it('gives a reason for everything it withholds', () => {
        for (const [field, fate] of Object.entries(entry.fates)) {
          if ('exposed' in fate) continue;
          expect(fate.excluded.length, `${entry.request}.${field}`).toBeGreaterThan(20);
        }
      });
    });
  }
});

/**
 * Capabilities that are whole commands rather than parameters.
 *
 * A missing *parameter* costs a turn. A missing *command* can cost the fight:
 * `owedAreaEffects` blocks every action including ending the turn, and until
 * this audit the only thing hiding that was a second gap — `cast_spell` could
 * not point a Cube, so no spell on this surface could make a persistent area
 * in the first place. The two masked each other exactly, and fixing either one
 * alone would have wedged Tier 2.
 */
describe('every engine command the benchmarks can reach has a tool', () => {
  const REQUIRED: Readonly<Record<string, string>> = {
    settleAreaEffects: 'settle_area_effects',
    declareCover: 'declare_cover',
    resolveEffectCheck: 'attempt_effect_check',
    resolveSpell: 'cast_spell',
    resolveAttack: 'attack',
    resolveMove: 'move',
    resolveTest: 'ability_check',
    resolveTurn: 'end_turn',
    takeOpportunityAttack: 'take_opportunity_attack',
    declineOpportunity: 'decline_opportunity',
    declareSight: 'declare_sight',
    declareCreatureType: 'declare_creature_type',
    placeCreature: 'place_creature',
  };

  it('names a tool for each of them', () => {
    const names = new Set(TOOLS.map((t) => t.name));
    for (const [command, tool] of Object.entries(REQUIRED)) {
      expect(names, `${command} has no tool`).toContain(tool);
    }
  });

  /**
   * And the engine functions named above are real.
   *
   * A map of strings can drift into naming a command that was renamed or
   * removed, and would then go on passing while guarding nothing.
   */
  it('names engine commands that exist', () => {
    const source = commandSource();
    const positioning = readFileSync(
      fileURLToPath(new URL('../../../packages/engine/src/positioning.ts', import.meta.url)),
      'utf8',
    );
    for (const command of Object.keys(REQUIRED)) {
      const declared =
        source.includes(`export function ${command}(`) ||
        positioning.includes(`export function ${command}(`);
      expect(declared, `${command} is not an exported engine command`).toBe(true);
    }
  });
});

// — and the things it published actually work ————————————————————————————————

/**
 * A schema entry proves nothing. Each of these drives a newly published
 * parameter through `dispatch` and asserts the engine did the thing that was
 * previously unreachable — and, where it matters, that the old behaviour was
 * genuinely wrong rather than merely different.
 */
describe('the parameters this audit published actually work', () => {
  /** The Tier 2 mill, with combat running so a turn can be refused. */
  const mill = (): Session => {
    const encounter = ogreEncounter();
    const session = createSession(OGRE_SEED, encounter.prelude);
    const state = session.state();
    session.push(
      unwrap(
        rollInitiativeAndBeginCombat(
          state,
          encounter.roster.map((id) => ({ id, speed: speed(state.creatures[id]!.sheet) })),
          session.supply(),
        ),
        'initiative',
      ),
    );
    return session;
  };

  const call = (session: Session, tool: string, input: Record<string, unknown>) =>
    dispatch(session, tool, input, { narration: [] });

  /** Walk the order round until it is this creature's turn. */
  const until = (session: Session, id: string): void => {
    for (let i = 0; i < 8; i += 1) {
      const combat = session.state().combat!;
      if (combat.order[combat.turnIndex]?.id === id) return;
      const advanced = call(session, 'end_turn', { command_id: `advance-${id}-${i}` });
      expect(advanced.outcome, 'advancing the order').toBe('ok');
    }
    throw new Error(`never reached the turn of ${id}`);
  };

  /**
   * Grease laid between the Ogre and the party, pointed at the door.
   *
   * The origin is deliberately just clear of where the Ogre already stands —
   * a creature that starts inside an area has no outside to enter from, and
   * the test would then pass for the wrong reason. `towards_landmark` is half
   * the point of the fixture: the direction is named by something in the room
   * rather than typed as geometry, which is the vocabulary the engine's own
   * docstring asks for.
   */
  const grease = (session: Session, commandId: string) =>
    call(session, 'cast_spell', {
      caster: MAGE,
      spell_id: 'grease',
      targets: [],
      slot_level: 1,
      at: { x: 30, y: 20, z: 0 },
      towards_landmark: 'the mill door',
      command_id: commandId,
    });

  it('casts a directional area, which Tier 2 spent a whole turn failing to express', () => {
    const session = mill();
    until(session, MAGE);
    expect(grease(session, 'grease-1').outcome).toBe('ok');
    expect(Object.values(session.state().ongoing).map((o) => o.spellId)).toContain('grease');
  });

  it('still refuses a Cube with nowhere to point, and says so', () => {
    const session = mill();
    until(session, MAGE);
    const result = call(session, 'cast_spell', {
      caster: MAGE,
      spell_id: 'grease',
      targets: [],
      slot_level: 1,
      at: { x: 30, y: 20, z: 0 },
      command_id: 'no-direction',
    });
    expect(result.outcome).toBe('refusal');
    expect(result.code).toBe('no_direction');
  });

  /**
   * **The deadlock, demonstrated and then closed.**
   *
   * `owedAreaEffects` is global engine debt: `mayAct` refuses every action
   * while one stands, and `resolveTurn`'s own guard refuses *before* it
   * reaches the settlement it would otherwise perform internally. So a
   * creature that walks into a Grease can neither act nor end its turn, and
   * the fight stops — with no rule broken and nothing to blame.
   *
   * Publishing `towards` without publishing this would have created exactly
   * that, which is why the two landed together.
   */
  it('wedges the fight on an owed area effect, and one command is the way out', () => {
    const session = mill();
    until(session, MAGE);
    expect(grease(session, 'grease-2').outcome).toBe('ok');
    expect(call(session, 'end_turn', { command_id: 'mage-done' }).outcome).toBe('ok');

    until(session, OGRE);
    // Into the slick. The Ogre starts at (20, 20), outside the Cube.
    const walked = call(session, 'move', {
      who: OGRE,
      from_landmark: 'the mill door',
      feet: 20,
      bearing: 270,
      size: 'large',
      command_id: 'ogre-walks-in',
    });
    expect(walked.outcome, 'the Ogre walks into the grease').toBe('ok');
    expect(session.state().owedAreaEffects.length, 'which the engine notices').toBeGreaterThan(0);

    // Everything is refused, including the one thing that would normally get
    // a stuck turn moving again.
    for (const [tool, input] of [
      ['end_turn', { command_id: 'stuck-1' }],
      ['attack', { attacker: OGRE, target: CLERIC, weapon: 'greatclub', command_id: 'stuck-2' }],
      ['take_action', { who: OGRE, kind: 'dodge', command_id: 'stuck-3' }],
    ] as const) {
      const blocked = call(session, tool, input);
      expect(blocked.outcome, tool).toBe('refusal');
      expect(blocked.code, tool).toBe('area_effect_owed');
    }

    const settled = call(session, 'settle_area_effects', { command_id: 'settle-1' });
    expect(settled.outcome).toBe('ok');
    expect(session.state().owedAreaEffects).toEqual([]);
    expect(call(session, 'end_turn', { command_id: 'unstuck' }).outcome, 'the fight goes on').toBe(
      'ok',
    );
  });

  /**
   * Tier 2 recorded this as a silent substitution: the player said "fall back
   * and put a javelin through it", the surface could not say *thrown*, the
   * engine measured melee reach, and the DM closed to melee and narrated a
   * thrust. A different mechanic resolved, with prose over the join.
   */
  it('throws a javelin at a range a swing cannot reach', () => {
    const swung = (() => {
      const session = mill();
      until(session, FIGHTER);
      return call(session, 'attack', {
        attacker: FIGHTER,
        target: OGRE,
        weapon: 'javelin',
        command_id: 'swing',
      });
    })();
    expect(swung.outcome, 'ten feet is outside a javelin reach').toBe('refusal');
    expect(swung.code).toBe('out_of_reach');

    const session = mill();
    until(session, FIGHTER);
    const thrown = call(session, 'attack', {
      attacker: FIGHTER,
      target: OGRE,
      weapon: 'javelin',
      thrown: true,
      command_id: 'throw',
    });
    expect(thrown.outcome, 'and inside its thrown range').toBe('ok');
  });

  /**
   * Declared cover had no tool at all, so every attack in both benchmarks was
   * resolved as though the mill machinery and the tavern bar were not there.
   * Total Cover is the unambiguous half to assert: the SRD does not make the
   * attack harder, it makes the target untargetable.
   */
  it('declares cover, and the engine applies the rule rather than a number', () => {
    const session = mill();
    until(session, FIGHTER);
    expect(
      call(session, 'declare_cover', { from: FIGHTER, to: OGRE, degree: 'total' }).outcome,
    ).toBe('ok');
    const blocked = call(session, 'attack', {
      attacker: FIGHTER,
      target: OGRE,
      weapon: 'javelin',
      thrown: true,
      command_id: 'through-cover',
    });
    expect(blocked.outcome, 'SRD: a creature behind Total Cover cannot be targeted').toBe('refusal');

    expect(
      call(session, 'declare_cover', { from: FIGHTER, to: OGRE, degree: 'none' }).outcome,
      'and the declaration can be withdrawn when the line clears',
    ).toBe('ok');
    expect(
      call(session, 'attack', {
        attacker: FIGHTER,
        target: OGRE,
        weapon: 'javelin',
        thrown: true,
        command_id: 'clear-line',
      }).outcome,
    ).toBe('ok');
  });

  it('refuses a cover degree the engine has no rule for', () => {
    const session = mill();
    const result = call(session, 'declare_cover', { from: FIGHTER, to: OGRE, degree: 'a bit' });
    expect(result.outcome).toBe('invalid');
    expect(result.code).toBe('malformed_input');
  });

  /**
   * `requires_sight` is a fact about the *attempt*, which the engine cannot
   * derive: Minor Illusion makes a sound or an image, so whether seeing
   * through it needs eyes depends on the illusion.
   *
   * The Difficulty Class is 1, so the total beats it however the die falls. A
   * failure can then only have come from the automatic one Blinded imposes,
   * which is what makes this deterministic rather than lucky.
   */
  it('fails a sight-dependent check outright for a Blinded creature', () => {
    const session = mill();
    until(session, FIGHTER);
    expect(
      call(session, 'apply_ruled_condition', {
        who: FIGHTER,
        condition: 'blinded',
        ruling: 'flour dust off the chute',
        command_id: 'blind',
      }).outcome,
    ).toBe('ok');

    const sighted = call(session, 'ability_check', {
      who: FIGHTER,
      kind: 'ability-check',
      ability: 'wis',
      skill: 'perception',
      dc: 1,
      requires_sight: true,
      label: 'spot the seam in the floor',
      command_id: 'look-for-it',
    });
    expect(sighted.outcome).toBe('ok');
    const body = sighted.body as { total: number; success: boolean };
    expect(body.total, 'the die comfortably beat the DC').toBeGreaterThanOrEqual(1);
    expect(body.success, 'and it failed anyway, because Blinded').toBe(false);
  });
});
