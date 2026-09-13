/**
 * Tier 2's fixture, and the harness assumptions generalising it removed.
 *
 * Two jobs. The first is the ordinary one: the encounter is what it claims to
 * be, built from content rather than transcribed, so a benchmark run against
 * it is measuring the boundary and not a typo in a stat block.
 *
 * The second is the one worth reading. Every assertion under "the harness is
 * no longer three combatants and one player" pins a thing that **was silently
 * true of the tavern and is false in general** — three actors, one scripted
 * player, one shared intent cursor, a flat 30-foot Speed. Each of those would
 * have produced a plausible-looking Tier 2 run with a wrong number in it, and
 * none of them would have failed a test that only ever ran the tavern.
 */

import { describe, expect, it } from 'vitest';
import { asCharacterId } from '@ie/shared';
import { armorClassOf, carrying, distanceBetween, fold, remaining, spellSlotKey, speed } from '@ie/engine';
import { CLERIC, FIGHTER, MAGE, OGRE, OGRE_SEED, ogreEncounter } from './ogre.js';
import { WIZARD, tavernEncounter } from './fixture.js';
import { createScriptedDriver, type DriverTurn, type ModelDriver } from './drivers.js';
import { runExperiment } from './harness.js';
import { growthOf } from './metrics.js';

const encounter = ogreEncounter();
const opening = () => fold(OGRE_SEED, encounter.prelude);

const run = () =>
  runExperiment(createScriptedDriver(encounter, new Set([MAGE])), {
    encounter,
    rounds: 4,
    maxExchangesPerBeat: 8,
  });

describe('the party is three level 2 characters the engine built', () => {
  it('gives each one the hit points, Armour Class and slots their class prints', () => {
    const state = opening();

    const brannis = state.creatures[FIGHTER]!;
    expect(brannis.vitals.hpMax, 'Fighter: 10 + 6 fixed, +3 Con twice').toBe(22);
    expect(armorClassOf(state, FIGHTER), 'chain mail').toBe(16);

    const ilda = state.creatures[CLERIC]!;
    expect(ilda.vitals.hpMax, 'Cleric: 8 + 5 fixed, +2 Con twice').toBe(17);
    expect(armorClassOf(state, CLERIC), 'chain shirt and a shield').toBe(16);
    expect(remaining(ilda.resources, spellSlotKey(1)), 'the level 2 Cleric row').toBe(3);

    const thessaly = state.creatures[MAGE]!;
    expect(thessaly.vitals.hpMax, 'Wizard: 6 + 4 fixed, +2 Con twice').toBe(14);
    expect(remaining(thessaly.resources, spellSlotKey(1)), 'the level 2 Wizard row').toBe(3);
  });

  /**
   * The Wizard is meant to be reachable, and a benchmark that could not put
   * anyone on the floor would never exercise unconsciousness, death saves or a
   * heal off the floor. An Ogre's Greatclub is 2d8 + 4 — a minimum of 6 and an
   * average of 13 — so this is the arithmetic that makes the rest reachable
   * rather than a thing to hope for.
   */
  it('leaves the Wizard inside two Greatclub hits', () => {
    expect(opening().creatures[MAGE]!.vitals.hpMax).toBeLessThan(2 * 13);
  });

  it('gives every character a second spellcasting route through the Sage feat', () => {
    const state = opening();
    for (const who of [FIGHTER, CLERIC, MAGE]) {
      const pools = Object.keys(state.creatures[who]!.resources.pools);
      expect(pools, who).toContain('sage:magic-initiate-wizard:free-cast');
    }
  });
});

describe('the Ogre comes from the stat block, not from a transcription', () => {
  it('is a Large Giant with the printed Armour Class and hit points', () => {
    const state = opening();
    const ogre = state.creatures[OGRE]!;
    expect(ogre.creatureType, 'SRD: "Large Giant, Chaotic Evil"').toBe('Giant');
    expect(ogre.vitals.hpMax, 'SRD: "HP 68 (8d10 + 24)"').toBe(68);
    expect(armorClassOf(state, OGRE), 'SRD: "AC 11"').toBe(11);
  });

  /**
   * `resolveAttack` refuses a weapon its wielder does not own, and the first
   * live Tier 1 run recorded two goblins fighting a whole fight with their
   * fists because of it. The Ogre prints a Greatclub and Javelins and must be
   * holding both before anybody asks it to swing one.
   */
  it('is holding the Greatclub and the Javelin the block prints', () => {
    const held = carrying(opening(), OGRE).map((line) => line.id);
    expect(held).toContain('greatclub');
    expect(held).toContain('javelin');
  });

  it('starts outside its own reach and inside one stride', () => {
    const scene = opening().scene!;
    const apart = distanceBetween(scene, OGRE, FIGHTER);
    expect(apart.ok && apart.value, 'further than a 5-foot reach').toBe(10);
  });
});

describe('the harness is no longer three combatants and one player', () => {
  /**
   * The assumption that cost the most to leave in place. `beginCombat` wrote a
   * flat `speed: 30` for every combatant, which was true of everyone in the
   * tavern and is wrong for the first creature that is not a person — so an
   * Ogre would have been given a third of its stride back and every movement
   * measurement in Tier 2 would have been taken against a slower monster.
   */
  it('reads each combatant Speed off the creature', async () => {
    const outcome = await run();
    const order = outcome.finalState.combat!.order;
    const ogre = order.find((c) => c.id === OGRE)!;
    expect(speed(outcome.finalState.creatures[OGRE]!.sheet), 'SRD: "Speed 40 ft."').toBe(40);
    expect(ogre.speed, 'and the combat record says so too').toBe(40);
    for (const who of [FIGHTER, CLERIC, MAGE]) {
      expect(order.find((c) => c.id === who)!.speed, who).toBe(30);
    }
  });

  it('rolls initiative for four actors and runs four rounds of them', async () => {
    const outcome = await run();
    expect(outcome.finalState.combat!.order).toHaveLength(4);
    expect(outcome.analysis.rounds.map((r) => r.round)).toEqual([1, 2, 3, 4]);
    for (const round of outcome.analysis.rounds) expect(round.beats, `round ${round.round}`).toBe(4);
  });

  /**
   * One cursor per player, which is the bug a single shared index would have
   * been: with three scripted characters interleaved by initiative, a shared
   * index hands the Cleric the Fighter's words and every later line slides.
   * The check is that each character's *first* line is its own.
   */
  it('gives each scripted player its own script', () => {
    expect(encounter.intents.size).toBe(3);
    const firsts = [FIGHTER, CLERIC, MAGE].map((who) => encounter.intents.get(who)![0]!);
    expect(new Set(firsts).size, 'three different opening lines').toBe(3);
    expect(firsts[0]).toContain('greatsword');
    expect(firsts[1]).toContain('guiding bolt');
    expect(firsts[2]).toContain('Fire bolt');
    expect(encounter.intents.get(OGRE), 'the monster is the DM to run').toBeUndefined();
  });

  it('still replays byte-identically with four actors in the order', async () => {
    const outcome = await run();
    expect(outcome.determinism.transcriptReplays).toBe(true);
    expect(outcome.determinism.foldsIdentically).toBe(true);
    expect(outcome.determinism.seedIndependent).toBe(true);
    expect(outcome.determinism.survivesJson).toBe(true);
  });

  /**
   * A creature leaving the fight must end it, and "one side has nobody
   * standing" has to be asked of every side rather than of two named lists.
   * The tavern's two hard-coded checks would have compiled against Tier 2 and
   * simply never fired.
   */
  it('knows which sides are in the fight without being told any names', () => {
    expect(encounter.sides.flat().sort()).toEqual([FIGHTER, CLERIC, MAGE, OGRE].sort());
    expect(encounter.sides.map((s) => s.length)).toEqual([3, 1]);
  });

  it('describes the tavern with the same vocabulary', () => {
    const tavern = tavernEncounter('established', 'standard');
    expect(tavern.roster).toHaveLength(3);
    expect(tavern.intents.size, 'one scripted player, as it always was').toBe(1);
    expect(tavern.intents.get(WIZARD)).toHaveLength(4);
    expect(tavern.roster).toContain(asCharacterId('kessa'));
  });
});

describe('a per-turn bill that grows is told apart from one that does not', () => {
  it('calls a flat series flat and an accelerating one superlinear', () => {
    expect(growthOf([1000, 1010, 1020, 1030, 1040, 1050]).shape).toBe('flat');
    expect(growthOf([100, 200, 300, 400, 500, 600]).shape).toBe('linear');
    expect(growthOf([100, 150, 200, 400, 800, 1600]).shape).toBe('superlinear');
  });

  /**
   * Zero growth measured from zero data is not a finding. The offline stand-in
   * reports no tokens at all, and a report calling that "flat" would be the
   * apparatus answering the experiment's own question.
   */
  it('refuses to classify a run that reported no tokens', () => {
    expect(growthOf([0, 0, 0, 0, 0, 0]).shape).toBe('insufficient-data');
    expect(growthOf([500, 600]).shape).toBe('insufficient-data');
  });
});

describe('every call the model makes is answered, cap or no cap', () => {
  /**
   * The bug this pins killed Tier 2's first live run inside round one.
   *
   * `maxExchangesPerBeat` bounds a beat. When the loop hit that bound with a
   * batch still in hand, the batch was dropped — and an assistant message
   * carrying unanswered `tool_calls` makes every *later* request malformed, so
   * the provider rejected the next beat with an error naming a message thirty
   * turns back. Tier 1 never used all eight exchanges, which is why four
   * recorded runs went past it.
   *
   * A driver that never ends a turn is the only fixture that reaches it, and
   * the assertion is the invariant rather than the symptom: every id issued
   * came back.
   */
  const relentless = (): ModelDriver & { readonly issued: string[]; readonly answered: string[] } => {
    const issued: string[] = [];
    const answered: string[] = [];
    let n = 0;
    const turn = (): DriverTurn => {
      n += 1;
      const id = `call-${n}`;
      issued.push(id);
      return {
        // `look` so the fixture cannot end a turn by accident and the loop is
        // guaranteed to run to the cap.
        calls: [{ id, name: 'look', input: {} }],
        text: '',
        ms: 0,
        promptTokens: 100,
        completionTokens: 10,
        cachedTokens: 0,
        stopReason: 'tool_calls',
      };
    };
    return {
      name: 'relentless',
      issued,
      answered,
      async beat() {
        return turn();
      },
      async replies(replies, _state, resume) {
        for (const reply of replies) answered.push(reply.id);
        // What every real driver does: `resume: false` means the results are
        // being handed over for the record, not for another response. A fake
        // that answered anyway would issue a call nobody ever asked for and
        // then fail its own invariant.
        if (!resume) {
          return {
            calls: [],
            text: '',
            ms: 0,
            promptTokens: null,
            completionTokens: null,
            cachedTokens: null,
            stopReason: null,
          };
        }
        return turn();
      },
    };
  };

  it('delivers a result for every tool call, including the batch the cap cut off', async () => {
    const driver = relentless();
    await runExperiment(driver, { encounter, rounds: 1, maxExchangesPerBeat: 3 });
    expect(driver.issued.length).toBeGreaterThan(0);
    expect(driver.answered.sort()).toEqual([...driver.issued].sort());
  });
});
