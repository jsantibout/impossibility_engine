import { SRD_CONTENT } from '@ie/content';
import { describe, expect, it } from 'vitest';
import {
  asCharacterId,
  type CharacterId,
  contextRequestsOf,
  isErr,
  ok,
  expect as unwrap,
  type Result,
} from '@ie/shared';
import {
  addCreature,
  addSceneLandmark,
  beginCombat,
  declareCreatureSide,
  forcePrintedSave,
  placeCreatureInScene,
  rollImprovisedDamage,
  setScene,
  takeStatedAction,
} from './commands.js';
import { createRng, restoreRng, type Rng } from './dice.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { adaptMonster, statedActionOf } from './monster.js';
import { createRollIssuer } from './rolls.js';
import { createCharacter, planCharacter, type CharacterChoices } from './creation.js';

/**
 * The save a printed line forces, executed rather than handed to the DM.
 *
 * A third of the SRD's bestiary prints one — `_Dexterity Saving Throw:_ DC 12,
 * each creature in a 15-foot Cone. _Failure:_ 17 (5d6) Fire damage. _Success:_
 * Half damage.` — and until this the whole sentence was quoted back to
 * whoever was running the table. The DC and the dice are numbers the book
 * prints, which makes them the Engine's to supply, exactly as a printed
 * Armour Class is.
 *
 * **What stays the table's is who the line catches.** "Each creature in a
 * 15-foot Cone" needs an origin and a facing nobody has declared, so the
 * clause comes back verbatim and the caller names the creatures. That is the
 * DM's door doing what it is for: a head count the rules leave open. The
 * caller still never states a die face, a DC or an amount of damage.
 *
 * **Both doors stay open.** `takeStatedAction` spends the Action and hands
 * the sentence over, for every line including this one; this spends the
 * Action and rolls. A caller that wants the engine to adjudicate asks for it.
 */

const id = (s: string) => asCharacterId(s);
const BREN = id('bren');
const NYX = id('nyx');
const WINTER = id('winter');
const SATYR = id('satyr');
const WOLF = id('wolf');

const supply = (seed: string) => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

const statBlock = (slug: string) => {
  const found = SRD_CONTENT.monsterById(slug);
  if (found === null) throw new Error(`no such monster: ${slug}`);
  return found;
};

/** The Winter Wolf's breath, by the heading its own block prints it under. */
const COLD_BREATH = statBlock('winter-wolf').actions[1]!.name;
/** The Satyr's Mockery, which offers a success nothing at all. */
const MOCKERY = 'Mockery';

const common = {
  speciesId: 'human',
  backgroundId: 'sage',
  languages: ['Dwarvish', 'Orc'],
  alignment: 'Neutral',
  spellbook: [],
  backgroundEquipment: 'A' as const,
  classEquipment: 'A' as const,
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
    'human:versatile': { featId: 'alert' },
  },
};

const walkOn = (name: string): CharacterChoices => ({
  ...common,
  name,
  classId: 'fighter',
  level: 1,
  abilities: {
    method: 'standard-array',
    assignment: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 },
  },
  abilityIncreases: { con: 2, wis: 1 },
  classSkills: ['athletics', 'survival'],
  equipped: ['chain-mail'],
  featureChoices: { 'human:skillful': ['perception'], 'fighter:weapon-mastery': [] },
  feats: { ...common.feats, 'fighter:fighting-style': { featId: 'archery' } },
});

/** SRD Evasion, on the class that prints it at level 7. */
const rogue = (name: string): CharacterChoices => ({
  ...common,
  name,
  classId: 'rogue',
  level: 7,
  abilities: {
    method: 'standard-array',
    assignment: { str: 8, dex: 15, con: 13, int: 14, wis: 12, cha: 10 },
  },
  abilityIncreases: { con: 2, int: 1 },
  classSkills: ['stealth', 'sleight-of-hand', 'acrobatics', 'investigation'],
  subclassId: 'thief',
  equipped: [],
  featureChoices: {
    'human:skillful': ['perception'],
    'rogue:expertise': ['stealth', 'sleight-of-hand'],
    'rogue:second-expertise': ['acrobatics', 'investigation'],
  },
  feats: { ...common.feats, 'rogue:ability-score-improvement': { featId: 'savage-attacker' } },
});

class Table {
  private readonly log: GameEvent[] = [];

  get state(): GameState {
    return fold('fangs', this.log);
  }

  get events(): readonly GameEvent[] {
    return this.log;
  }

  do(step: string, produce: (state: GameState) => Result<readonly GameEvent[]>): GameState {
    this.log.push(...unwrap(produce(this.state), step));
    return this.state;
  }

  did(
    step: string,
    produce: (state: GameState) => Result<{ readonly events: readonly GameEvent[] }>,
  ): GameState {
    this.log.push(...unwrap(produce(this.state), step).events);
    return this.state;
  }
}

/** A monster that breathes, and one or two people standing in front of it. */
const inTheWoods = (monster: string, who: CharacterId, alsoRogue = false): Table => {
  const table = new Table();
  table.do('the fighter arrives', () => createCharacter(SRD_CONTENT, walkOn('Bren'), BREN));
  if (alsoRogue) {
    table.do('the rogue arrives', () => createCharacter(SRD_CONTENT, rogue('Nyx'), NYX));
  }
  table.did('the monster arrives', (s) => addCreature(s, SRD_CONTENT, who, monster));
  table.do('the clearing', (s) => setScene(s, { width: 60, depth: 40, height: 20 }));
  table.do('the stump', (s) => addSceneLandmark(s, 'the stump', { x: 20, y: 20, z: 0 }));
  table.do('Bren by the stump', (s) =>
    placeCreatureInScene(s, BREN, { from: { landmark: 'the stump' }, feet: 0 }),
  );
  if (alsoRogue) {
    table.do('Nyx beside him', (s) =>
      placeCreatureInScene(s, NYX, { from: { creature: BREN }, feet: 5, bearing: 180 }),
    );
    table.do('Nyx’s side', (s) => declareCreatureSide(s, NYX, 'party'));
  }
  table.do('the monster beside him', (s) =>
    placeCreatureInScene(s, who, { from: { creature: BREN }, feet: 5, bearing: 90 }),
  );
  table.do('Bren’s side', (s) => declareCreatureSide(s, BREN, 'party'));
  table.do('the monster’s side', (s) => declareCreatureSide(s, who, 'wild'));
  table.do('the order', (s) =>
    beginCombat(s, [
      { id: who, initiative: 20, speed: 40 },
      { id: BREN, initiative: 1, speed: 30 },
      ...(alsoRogue ? [{ id: NYX, initiative: 2, speed: 30 }] : []),
    ]),
  );
  return table;
};

/**
 * The faces one damage roll threw, and what the component came to.
 *
 * `damage-dice-recorded` carries both, and the pair is what lets a test assert
 * the *rule* — "the halved damage is equal to half the damage that would be
 * dealt on a failed save" — without asserting a number the engine rolled.
 */
const dieFaces = (events: readonly GameEvent[], target: CharacterId) => {
  const recorded = events.find(
    (event) => event.type === 'damage-dice-recorded' && event.target === target,
  );
  if (recorded?.type !== 'damage-dice-recorded') return null;
  const component = recorded.components[0]!;
  return {
    // `value` rather than `rolled`, because a substituted die counts as what
    // it counts as — Great Weapon Fighting's 3 for a 1.
    raw: component.dice.reduce((sum, die) => sum + die.value, 0) + component.flat,
    total: component.total,
    type: component.type,
  };
};

describe('the block carries the save onto the sheet', () => {
  it('reads the Winter Wolf’s breath as a DC, an ability and dice', () => {
    const wolf = adaptMonster(statBlock('winter-wolf'), WINTER);
    expect(statedActionOf(wolf.sheet, COLD_BREATH)?.save).toEqual({
      ability: 'con',
      dc: 12,
      targets: 'each creature in a 15-foot Cone',
      damage: { dice: '4d8', flat: 0, type: 'cold', average: 18 },
      onSuccess: 'half',
    });
  });

  it('leaves a line whose sentence is not the template without one', () => {
    // SRD Harpy's Luring Song *does* force a save, and says four more things
    // about it — a Concentration, a repeat, a movement, a 24-hour immunity.
    // It is under Actions, it reached `unreadActions`, and it carries none of
    // this: a line asserted on the block that prints no unread Action at all
    // would pass however wide the reader became.
    const harpy = adaptMonster(statBlock('harpy'), id('harpy'));
    const song = statedActionOf(harpy.sheet, 'Luring Song');
    expect(song?.text).toContain('Saving Throw:_');
    expect(song?.save).toBeUndefined();

    // And SRD Wolf, which forces no save at all, reaches the sheet with no
    // unread Actions to carry one on.
    const plain = adaptMonster(statBlock('wolf'), WOLF);
    expect(plain.sheet.stated?.unreadActions).toBeUndefined();
  });
});

describe('a printed save, forced', () => {
  it('spends the Action, rolls the save and lands the damage', () => {
    const table = inTheWoods('winter-wolf', WINTER);
    const out = unwrap(
      forcePrintedSave(
        table.state,
        WINTER,
        { line: COLD_BREATH, targets: [BREN], commandId: 'breath' },
        supply('breath'),
      ),
      'the wolf breathes',
    );
    table.did('the wolf breathes', () => ok(out));

    // The Action is gone, and the log says which line took it.
    expect(table.state.combat?.budgets[WINTER]?.action).toBe(false);
    const taken = out.events.filter((event) => event.type === 'stated-action-taken');
    expect(taken).toHaveLength(1);
    expect(taken[0]?.type === 'stated-action-taken' ? taken[0].line : null).toBe(COLD_BREATH);

    // The engine rolled: a save for the one creature named, at the printed DC.
    expect(out.outcomes).toHaveLength(1);
    expect(out.outcomes[0]?.target).toBe(BREN);
    const saved = out.events.filter(
      (event) => event.type === 'roll-recorded' && event.who === BREN,
    );
    expect(saved).toHaveLength(1);

    // And the dice were the block's, in the block's damage type.
    const faces = dieFaces(out.events, BREN);
    expect(faces?.type).toBe('cold');
    expect(faces?.raw).toBeGreaterThan(0);
  });

  it('halves the damage on a success and deals it whole on a failure', () => {
    // Twelve seeds, so both branches of the same rule are exercised without
    // any test pinning a die face.
    const seen = new Set<boolean>();
    for (let n = 0; n < 12; n += 1) {
      const table = inTheWoods('winter-wolf', WINTER);
      const out = unwrap(
        forcePrintedSave(
          table.state,
          WINTER,
          { line: COLD_BREATH, targets: [BREN] },
          supply(`breath-${n}`),
        ),
        'the wolf breathes',
      );
      const success = out.outcomes[0]!.save.success;
      seen.add(success);
      const faces = dieFaces(out.events, BREN)!;
      // SRD: "The halved damage is equal to half the damage that would be
      // dealt on a failed save" — half of what the line deals, and rounded
      // down, which is the engine's rule for every halving.
      expect(faces.total).toBe(success ? Math.floor(faces.raw / 2) : faces.raw);
    }
    expect([...seen].sort()).toEqual([false, true]);
  });

  it('gives a success nothing where the line prints no Success clause', () => {
    // SRD Satyr's Mockery: `_Failure:_ 5 (1d6 + 2) Psychic damage.` and no
    // more. A success that bought half anyway would be a line nobody printed.
    let sawASuccess = false;
    for (let n = 0; n < 12 && !sawASuccess; n += 1) {
      const table = inTheWoods('satyr', SATYR);
      const out = unwrap(
        forcePrintedSave(
          table.state,
          SATYR,
          { line: MOCKERY, targets: [BREN] },
          supply(`mockery-${n}`),
        ),
        'the satyr mocks',
      );
      if (!out.outcomes[0]!.save.success) continue;
      sawASuccess = true;
      expect(out.outcomes[0]!.damage).toBe(0);
      // Nothing was rolled for damage either: a line that deals nothing does
      // not move the generator.
      expect(out.events.some((event) => event.type === 'damage-dice-recorded')).toBe(false);
    }
    expect(sawASuccess).toBe(true);
  });

  it('rolls one save each for everybody the caller named', () => {
    const table = inTheWoods('winter-wolf', WINTER, true);
    const out = unwrap(
      forcePrintedSave(
        table.state,
        WINTER,
        { line: COLD_BREATH, targets: [BREN, NYX] },
        supply('cone'),
      ),
      'the wolf breathes on both',
    );
    expect(out.outcomes.map((outcome) => outcome.target)).toEqual([BREN, NYX]);
    expect(
      out.events.filter((event) => event.type === 'roll-recorded').map((event) =>
        event.type === 'roll-recorded' ? event.who : null,
      ),
    ).toEqual([BREN, NYX]);
  });

  /**
   * A heading in a stat block says what the line under it **costs**, and the
   * book writes the save template under both headings: the Gorgon's Trample
   * is a Bonus Action and the Winter Wolf's breath is an Action. So the same
   * door takes both and spends what the heading names — which is the reason
   * the parser reads every detector over every section in the first place.
   */
  it('spends a Bonus Action for a line the block prints under that heading', () => {
    const gorgon = id('gorgon');
    const table = inTheWoods('gorgon', gorgon);
    const before = table.state.combat?.budgets[gorgon]?.action;
    expect(before).toBe(true);

    const out = unwrap(
      forcePrintedSave(
        table.state,
        gorgon,
        { line: 'Trample', targets: [BREN] },
        supply('trample'),
      ),
      'the gorgon tramples',
    );
    table.did('the gorgon tramples', () => ok(out));

    // The Bonus Action went and the Action did not.
    expect(table.state.combat?.budgets[gorgon]?.bonusAction).toBe(false);
    expect(table.state.combat?.budgets[gorgon]?.action).toBe(true);
    expect(out.events.some((event) => event.type === 'bonus-action-spent')).toBe(true);
    expect(out.events.some((event) => event.type === 'action-spent')).toBe(false);
    // And the event is the one that section's own door writes, **with the
    // turn on it**: a gated Multiattack asks which line was taken *this turn*,
    // and the answer is that field rather than the event's existence.
    const taken = out.events.filter((event) => event.type === 'stated-bonus-action-taken');
    expect(taken).toHaveLength(1);
    expect(taken[0]?.type === 'stated-bonus-action-taken' ? taken[0].line : null).toBe('Trample');
    expect(taken[0]?.type === 'stated-bonus-action-taken' ? taken[0].turn : null).toBe(
      table.state.combat?.turnsTaken,
    );

    // **The addend the book prints inside the parenthesis lands**, which is
    // the Gorgon's "16 (2d10 + 5)" and the one block in this file that carries
    // one: the dice are two d10s and the component is five more than they
    // came to. The same trap Finger of Death fell into, on the other path.
    expect(out.outcomes).toHaveLength(1);
    const recorded = out.events.find((event) => event.type === 'damage-dice-recorded');
    const component =
      recorded?.type === 'damage-dice-recorded' ? recorded.components[0]! : null;
    expect(component?.type).toBe('bludgeoning');
    expect(component?.dice).toHaveLength(2);
    expect(component?.flat).toBe(5);
    const thrown = (component?.dice ?? []).reduce((sum, die) => sum + die.value, 0);
    const success = out.outcomes[0]!.save.success;
    expect(component?.total).toBe(success ? Math.floor((thrown + 5) / 2) : thrown + 5);
  });

  it('hands back the clause it did not read, and claims nothing about it', () => {
    const table = inTheWoods('winter-wolf', WINTER);
    const out = unwrap(
      forcePrintedSave(
        table.state,
        WINTER,
        { line: COLD_BREATH, targets: [BREN] },
        supply('clause'),
      ),
      'the wolf breathes',
    );
    expect(out.unverified).toHaveLength(1);
    expect(out.unverified[0]).toContain('15-foot Cone');
    expect(out.unverified[0]).toContain(COLD_BREATH);
  });

  /**
   * SRD Evasion: "you instead take no damage if you succeed on the saving
   * throw and only half damage if you fail." A dragon's breath is the textbook
   * case, and the feature is the *target's* — so it is read off whoever is
   * standing in the cone, exactly as it is for a Fireball.
   */
  it('lets a creature with Evasion answer a Dexterity save the book’s way', () => {
    const ankheg = id('ankheg');
    const ACID = statBlock('ankheg').actions[1]!.name;
    expect(planCharacter(SRD_CONTENT, rogue('Nyx')).ok).toBe(true);

    let sawSuccess = false;
    let sawFailure = false;
    for (let n = 0; n < 16 && !(sawSuccess && sawFailure); n += 1) {
      const table = inTheWoods('ankheg', ankheg, true);
      const out = unwrap(
        forcePrintedSave(
          table.state,
          ankheg,
          { line: ACID, targets: [NYX] },
          supply(`acid-${n}`),
        ),
        'the ankheg sprays',
      );
      const outcome = out.outcomes[0]!;
      if (outcome.save.success) {
        sawSuccess = true;
        expect(outcome.damage).toBe(0);
      } else {
        sawFailure = true;
        const faces = dieFaces(out.events, NYX)!;
        expect(faces.total).toBe(Math.floor(faces.raw / 2));
      }
    }
    expect([sawSuccess, sawFailure]).toEqual([true, true]);
  });
});

describe('what the door refuses, and what it asks for', () => {
  it('asks who the line caught rather than refusing', () => {
    const table = inTheWoods('winter-wolf', WINTER);
    const asked = forcePrintedSave(
      table.state,
      WINTER,
      { line: COLD_BREATH, targets: [] },
      supply('nobody'),
    );
    expect(isErr(asked) && asked.kind).toBe('needs-context');
    expect(isErr(asked) && asked.code).toBe('undeclared_targets');
    // And it says what would settle it, by the name of the command that does.
    expect(contextRequestsOf(asked).map((request) => request.satisfyWith)).toEqual([
      'forcePrintedSave again with its targets filled in',
    ]);
    // And the Action is not spent by a question.
    expect(table.state.combat?.budgets[WINTER]?.action).toBe(true);
  });

  it('refuses a line whose sentence states no save it could read', () => {
    const harpy = id('harpy');
    const table = inTheWoods('harpy', harpy);
    const line = statedActionOf(table.state.creatures[harpy]!.sheet, 'Luring Song');
    expect(line?.save).toBeUndefined();

    const refused = forcePrintedSave(
      table.state,
      harpy,
      { line: 'Luring Song', targets: [BREN] },
      supply('song'),
    );
    expect(isErr(refused) && refused.code).toBe('line_states_no_save');
    // The other door still takes it, which is what the refusal points at.
    expect(isErr(takeStatedAction(table.state, harpy, { line: 'Luring Song' }))).toBe(false);
  });

  it('refuses a heading the block does not print under Actions', () => {
    const table = inTheWoods('winter-wolf', WINTER);
    const refused = forcePrintedSave(
      table.state,
      WINTER,
      { line: 'Tail Swipe', targets: [BREN] },
      supply('nothing'),
    );
    expect(isErr(refused) && refused.code).toBe('no_such_line');
  });

  it('refuses a second use of a line the block recharges, with nothing spent', () => {
    const table = inTheWoods('winter-wolf', WINTER);
    table.did('the wolf breathes', (s) =>
      forcePrintedSave(s, WINTER, { line: COLD_BREATH, targets: [BREN] }, supply('once')),
    );
    expect(table.events.some((event) => event.type === 'printed-line-expended')).toBe(true);

    const again = forcePrintedSave(
      table.state,
      WINTER,
      { line: COLD_BREATH, targets: [BREN] },
      supply('twice'),
    );
    expect(isErr(again) && again.code).toBe('line_expended');
  });

  it('is idempotent under its command id', () => {
    const table = inTheWoods('winter-wolf', WINTER);
    table.did('the wolf breathes', (s) =>
      forcePrintedSave(
        s,
        WINTER,
        { line: COLD_BREATH, targets: [BREN], commandId: 'toolu_breath' },
        supply('once'),
      ),
    );
    const before = table.events.length;
    const repeat = unwrap(
      forcePrintedSave(
        table.state,
        WINTER,
        { line: COLD_BREATH, targets: [BREN], commandId: 'toolu_breath' },
        supply('once'),
      ),
      'the same call again',
    );
    expect(repeat.duplicate).toBe(true);
    expect(repeat.events).toEqual([]);
    expect(table.events.length).toBe(before);
  });

  /**
   * **No Reaction window opens**, which is the same stated limit a spell's
   * damage records: Uncanny Dodge answers a sword, and a breath weapon is not
   * one. The damage takes the path `dealSpellDamage` already owns, so nothing
   * here can close a `damage-rolled` a defender was offered — there is none.
   */
  it('opens no damage-rolled hold for the defender to answer in', () => {
    const table = inTheWoods('winter-wolf', WINTER);
    const out = unwrap(
      forcePrintedSave(
        table.state,
        WINTER,
        { line: COLD_BREATH, targets: [BREN] },
        supply('hold'),
      ),
      'the wolf breathes',
    );
    expect(out.events.some((event) => event.type === 'damage-rolled')).toBe(false);
  });
});

/**
 * The dice it throws are on the campaign's own stream, and the log says where
 * that stream got to.
 *
 * **This was wrong, and it was wrong invisibly.** The command threw a saving
 * throw for every creature the line caught and a damage roll for most of them,
 * moved the generator, and wrote no `rolls-issued` — so nothing in the log
 * recorded either the roll ids it minted or the position it left the
 * generator in. Every other rolling command in the engine writes one;
 * `takeHide`, five hundred lines down the same file, writes it around a
 * single check.
 *
 * What that costs is CLAUDE.md's third rule. A session is resumed by
 * rebuilding the generator from the last recorded snapshot and the issuer
 * from `rollsIssued` — which is what `supply()` below does and what
 * `scenario.test.ts` has always done — so a command that records neither
 * leaves the *next* command to restart the stream from the seed. It draws the
 * same faces under the same roll ids, and the log folds to a state that
 * depends on how the session happened to be split across restarts.
 *
 * It stayed latent because nothing above the engine imports the command —
 * `packages/tools` carries `take_printed_action`, which hands the sentence
 * over, and no door that rolls it. So no log has been written with the hole
 * in it, which is why this is a defect fixed rather than a migration; and it
 * is pinned here rather than left for whichever batch opens that door,
 * because a rule proved by nobody using it yet is the cheapest kind to keep.
 */
describe('the rolls it makes are written back to the log', () => {
  /** The supply a resumed session builds: the issuer and generator the log left. */
  const resumed = (table: Table) => {
    const now = table.state;
    return {
      issuer: createRollIssuer('r', now.rollsIssued),
      rng: now.rng === null ? createRng('fangs') : restoreRng(now.rng),
      content: SRD_CONTENT,
    };
  };

  it('records the ids it minted and the generator it left', () => {
    const table = inTheWoods('winter-wolf', WINTER);
    // **Where the campaign already was**, and not zero by assumption: an
    // issuer resumed at `startAt` counts what *it* minted, so asserting the
    // total against it directly would be a claim about this fixture rolling
    // nothing beforehand rather than about the rule. The day the woods roll
    // Initiative, this still holds.
    const before = table.state.rollsIssued;
    const started = resumed(table);
    table.did('the wolf breathes', (s) =>
      forcePrintedSave(s, WINTER, { line: COLD_BREATH, targets: [BREN] }, started),
    );

    // A save and a damage roll at the least, so the count is a real number
    // rather than a zero that would pass whatever the command did.
    expect(started.issuer.count).toBeGreaterThan(1);
    expect(table.state.rollsIssued).toBe(before + started.issuer.count);
    expect(table.state.rng).toEqual(started.rng.snapshot());
  });

  /**
   * And the consequence, which is the thing that actually breaks: what the
   * *next* command draws has to depend on the breath having happened.
   *
   * Two campaigns off one seed, identical but for the breath, and the same
   * four eight-sided dice thrown in each afterwards. If the breath wrote its
   * position back, the ice lands differently in the campaign where the wolf
   * breathed; if it did not, both resume from the seed and throw the same
   * four faces under the same roll id — which is the defect, stated as the
   * only thing about it anybody would ever notice.
   */
  it('leaves the next command a stream it has not already drawn', () => {
    const breathed = inTheWoods('winter-wolf', WINTER);
    breathed.did('the wolf breathes', (s) =>
      forcePrintedSave(s, WINTER, { line: COLD_BREATH, targets: [BREN] }, resumed(breathed)),
    );
    expect(rolled(breathed.events, BREN).faces).toHaveLength(4);

    const quiet = inTheWoods('winter-wolf', WINTER);

    const ice = (table: Table) =>
      rolled(
        unwrap(
          rollImprovisedDamage(
            table.state,
            BREN,
            { dice: '4d8', damageType: 'cold', source: 'the ice underfoot' },
            resumed(table),
          ),
          'the ice gives way',
        ).events,
        BREN,
      );

    expect(ice(breathed).faces).not.toEqual(ice(quiet).faces);
    // And the id is fresh, which is the other half of the same bookkeeping: a
    // rewound issuer mints `r-1` twice, and two rolls become one in any index
    // built on the id.
    expect(ice(breathed).ids).not.toEqual(ice(quiet).ids);
  });
});

/** The faces one recorded damage roll showed, and the id it showed them under. */
const rolled = (
  events: readonly GameEvent[],
  target: CharacterId,
): { readonly faces: readonly number[]; readonly ids: string | null } => {
  const recorded = events.find(
    (event) => event.type === 'damage-dice-recorded' && event.target === target,
  );
  if (recorded?.type !== 'damage-dice-recorded') return { faces: [], ids: null };
  const component = recorded.components[0]!;
  return { faces: component.dice.map((die) => die.value), ids: component.roll };
};
