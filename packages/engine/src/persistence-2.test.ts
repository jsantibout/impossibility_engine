import { SRD_CONTENT } from '@ie/content';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { applyEventWith, fold, type GameEvent, type GameState } from './events.js';
import { spellOn } from './fold/release.js';

/**
 * The second frozen log, and the half of the vocabulary the first one never
 * reached.
 *
 * `golden-log.json` is 93 events across 35 types and was written before most
 * of this engine existed. The whole-engine audit of 2026-09-13 (§3.5) counted
 * what that leaves unwatched: **56 of the 91 event types had no compatibility
 * fixture at all** — every event carrying state a fold reconstructs for the
 * five reaction windows, the interruptible casting, the ongoing record, a
 * moved area origin and the area-trigger debt queue. A schema change to any of
 * them passed the whole suite.
 *
 * So this is a *second* fixture rather than a better one. The first is never
 * regenerated and neither is this: both are logs the engine wrote on the day
 * and every later version has to keep folding them or say out loud why not.
 * `scripts/make-golden-log-2.ts` documents how this one was built and is not a
 * step in the build — re-running it to make this file pass turns a
 * compatibility test into a rubber stamp.
 *
 * **What it is a log of.** One campaign: four characters built from choices
 * and one of them levelling in play, a purse and a chain shirt put on and
 * taken off again, a fight of one that ends when its only combatant leaves,
 * then a long skirmish — Uncanny Dodge answering a held damage roll,
 * Indomitable answering a held saving throw, Retaliation answering damage
 * already dealt, a hit held between its two rolls, a Counterspell interrupting
 * a declared casting and a second declaration that settles, Grease and a Rogue
 * walking into it, a death save and a stabilisation — then a Short Rest, a
 * recovery, a Long Rest interrupted by something in the dark and one that runs
 * its course, and a second fight that is **saved mid-encounter** with a Web, a
 * Moonbeam swept along a stated route, four separate Concentrations, a
 * paralysis, two grants and a damage roll made and not applied.
 *
 * **It stops in the middle on purpose.** A log that ends tidily folds to an
 * empty derived state, and an empty derived state is the same under every
 * expiry rule there has ever been.
 */

const here = fileURLToPath(new URL('.', import.meta.url));

const read = (name: string): readonly GameEvent[] =>
  JSON.parse(readFileSync(`${here}../fixtures/${name}`, 'utf8')) as GameEvent[];

const GOLDEN_2: readonly GameEvent[] = read('golden-log-2.json');
const GOLDEN_1: readonly GameEvent[] = read('golden-log.json');

/** The seed the fixture was written under. */
const SEED = 'golden-2';

/** Round-trip through the shape Postgres would store and hand back. */
const throughJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

describe('the second stored log still folds', () => {
  it('folds at all', () => {
    expect(() => fold(SEED, GOLDEN_2, SRD_CONTENT)).not.toThrow();
  });

  it('is worth folding: it is a campaign, not a stub', () => {
    expect(GOLDEN_2.length).toBeGreaterThanOrEqual(400);
    expect(new Set(GOLDEN_2.map((e) => e.type)).size).toBeGreaterThanOrEqual(80);
  });

  /**
   * The authoritative facts, named one at a time rather than snapshotted as a
   * blob. A blob fails informatively only to whoever wrote it; these say which
   * rule moved.
   */
  it('folds to the state it has always folded to', () => {
    const state = fold(SEED, GOLDEN_2, SRD_CONTENT);

    // The clock: two fights, an hour of Short Rest and a night of Long Rest.
    expect(state.elapsed).toBe(40_374);
    expect(state.combat?.round).toBe(5);
    expect(state.combat?.turnsTaken).toBe(34);

    // The Initiative order the second fight is in, after a combatant left the
    // first one and Alert swapped two of them in it.
    expect(state.combat?.order.map((c) => c.id)).toEqual([
      'mira',
      'thorn',
      'thug',
      'bram',
      'nyx',
      'grim',
      'zel',
      'vex',
    ]);

    // Castings are sequential and their ids are load-bearing for every effect
    // linked to them, so the count is part of the contract.
    expect(state.castingsBegun).toBe(15);

    // Idempotency keys survive a reload, or a retry after a restart would be a
    // second casting.
    expect(Object.keys(state.appliedCommands)).toHaveLength(142);

    // The generator's own bookkeeping, which is what lets a *live* session
    // resume its sequence rather than start it again.
    expect(state.rollsIssued).toBe(38);
    expect(state.rng).not.toBeNull();

    // Hit points, through a halved blow, a held hit, an acid arrow, a beam, a
    // Second Wind and two rests.
    expect(state.creatures.nyx?.vitals.hp).toBe(36);
    expect(state.creatures.grim?.vitals.hp).toBe(82);
    expect(state.creatures.thug?.vitals.hp).toBe(72);

    // A creature dropped to 0, stabilised, and then killed by something that
    // was not hit-point loss.
    expect(state.creatures.rat?.vitals).toMatchObject({ hp: 0, dead: true });

    // Pools: spent, partly given back by a Short Rest, and wholly by a Long one.
    expect(state.creatures.bram?.resources.pools['fighter:indomitable']?.spent).toBe(1);
    expect(state.creatures.bram?.resources.pools['second-wind']?.spent).toBe(0);
    expect(state.creatures.zel?.resources.pools['sorcery-points']?.spent).toBe(0);
    expect(state.creatures.mira?.resources.pools['spell-slot:2']?.spent).toBe(1);

    // Rests are spans, and the moment each one earned is a fact the engine
    // keeps: Sorcerous Restoration reads the first, the sixteen-hour cooldown
    // reads the second.
    expect(state.creatures.bram?.lastShortRestAt).toBe(3750);
    expect(state.creatures.mira?.lastLongRestAt).toBe(40_350);

    // Owning is not wearing: the shirt was bought, put on, and taken off, and
    // one of the two coils of rope was taken away by the DM.
    expect(state.creatures.mira?.inventory.map((i) => i.id).sort()).toEqual([
      'chain-shirt',
      'mace',
      'rope',
    ]);
    expect(state.creatures.mira?.equipped.map((held) => held.id)).toEqual([]);
    expect(state.creatures.mira?.sheet.armor).toBeNull();
    expect(state.creatures.thug?.equipped.map((held) => held.id)).toEqual(['longsword']);

    // Exhaustion is a flat penalty per level and is nowhere near the sixth.
    expect(state.creatures.grim?.conditions.exhaustion).toBe(2);
  });

  /**
   * The reaction windows, which are the reason this fixture exists. The log is
   * put away with one open: the damage is rolled, typed, attributed to its
   * dealer, and not applied.
   */
  it('folds a damage window that is still open', () => {
    const pending = fold(SEED, GOLDEN_2, SRD_CONTENT).pendingDamage;

    expect(pending).not.toBeNull();
    expect(pending?.target).toBe('nyx');
    expect(pending?.by).toBe('thug');
    expect(pending?.fromAttack).toBe(true);
    expect(pending?.reductions).toEqual([]);
    // An offer is a (reactor, feature) pair, never a reactor.
    expect(pending?.offers.map((o) => [o.reactor, o.feature])).toEqual([
      ['nyx', 'rogue:uncanny-dodge'],
    ]);
    // Damage is typed components with a roll under each, not a number.
    const components = pending?.components ?? [];
    expect(components).toHaveLength(1);
    expect(components[0]?.type).toBe('slashing');
    expect(components[0]?.total).toBe(4);
    // And the roll was one the engine issued, which is where the inviolable
    // rule actually lives: provenance, not purity.
    expect(components[0]?.roll?.provenance.source).toBe('engine');

    // And the other windows are shut, which is the half that says the reducer
    // closed them rather than never having opened them.
    const state = fold(SEED, GOLDEN_2, SRD_CONTENT);
    expect(state.pendingTest).toBeNull();
    expect(state.pendingAttack).toBeNull();
    expect(state.pendingCastings).toEqual({});
    expect(state.pendingMove).toBeNull();
  });

  /**
   * The derived passes, which are the half a later engine version can move
   * without anybody noticing.
   */
  it('folds the derived rules to what they have always derived', () => {
    const state = fold(SEED, GOLDEN_2, SRD_CONTENT);

    // Four separate Concentrations, held by four different casters — which
    // is what a casting id is for.
    expect(state.creatures.mira?.concentration?.spell).toBe('Web');
    expect(state.creatures.thorn?.concentration?.spell).toBe('Moonbeam');
    expect(state.creatures.vex?.concentration?.spell).toBe('Hold Person');
    expect(state.creatures.zel?.concentration?.spell).toBe('Blur');

    // What each casting left behind, by casting id. An area holds a point; a
    // spell on a creature holds the creature; the level is why the record
    // exists at all, because Dispel Magic reads it.
    //
    // **Who each casting is on is `spellOn`'s answer**, not a field — and the
    // five answers below are byte for byte the ones this engine gave when it
    // was a field, which is what "an older shape still folds to the same
    // state" has to mean once the shape stops being stored whole.
    expect(
      Object.fromEntries(
        Object.entries(state.ongoing).map(([id, o]) => [
          id,
          [o.spellId, o.level, [...spellOn(state, o)]],
        ]),
      ),
    ).toEqual({
      'cast:11': ['web', 2, ['nyx', 'thug']],
      'cast:12': ['moonbeam', 2, []],
      'cast:13': ['blur', 2, ['zel']],
      'cast:14': ['mage-armor', 1, ['zel']],
      'cast:15': ['hold-person', 2, ['grim']],
    });

    // The Moonbeam's point is where the stated route left it, three five-foot
    // legs west of where it was conjured; the Web has not moved.
    expect(state.ongoing['cast:12']?.origin).toEqual({ x: 275, y: 300, z: 0 });
    expect(state.ongoing['cast:11']?.origin).toEqual({ x: 260, y: 300, z: 0 });

    /**
     * **And the ongoing records were written in an older shape.** This log
     * predates `OngoingSpell` pinning a casting's area and its clauses,
     * predates `concentration` and `route` being dropped from it, and predates
     * the field it stores being the half of "on" the world cannot answer.
     * Absent means what it always meant: the area is filled from the catalogue
     * **once**, as it was read from the catalogue on every fold before; the
     * two dead fields do not ride into live state as data nothing can explain;
     * and the stored subset is computed as the record is folded.
     *
     * This is what makes the rest of this test possible at all — the Web and
     * the Moonbeam above only catch anybody because their areas came back.
     *
     * **What is held is always the current shape**, whatever the log said.
     * `upgradeOngoing` is the only door into `state.ongoing`, so a record in
     * there is version 3 and carries `aimed`; the version on the *event* is
     * what the log wrote, and this one wrote none at all.
     */
    expect(state.ongoing['cast:11']?.version).toBe(3);
    // Every one of the five stores nobody: each hung something on everyone it
    // caught, so the whole of what these records say is derived at every read.
    expect(Object.values(state.ongoing).map((o) => o.aimed)).toEqual([[], [], [], [], []]);
    expect(state.ongoing['cast:11']?.area).toEqual({ kind: 'cube', size: 20, origin: 'point' });
    expect(state.ongoing['cast:11']?.areaTrigger?.at).toBe('start-of-turn');
    expect(state.ongoing['cast:11']).not.toHaveProperty('route');
    expect(state.ongoing['cast:11']).not.toHaveProperty('concentration');
    // A spell with no area keeps none, rather than acquiring an empty one.
    expect(state.ongoing['cast:13']?.area).toBeUndefined();

    // Conditions remember why: the paralysis and the two Restrained all carry
    // the casting that caused them.
    expect(state.creatures.grim?.conditions.conditions).toEqual(['incapacitated', 'paralyzed']);
    expect(state.creatures.nyx?.conditions.conditions).toEqual(['restrained']);
    expect(state.creatures.thug?.conditions.conditions).toEqual(['restrained']);
    // Grease's Prone outlives its casting, which is why the rat still has it.
    expect(state.creatures.rat?.conditions.conditions).toEqual(['prone']);

    // A spell that sets an Armour Class, and one that modifies a roll: both
    // keyed by the casting, both released through the same door a dispel uses.
    expect(state.creatures.zel?.armorClasses.map((a) => a.source)).toEqual(['Mage Armor#cast:14']);
    expect(state.creatures.zel?.rollModifiers?.map((r) => r.source)).toEqual(['Blur#cast:13']);

    // Eight deadlines still waiting: five castings and three condition
    // instances. Expiry is derived, so a change to when any of them fires
    // changes this list without changing a single event.
    expect(Object.keys(state.timers).sort()).toEqual([
      'casting|cast:11',
      'casting|cast:12',
      'casting|cast:13',
      'casting|cast:14',
      'casting|cast:15',
      'condition|grim|paralyzed:Hold Person#cast:15',
      'condition|nyx|restrained:Web#cast:11',
      'condition|thug|restrained:Web#cast:11',
    ]);

    // The paralysis repeats its save at the end of each of the target's turns,
    // and the hook lives on the timer rather than in the caller's head.
    expect(state.timers['condition|grim|paralyzed:Hold Person#cast:15']?.repeatSave).toMatchObject({
      ability: 'wis',
      onSuccess: 'end-on-target',
    });
    // The Web offers a check rather than a repeat save, because tearing free
    // is an opportunity and a repeat save is an obligation.
    expect(state.timers['condition|thug|restrained:Web#cast:11']?.check).not.toBeUndefined();

    // Nothing is owed: every area effect the fight raised was settled where it
    // was raised, which is what the global debt guard insists on.
    expect(Object.keys(state.pendingSaves)).toHaveLength(0);
    expect(state.owedAreaEffects).toHaveLength(0);
  });

  /**
   * A declared move written in the older shape, folded mid-flight.
   *
   * `PendingMove` used to carry the distance and nothing ever read it: the
   * Speed is spent at declaration and completing the move re-resolves the
   * *placement* rather than re-measuring. Both frozen logs still carry the
   * number, so the reducer builds the pending record from the fields this
   * engine knows rather than storing the event's object whole — otherwise a
   * field the type no longer declares would sit in live state for the life of
   * the move, which is the same data-nothing-can-explain that `upgradeOngoing`
   * keeps out of an ongoing record.
   *
   * The whole log completes that move, so only a prefix can see it.
   */
  it('folds an older declared move without the field it dropped', () => {
    const at = GOLDEN_2.findIndex((event) => event.type === 'movement-declared');
    expect(at).toBeGreaterThan(0);
    // The fixture really does carry it, or this test proves nothing.
    const declared = GOLDEN_2[at] as unknown as { readonly move: Record<string, unknown> };
    expect(declared.move).toHaveProperty('feet');

    const pending = fold(SEED, GOLDEN_2.slice(0, at + 1), SRD_CONTENT).pendingMove;
    expect(pending?.mover).toBe('thug');
    expect(pending).not.toHaveProperty('feet');
  });

  it('folds the same way twice', () => {
    expect(fold(SEED, GOLDEN_2, SRD_CONTENT)).toStrictEqual(fold(SEED, GOLDEN_2, SRD_CONTENT));
  });

  /**
   * The seed is recorded so a *live* session resumes its generator, never so a
   * replay can roll again — every outcome is already written down.
   */
  it('folds the same way under a different seed', () => {
    expect(fold('somebody-elses-seed', GOLDEN_2, SRD_CONTENT)).toStrictEqual({
      ...fold(SEED, GOLDEN_2, SRD_CONTENT),
      seed: 'somebody-elses-seed',
    });
  });
});

describe('the second log survives the database', () => {
  it('folds identically after a round trip through JSON', () => {
    expect(fold(SEED, throughJson(GOLDEN_2), SRD_CONTENT)).toStrictEqual(fold(SEED, GOLDEN_2, SRD_CONTENT));
  });

  it('produces a state that is itself JSON, exactly', () => {
    const state: GameState = fold(SEED, GOLDEN_2, SRD_CONTENT);
    expect(throughJson(state)).toStrictEqual(state);
  });

  /**
   * And at every prefix, so a partially-written log is not a special case.
   *
   * **The same property at the same 552 points, in one pass.** `fold` is
   * `events.reduce(applyEvent, …)` and `applyEvent` is a pure function of the
   * state and the event it is given, so folding every prefix from scratch
   * computes the same 552 pairs of states as carrying two accumulators
   * forward — and the second does it in 1,102 event applications where the
   * first did it in about 150,000. Round-tripping each event is the same
   * operation as round-tripping the prefix it ends, because a JSON round trip
   * of a list is the list of its round-tripped members.
   *
   * It used to carry a 30-second timeout, given after it failed
   * intermittently: it was 5 seconds of the suite's file time on its own and
   * was measured at 2.2 seconds inside a full parallel run, against Vitest's
   * default five. A compatibility test that goes red without saying anything
   * about compatibility teaches everyone to re-run it — so the quadratic was
   * the thing to remove rather than the clock to loosen, and the timeout went
   * with it. **Both accumulators are compared after every event**, so the
   * first prefix at which a divergence appears is still the one that fails.
   */
  it('round-trips at every prefix of the log', () => {
    let plain = fold(SEED, [], SRD_CONTENT);
    let stored = fold(SEED, [], SRD_CONTENT);
    expect(stored).toStrictEqual(plain);

    const step = applyEventWith(SRD_CONTENT);
    for (const event of GOLDEN_2) {
      plain = step(plain, event);
      stored = step(stored, throughJson(event));
      expect(stored).toStrictEqual(plain);
    }
  });
});

/**
 * Every event type the reducer declares, read out of the union it is declared
 * in — the same reading `persistence.test.ts` does, repeated here rather than
 * imported, because a test that depends on another test file's private helper
 * is a test that breaks when that file is tidied.
 */
function declaredEventTypes(): readonly string[] {
  const source = readFileSync(`${here}events.ts`, 'utf8');
  const found = [...source.matchAll(/readonly type: '([a-z-]+)'/g)].map((m) => m[1]!);
  return [...new Set(found)].sort();
}

/**
 * The types no frozen log exercises, named rather than counted.
 *
 * Every other type the reducer declares is folded by one of the two fixtures,
 * so a schema change to it has something to break. **This list is a ledger,
 * not a budget** — an entry is a deliberate act saying which type a frozen log
 * does not cover and why, and the floor below is what stops it growing
 * quietly.
 *
 * `damage-defense-granted` is here because **both logs are frozen and neither
 * can be regenerated.** They were written before a spell could grant a
 * Resistance, so there is no casting in either that would emit one, and adding
 * it would mean rewriting a fixture whose whole value is that nobody rewrites
 * it. `granted-defenses.test.ts` folds the event directly and drives it end to
 * end through Stoneskin; what is missing is a *compatibility* fixture, which
 * the next frozen log is where it belongs.
 *
 * `speed-modifier-granted` is here for the same reason and by the same
 * construction: it arrived after both logs were frozen, so no casting in
 * either could have emitted one. `speed-grants.test.ts` folds it directly and
 * drives it end to end through Longstrider, Ray of Frost and Hypnotic Pattern.
 * **A new event type is uncovered by construction until the next frozen log is
 * written**, and a named entry saying which and why is the honest record.
 *
 * `attack-rider-granted` is the third, arriving by the same construction:
 * neither log was written when a spell could hang extra damage on a creature's
 * later attacks, so no casting in either emits one.
 * `attack-riders.test.ts` folds it and drives it end to end through Divine
 * Favor and Hunter's Mark — a weapon attack, a spell attack, a Critical Hit,
 * and every door the grant is ended by.
 *
 * `casting-continued` is the fourth, and by the same construction again:
 * neither log was written when a casting of a minute or more could be begun in
 * combat at all — it was refused outright — so no turn in either could carry
 * the Magic action SRD's "Longer Casting Times" asks for.
 * `long-casting.test.ts` folds it through twenty turns of a real fight, and
 * `keyed-pending-castings.test.ts` drives it beside a Shield held open on
 * somebody else's turn.
 *
 * `combatant-joined` is the fifth, and by the same construction once more:
 * neither log was written when a creature could take a place in a fight
 * already under way — there was no command that added one, which is the hole
 * IE-055 closed — so every combatant in both is one the fight began with.
 * `joining-combat.test.ts` folds it through a whole round before the insertion
 * and a whole round after, on both sides of the creature currently acting, and
 * `turn-context.test.ts` drives it end to end as the repair for a
 * turn-anchored duration whose anchor was not in the fight.
 *
 * `condition-immunity-granted` is the sixth, and by the same construction once
 * again: neither log was written when a spell could make a creature immune
 * to a condition — the seventh sourced grant did not exist and Mind Blank had
 * no definition — so no casting in either emits one.
 * `granted-condition-immunity.test.ts` folds it and drives it end to end
 * through Mind Blank: the refusal, a Charm Person that finds nothing to charm,
 * the union with a Zombie's printed entries, and all three doors the grant ends
 * by.
 *
 * `turn-payout-granted` is the seventh, and by the same construction a last
 * time: neither log was written when a casting could hand a creature anything
 * at a turn boundary — the eighth sourced grant did not exist and Heroism had
 * no definition — so no casting in either emits one.
 * `turn-payouts.test.ts` folds it and drives it end to end: Temporary Hit
 * Points at the start of a recipient's turn, damage at the end of one, the
 * boundary that pays nothing because it is the other moment, and Heroism's two
 * halves ending together on a broken Concentration.
 *
 * `attuned` and `attunement-ended` are the eighth and ninth, and by the same
 * construction: neither log was written when an item could be attuned to at
 * all — no item carried a grant, no creature had an `attuned` list, and both
 * fixtures fold to exactly the states they always folded to with an empty one.
 * `attunement.test.ts` folds both and drives them end to end through an SRD
 * item: worn and not attuned, attuned, stowed while attuned, given up, and the
 * two endings nobody commands.
 *
 * `item-transferred` is the tenth, and by the same construction: neither log
 * was written when anything could change hands — there was no command for it
 * and no event to write, so every item in both belongs to whoever started
 * with it. `item-transfer.test.ts` folds it and drives it end to end: a spent
 * wand arriving as spent as it left, its pool record moving whole, the
 * refusal for what is in hand, the attunement the derived pass ends, and the
 * four ways a hand-written one contradicts the log.
 *
 * `action-rule-granted` is the eleventh, and by the same construction: neither
 * log was written when a spell could reach the action economy at all — no
 * creature had an `actionRules` list and no definition could ask for one — and
 * both fixtures fold to exactly the states they always folded to with an empty
 * one. `action-rules.test.ts` drives it end to end on homebrew: forbidden,
 * narrowed, widened, refused with a reason, lifted at a rider's own deadline,
 * and ended by the casting and by a broken Concentration.
 */
const UNCOVERED_EVENT_TYPES: readonly string[] = [
  'action-rule-granted',
  'attack-rider-granted',
  'attuned',
  'attunement-ended',
  // A condition's benefits withheld from a creature that still has it.
  // Neither log was written when anything could say so: no creature had a
  // `deniedBenefits` list, and the three SRD spells that print the clause
  // carried it as fiction. Both fixtures fold to exactly the states they
  // always folded to with that list empty on every creature.
  // `denied-benefits.test.ts` folds it and drives it end to end: the three
  // readers that hand Invisible its benefits before and after the hit, the
  // condition still standing on the creature underneath, and the benefit
  // handed back at the rider's own deadline.
  'benefit-denied',
  'casting-continued',
  'combatant-joined',
  'condition-immunity-granted',
  // How many heads a creature has. Neither log was written when anybody could
  // say — an Attack action held whatever the sheet said and nothing else —
  // and both fixtures fold to exactly the states they always folded to with
  // the field `null` on every creature. `creature-heads.test.ts` folds it and
  // drives it end to end: the assumption reported while nobody has said, the
  // swings a declared count holds, the re-declaration that replaces it, and
  // the count the fold gives back with no content open.
  'creature-heads-declared',
  // A summons: the fixtures predate it, and appending a type here is the
  // acknowledgement this list exists to collect.
  'creature-summoned',
  'damage-defense-granted',
  // The faces a damage roll showed. Neither log was written when the ordinary
  // damage path recorded them at all — a blow nobody could react to kept its
  // post-defence total and nothing else — and both fixtures fold to exactly
  // the states they always folded to without it, because the seam that owns it
  // writes no state. `damage-dice-in-the-log.test.ts` folds it and drives it
  // end to end: a greatsword, a Fire Bolt, a DM's improvised dice, a Critical
  // Hit's doubled dice, a Resistance halving the total the faces made, and the
  // held path that reports the same faces on `damage-rolled` instead.
  'damage-dice-recorded',
  // A patch of Difficult Terrain the table declared: neither log was written
  // when the ground could cost anything but a foot per foot — the scene held
  // no terrain at all — and both fixtures fold to exactly the states they
  // always folded to with an empty one. `difficult-terrain.test.ts` folds it
  // and drives it end to end: a budget reaching half as far, a patch entered
  // and left mid-move, two that overlap, a refusal that names what slowed the
  // walker, and a patch that stops charging when its casting stops running.
  'difficult-terrain-declared',
  // A fall somebody declared. Neither log could carry one: nothing in the
  // engine could say a creature was falling until the window SRD Feather Fall
  // answers needed a fact to read, and both fixtures fold to the states they
  // always folded to with the field `null` on every creature.
  // `falling.test.ts` folds it and drives it end to end — the window open in
  // the turn of the declaration, shut by the next turn and by the clock, the
  // opportunity appearing and disappearing on the same rule, and the spell
  // cast through the public API.
  'fall-declared',
  // The two halves of a rule about hit points that a running effect states —
  // one standing in front of healing, one holding a maximum up. Neither log
  // was written when a spell could do either: no creature had a `healingRules`
  // or a `hitPointMaxima` list, healing was arithmetic nothing could refuse,
  // and a maximum moved only at creation and on a level-up. Both fixtures fold
  // to exactly the states they always folded to with both lists empty and
  // `hpMaxAdjustment` at zero on every creature.
  // `healing-and-hit-point-maxima.test.ts` folds both and drives them end to
  // end: a Cure Wounds maximised by a Beacon of Hope, a Chill Touch that makes
  // the next one restore nothing and gives the hit points back at its own
  // deadline, an Aid that carries the current total up with the maximum and
  // clamps it on the way down, and a level-up taken mid-Aid that is worth the
  // whole of its level.
  'healing-rule-granted',
  'hit-point-maximum-adjusted',
  'item-transferred',
  // A line a stat block prints a recharge on, spent and got back. Neither log
  // was written when the notation reached the engine at all — it was a field
  // on a parsed attack that nothing rolled a die for — and both fixtures fold
  // to exactly the states they always folded to with an empty `expendedLines`
  // on every creature. `recharge.test.ts` folds both events and drives them
  // end to end: the line used and refused a second time, the turn-start d6
  // that brings it back and the one that does not, all three printed
  // thresholds, the rest that returns it, and the Clay Golem's gate reading a
  // line that is now spendable and rechargeable at once.
  'printed-line-expended',
  'printed-line-recharged',
  // A Reaction one creature put in another's hands, and the use that spends
  // it. Neither log was written when a creature could hold anything of
  // somebody else's — no creature had a `grantedReactions` list and the Bard's
  // own feature could only be spent on the Bard — and both fixtures fold to
  // exactly the states they always folded to with an empty one.
  // `granted-reactions.test.ts` folds both and drives them end to end: the
  // conferral, the die pinned at the giver's level, the replace-not-stack rule
  // two Bards make visible, the failed test it turns, the use that expends it
  // and the hour that ends one nobody used.
  'reaction-grant-consumed',
  'reaction-granted',
  // A pool's recovery rewritten by a later feature. Neither log was written
  // when a recovery could move at all — the tag was pinned when the pool was
  // declared and nothing but a re-declaration could have touched it, which
  // neither log does — so both fixtures fold to exactly the states they always
  // folded to, and the fixtures are read for the type by name in
  // `pool-recovery-rewrite.test.ts`. That file folds the event and drives it:
  // the tag moved with the maximum and the spent uses untouched, the Short
  // Rest that then answers for it, the Long Rest that still does, and the
  // refusal on a key the creature has no pool for. `font-of-inspiration.test.ts`
  // takes it through the catalogue, on both paths into the level that grants it.
  'resource-pool-recovery-changed',
  // A grant a roll used up. No frozen log carries a one-shot modifier — the
  // mechanic postdates both of them by a long way — so neither could carry the
  // event that spends one. `one-shot-modifiers.test.ts` folds it and drives it
  // end to end: SRD Guiding Bolt and Vicious Mockery from both ends of the
  // relation, a roll that cancellation brought back to normal spending it
  // anyway, and the deadline that ends one nobody spent.
  'roll-modifier-consumed',
  'speed-modifier-granted',
  // A line a stat block prints under **Actions** that the parser read nothing
  // out of, taken. Neither log was written when those lines reached a sheet as
  // anything but names, and nothing could spend one — so both fixtures fold to
  // exactly the states they always folded to with the field absent on every
  // creature. `monster-actions.test.ts` folds it and drives it end to end: the
  // Action spent, the sentence handed back verbatim because the engine applies
  // none of it, a second line in one turn refused by the economy, and
  // `recharge.test.ts` takes the seventy-one recharges printed on these lines
  // through expending, refusal, a turn-start die and a rest.
  'stated-action-taken',
  // A line a stat block prints under Bonus Actions, taken. Neither log was
  // written when the section reached a creature's sheet at all — `StatedValues`
  // carried the printed attacks and nothing else the block could do — and both
  // fixtures fold to exactly the states they always folded to with the field
  // absent on every creature. `monster-actions.test.ts` folds it and drives it
  // end to end: the Bonus Action spent, the ledger that says which line, the
  // second line in one turn refused, the sentence handed back because the
  // engine applies none of it, and the Multiattack branch a golem's block
  // gates on having taken one.
  'stated-bonus-action-taken',
  // Room a feature bought in a turn's own budget. Neither log was written
  // when a turn could hold more than one action or an attack outside an
  // Attack action — the budget had no field for either — and both fixtures
  // fold to exactly the states they always folded to with the extras empty.
  // `turn-budget-grants.test.ts` folds it and drives it end to end: a second
  // action taken and a third refused, the use spent from its own pool, the
  // budget back to one next turn, and a log holding the extra action replayed
  // byte for byte.
  'turn-budget-granted',
  'turn-payout-granted',
  // The Attack action spent on an Unarmed Strike that threw no attack roll —
  // the Grapple and Shove options. Neither log was written when either option
  // existed at all: the engine modelled only the Damage one, so every attack
  // in both fixtures is an `attack-made` and both fold to exactly the states
  // they always folded to. `unarmed.test.ts` folds it and drives it end to
  // end: the save against the striker's own DC, the Grappled condition and the
  // escape DC pinned beside it, the Prone and the five-foot push, the size
  // rule, and the Hide that stands because no attack roll was made.
  'unarmed-strike-made',
  // What a casting did to one weapon. Neither log was written when a spell
  // could reach an object at all: no creature had a `weaponRiders` list, no
  // casting could name a weapon, and Shillelagh and Magic Weapon were both
  // tracked definitions that resolved nothing. Both fixtures fold to exactly
  // the states they always folded to with that list empty on every creature.
  // `weapon-rider.test.ts` folds it and drives it end to end: the substituted
  // ability, the replaced die and its band table, the plus on both rolls and
  // its band table, every other weapon in the pack left alone, and the grant
  // ending on the deadline, on a recast and through the dispel door.
  'weapon-rider-granted',
];

/** What the pair must cover between them, whatever else changes. */
const COVERAGE_FLOOR = 80;

describe('the frozen logs cover the event vocabulary between them', () => {
  const used = (log: readonly GameEvent[]): ReadonlySet<string> =>
    new Set(log.map((e) => e.type));

  it('leaves nothing uncovered but what it names', () => {
    const covered = new Set([...used(GOLDEN_1), ...used(GOLDEN_2)]);
    const uncovered = declaredEventTypes().filter((t) => !covered.has(t));
    expect(uncovered).toEqual([...UNCOVERED_EVENT_TYPES]);
  });

  it('covers at least the floor the pair was frozen to meet', () => {
    const declared = declaredEventTypes();
    const covered = new Set([...used(GOLDEN_1), ...used(GOLDEN_2)]);
    expect(declared.filter((t) => covered.has(t)).length).toBeGreaterThanOrEqual(COVERAGE_FLOOR);
  });

  /**
   * And the second fixture earns its place: it is not a re-run of the first.
   *
   * Without this, a future edit could quietly narrow it to the 35 types the
   * first one already had and both tests above would still pass.
   */
  it('is not a second copy of the first', () => {
    const fresh = [...used(GOLDEN_2)].filter((t) => !used(GOLDEN_1).has(t));
    expect(fresh.length).toBeGreaterThanOrEqual(50);
  });

  /**
   * The first fixture is still the authority for what it covers, and three
   * types live only there — a Concentration ended by command, and the two
   * halves of a readied action. Naming them is what stops somebody deciding
   * the second fixture has made the first redundant.
   */
  it('still needs the first fixture', () => {
    const only = [...used(GOLDEN_1)].filter((t) => !used(GOLDEN_2).has(t)).sort();
    expect(only).toEqual(['concentration-ended', 'readied-declared', 'readied-released']);
  });

  it('uses no type the reducer has never declared', () => {
    const declared = declaredEventTypes();
    expect([...used(GOLDEN_2)].filter((t) => !declared.includes(t)).sort()).toEqual([]);
  });
});
