import { describe, expect, it } from 'vitest';
import { SPELL_DEFINITIONS, SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from '@ie/engine';
import type { CreatureSize } from '@ie/srd/schemas';
import { advanceTime, createRng, createRollIssuer, declaredCasting, dmDecisionsIn, fold, optionEffects, pendingCastingsOf, remaining, resolveDeclaredCast, resolveSpell, spellSlotKey, type GameEvent, type Rng } from '@ie/engine';
import {
  BLOCKED_ON,
  TRACKED_ADJUDICATED,
  mechanicalMarkersIn,
  printedFieldsOf,
  printedUnitsOf,
} from '../scripts/missing-shapes.js';

/**
 * Text only the DM can decide, handed over rather than adjudicated.
 *
 * The owner's ruling, verbatim: "**Some text is the DM's alone.** Commune,
 * Dream's Range `Special`, Mirage Arcane's `Sight`: the casting hands the
 * printed text to whoever is running the table, human or model, marked
 * explicitly as a thing only the DM can decide. Not a format arm to invent, a
 * handover to make visible."
 *
 * Three spells, and the three of them were on two different lists for the same
 * wrong reason. Dream and Mirage Arcane sat in `BLOCKED_ON` **under protest** —
 * the entries said in as many words that no shape id named the gap and that
 * inventing one would be an architecture decision rather than a reading — and
 * Commune was written, with a deity's answers filed in `unmodelled` as though
 * somebody would one day build the thing that produces them.
 *
 * Neither filing was true. A question asked of a god, a Range printed `Special`
 * and a Range printed `Sight` are not mechanisms the engine is missing; they
 * are questions it has no business answering. So the printed words go out with
 * the casting under a mark of their own, and everything the casting really owns
 * — the slot, the rite on the clock, the duration, the ongoing record — happens
 * around them exactly as it does for any other spell.
 *
 * ### The sweep the ruling implied, and what it actually found
 *
 * The ruling named three spells and the catalogue was never read for the rest.
 * Augury's omen — "The GM chooses the omen from the Omens table" — sat in
 * `unmodelled` saying in its own words that it was the GM's, which is a debt
 * nobody may ever pay filed on the list of debts somebody might. It was not
 * alone.
 *
 * The sweep was run against two objective anchors rather than by taste. The
 * **Range** half is closed and provably so: exactly three SRD spells print a
 * Range that is not Self, Touch or a number of feet — Dream's `Special`,
 * Mirage Arcane's `Sight` and Sending's `Unlimited` — and Sending is not a
 * handover, because it is blocked on a second plane, a 5-per-cent chance and an
 * effect that suppresses other magic. The **prose** half was anchored on the
 * book naming the GM: twenty-one SRD spells do, nineteen of them are
 * definitions, and each was read line by line against the question the ruling
 * asks — could the engine execute this if somebody built the shape, or is it a
 * fact only a person at the table can supply?
 *
 * Eight came back handovers and are re-filed here. Two rules keep the answer
 * checkable rather than a matter of opinion, and both are asserted below: a
 * handed-over sentence trips **no mechanical marker**, and it is **not a
 * sentence the tracked map already files as a debt**. Where a line was
 * genuinely both — Teleportation Circle's sigil sequences, whose 365 days of
 * daily casting is a count nothing keeps; Awaken's statistics, which are a stat
 * block as well as the GM's choice; Plane Shift's arrival, which is a second
 * place to put a creature; Prismatic Wall's light, which refuses lower-level
 * magic; Control Weather's stage tables, which wait on a delay nothing
 * schedules — the line stayed a debt and this comment is the record of why.
 *
 * ### P3-S6: the thirty-five the ledger was already calling finished
 *
 * The sweep above was anchored on the book naming the GM, which is a good
 * anchor and not the whole population. `LEDGER.md` filed thirty-five spells in
 * level-5 reach under *waits on no shape* — the column its own words define as
 * "somebody read every sentence and every one left is the table's or the
 * engine's" — while every one of those definitions went on printing its
 * handover in `unmodelled`, the list `docs/design/content.md` calls a debt and
 * `missing-shapes.ts` ranks. Thirty-five spells were therefore counted as
 * finished business by one report and as work by another.
 *
 * P3-S6 read all thirty-five against `packages/srd/raw/spells.md` and moved
 * what each hands over into `dmDecides`, in the book's own words. **Three did
 * not survive the reading**, and that is the half that matters more than the
 * re-filing: Magic Mouth's "you can have the spell end after it delivers its
 * message" is `a-casting-dismissed-early` and its own `unmodelled` line already
 * said so; Major Image's level 4+ slot is `a-duration-the-slot-changes`, whose
 * description names Major Image as the one spell in the book that prints it;
 * and Gentle Repose's extension of the time limit on raising the dead is
 * arithmetic over `Vitals.diedAt`, which `healing-that-raises-the-dead` built
 * and which a rule — `revive`'s window — really does read.
 *
 * **All three have since been paid**, which is the reading holding rather than
 * the reading being dropped: `offersEndAfterTrigger` is Magic Mouth's choice,
 * `untilDispelledAtSlot` is Major Image's level 4+ slot, and `preserves` marks
 * the body Gentle Repose keeps so `revive` takes the span back out of its own
 * window. Each spell still hands over what it always handed over, which is why
 * all three are still in this file's population — and that population is still
 * not simply the ledger's column, because a spell whose every debt is paid and
 * whose fiction is the table's is finished business the ledger stops counting
 * and this file goes on checking.
 */

const HANDING_OVER: readonly string[] = SPELL_DEFINITIONS.filter(
  (d) => (d.dmDecides ?? []).length > 0,
).map((d) => d.id);

/** The two whose **Range** is the handover, which is the half with no number. */
const DM_RANGED: readonly string[] = SPELL_DEFINITIONS.filter((d) => d.range.kind === 'dm').map(
  (d) => d.id,
);

/**
 * A casting of a minute or more, which is the only kind that reaches the log.
 *
 * The three the ruling named were all long, so the driver below assumed it.
 * The sweep found two that are not — Divination is an Action or a Ritual and
 * Gate is an Action — and an atomic casting writes `spell-cast`, which carries
 * no text at all. Their handover reaches the caller and not the log, which is
 * the limit `unmodelled` has always had and `SpellDefinition.dmDecides`
 * records; splitting the population here is how that stays a stated fact
 * rather than a test nobody could write.
 */
const LONG: readonly string[] = HANDING_OVER.filter(
  (id) => SRD_CONTENT.spell(id)!.castingTime === 'long',
);
const ATOMIC: readonly string[] = HANDING_OVER.filter(
  (id) => SRD_CONTENT.spell(id)!.castingTime !== 'long',
);

const id = (s: string) => asCharacterId(s);
const CLERIC = id('cleric');
const SLEEPER = id('sleeper');
const RAVEN = id('raven');
const CORPSE = id('corpse');

const sheet = (): CharacterSheet => ({
  level: 13,
  abilities: { str: 10, dex: 12, con: 14, int: 18, wis: 18, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'wis',
});

/**
 * A creature this table can aim a spell at.
 *
 * The type, the size and the Challenge Rating are all stated rather than left
 * out, for the reason `spell-catalogue.test.ts` and `spell-tracking.test.ts`
 * state them: a target rule that checks one of the three is the spell working,
 * and a fixture that could not satisfy it would have excused the spell from a
 * rule it prints. A creature nobody has rated is *asked* about rather than
 * read as a 0, so a rating is a fact a fixture says out loud.
 */
const added = (
  who: CharacterId,
  over: {
    readonly creatureType?: string;
    readonly size?: CreatureSize;
    readonly cr?: number;
  } = {},
): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(),
  maxHp: 60,
  diesAtZero: false,
  creatureType: 'Humanoid',
  ...over,
});

const SETUP: readonly GameEvent[] = [
  added(CLERIC),
  added(SLEEPER),
  // **The SRD Raven**, which is what a Tiny Beast is: Beast, Tiny, and rated
  // at nothing. SRD Animal Messenger takes "a Tiny Beast of your choice" and
  // spares one whose Challenge Rating is not 0, so the three facts its target
  // rule and its save read are all here — and 0 is the one rating that leaves
  // the die something to decide.
  added(RAVEN, { creatureType: 'Beast', size: 'tiny', cr: 0 }),
  added(CORPSE),
  // **And a body**, for SRD Gentle Repose: "You touch a corpse or other
  // remains" is a target rule now, and refusing the sleeper is the spell
  // working rather than the fixture being in the way.
  { type: 'creature-died', id: CORPSE, cause: 'the fixture' },
  // Every level the handed-over spells are cast at. The sweep widened the
  // population from three level-5-and-7 rites to eleven spells between level 2
  // and level 9; P3-S6 widened it again, to every tracked spell in level-5
  // reach whose every printed sentence somebody read and found to be the
  // table's — which reaches down to level 1 and to the cantrips, so the table
  // is now every level the book has rather than the seven that happened to be
  // needed.
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map(
    (level): GameEvent => ({
      type: 'resource-pool-declared',
      id: CLERIC,
      pool: {
        key: spellSlotKey(level),
        label: `level ${level} spell slot`,
        max: 2,
        recovers: 'long-rest',
      },
    }),
  ),
  { type: 'scene-set', extent: { width: 200, depth: 200, height: 40 } },
  { type: 'landmark-added', name: 'the shrine', at: { x: 50, y: 50, z: 0 } },
  { type: 'creature-placed', id: CLERIC, placement: { from: { landmark: 'the shrine' }, feet: 0 } },
  {
    type: 'creature-placed',
    id: SLEEPER,
    placement: { from: { creature: CLERIC }, feet: 5, bearing: 0 },
  },
  {
    type: 'creature-placed',
    id: RAVEN,
    placement: { from: { creature: CLERIC }, feet: 5, bearing: 90 },
  },
  { type: 'sight-declared', from: CLERIC, to: SLEEPER, seen: true },
  { type: 'sight-declared', from: CLERIC, to: RAVEN, seen: true },
  {
    type: 'creature-placed',
    id: CORPSE,
    // Bearing 180: the Raven already stands at 90, and two fixtures on one
    // square is a corrupt log rather than a crowd.
    placement: { from: { creature: CLERIC }, feet: 5, bearing: 180 },
  },
  { type: 'sight-declared', from: CLERIC, to: CORPSE, seen: true },
  {
    type: 'spellcasting-declared',
    id: CLERIC,
    spellcasting: declaredCasting({
      ability: 'wis',
      classId: 'cleric',
      // Six of the spells read to the end are cantrips, and a cantrip is cast
      // off this list rather than off a slot.
      cantrips: SPELL_DEFINITIONS.filter((d) => d.level === 0).map((d) => d.id),
      prepared: SPELL_DEFINITIONS.filter((d) => d.level > 0).map((d) => d.id),
    }),
  },
];

/**
 * Which body a target rule accepts, where it names one.
 *
 * Every spell here but one takes whoever is standing there; SRD Animal
 * Messenger takes "a Tiny Beast of your choice", and the refusal of the
 * Humanoid is the target rule working rather than an obstacle — so the fixture
 * aims at the creature the rule accepts rather than the spell being excused
 * the check. Keyed by the facts the rule states, the type and the type and
 * size together, exactly as `spell-tracking.test.ts` keys the same choice; and
 * the lookup throws for a pair nobody added, because a fixture quietly aiming
 * at the wrong creature is how a refusal becomes the fixture's rather than the
 * spell's.
 */
const TYPED: Readonly<Record<string, CharacterId>> = { Humanoid: SLEEPER, Beast: RAVEN };
const SIZED: Readonly<Record<string, CharacterId>> = { 'Beast/tiny': RAVEN };

const bodyFor = (definition: (typeof SPELL_DEFINITIONS)[number]): CharacterId => {
  const wanted = definition.targets.mustBeType;
  const sized = definition.targets.mustBeSize;
  const at =
    sized !== undefined
      ? SIZED[`${wanted ?? 'Humanoid'}/${sized}`]
      : wanted === undefined
        ? SLEEPER
        : TYPED[wanted];
  if (at === undefined) {
    throw new Error(
      `${definition.id} wants a ${sized === undefined ? '' : `${sized} `}${wanted ?? 'creature'} and this table has none`,
    );
  }
  return at;
};

/**
 * What one casting of a handing-over definition is aimed at.
 *
 * Derived from the definition rather than listed by spell id, for the reason
 * `spell-tracking.test.ts`'s own sweep derives it: what this file claims is
 * that each of these is *cast* rather than refused, and a table of ids would
 * have to be extended by hand on the day a definition's target rule moved.
 *
 * Six facts and no more: whether it aims at anybody, which body it aims at —
 * {@link bodyFor}, since a target rule here names a type and a size — whether
 * it asks about consent, where a volume the caster places goes (since SRD
 * Silence joined the population), and — since SRD Magic Circle joined it — the
 * first branch a spell prints and the first creature type it offers, because a
 * casting states both or is refused. No definition here prints a single stated
 * choice.
 */
const aimedAt = (definition: (typeof SPELL_DEFINITIONS)[number]) => {
  const targets =
    definition.targets.count === 0
      ? []
      : [
          definition.targets.self === true
            ? CLERIC
            : definition.targets.mustBeDead === true
              ? CORPSE
              : bodyFor(definition),
        ];
  const branches = Object.keys(definition.options ?? {});
  return {
    targets,
    ...(branches.length === 0 ? {} : { option: branches[0]! }),
    ...(definition.typesStated === undefined
      ? {}
      : { types: [definition.typesStated.options[0]!] }),
    // The stated damage type, where the list this casting speaks — the common
    // list, the first branch, or what a DM's decision fires — holds a slot for
    // it: SRD Glyph of Warding's rune prints five and the engine chooses none.
    ...(definition.damageTypeStated === undefined ||
    !(
      definition.options === undefined ||
      optionEffects(definition, branches.sort()[0]).some(
        (effect) => 'damageType' in effect && effect.damageType !== undefined,
      )
    )
      ? {}
      : { damageType: definition.damageTypeStated[0]! }),
    // A cone, a cube or a line needs a direction to point it in — SRD Fear's
    // 30-foot cone — and the sweep points every one east of the shrine.
    ...(definition.area !== undefined && ['cone', 'cube', 'line'].includes(definition.area.kind)
      ? { towards: { x: 100, y: 50, z: 0 } }
      : {}),
    // **An area the caster puts somewhere needs the point.** A `self` origin
    // is the caster's own space and refuses to be moved, so only a
    // point-origin volume is placed — five feet from the shrine, which is
    // inside the scene and within every Range this population prints.
    ...(definition.area?.origin === 'point' ? { at: { x: 55, y: 50, z: 0 } } : {}),
    // A cantrip is cast off the known list and spends no slot, so naming one
    // is the refusal rather than the casting.
    ...(definition.level === 0 ? {} : { slotLevel: definition.level }),
    // The ninth stated fact: a target rule that gates on consent asks about
    // everybody nobody has spoken for.
    ...(definition.targets.willing === true ? { willing: targets } : {}),
  };
};

const supply = () => ({
  issuer: createRollIssuer('r'),
  rng: createRng('handover') as Rng,
  content: SRD_CONTENT,
});

/** An Action casting, which lands in one breath and writes no pending record. */
const atomic = (spellId: string, log: readonly GameEvent[] = SETUP) => {
  const definition = SRD_CONTENT.spell(spellId)!;
  const cast = unwrap(
    resolveSpell(fold('seed', log), CLERIC, { spellId, ...aimedAt(definition) }, supply()),
    `cast ${spellId}`,
  );
  return { cast, log: [...log, ...cast.events], unverified: [...cast.unverified] };
};

/**
 * One of the long ones, cast the whole way: declared, held on the clock for the
 * rite the book prints, and settled.
 *
 * Nine of the eleven take a minute or more, so none of those lands in one
 * breath — and driving the whole casting is the only way to say that the
 * handover survives the round trip through the log rather than being a string a
 * command returned.
 */
const driven = (spellId: string, log: readonly GameEvent[] = SETUP) => {
  const definition = SRD_CONTENT.spell(spellId)!;
  const declared = unwrap(
    resolveSpell(fold('seed', log), CLERIC, { spellId, ...aimedAt(definition) }, supply()),
    `declare ${spellId}`,
  );

  const open = fold('seed', [...log, ...declared.events]);
  const castingId = pendingCastingsOf(open)[0]!.castingId;
  const tick = unwrap(
    advanceTime(open, definition.castingSeconds!, 'the rite'),
    `the rite of ${spellId}`,
  );
  const ticked = [...log, ...declared.events, ...tick];
  const settled = unwrap(
    resolveDeclaredCast(fold('seed', ticked), castingId, supply()),
    `settle ${spellId}`,
  );
  return {
    castingId,
    declared,
    open,
    log: [...ticked, ...settled.events],
    settled,
    unverified: [...declared.unverified, ...settled.unverified],
  };
};

describe('the catalogue hands over exactly the text it means to', () => {
  it('is the three the ruling named, the eight the sweep found and P3-S6’s reading', () => {
    expect([...HANDING_OVER].sort()).toEqual([
      'alarm',
      // **The forty-seventh, and the second that is not a spell the engine
      // merely records.** SRD Animal Messenger's one mechanical sentence is
      // executed — a Charisma saving throw whose whole content is its verdict,
      // with a Beast the book rates above 0 spared before the die is read —
      // and everything else it prints is the errand: the place, the recipient
      // "who matches a general description", the twenty-five words, the miles
      // a day, and the Beast coming home with the message lost. None of that
      // is a mechanism the engine is missing; it is the table's, and it goes
      // out of every casting in the book's own words.
      'animal-messenger',
      // **The forty-eighth, and the third that executes.** SRD Animate Dead's
      // corpse and bones are raised under a controlled bond; what it hands
      // over is the command structure the book prints over the creature —
      // the Bonus Action, the sixty feet, the Dodge an uncommanded creature
      // takes — which is a table's business over a creature the engine holds.
      'animate-dead',
      'arcane-lock',
      'augury',
      'clairvoyance',
      'commune',
      'commune-with-nature',
      'comprehend-languages',
      'contact-other-plane',
      'control-weather',
      'create-food-and-water',
      'create-or-destroy-water',
      'detect-evil-and-good',
      'detect-magic',
      'detect-poison-and-disease',
      'disguise-self',
      'divination',
      'dream',
      'druidcraft',
      'elementalism',
      // SRD Enlarge/Reduce's gear: 'Everything that a targeted creature is
      // wearing and carrying changes size with it', the dropped item and the
      // thrown weapon — fiction the engine holds nothing of, beside four
      // clauses it executes whole.
      'enlarge-reduce',
      // SRD Fear's compelled Dash — 'moves away from you by the safest route
      // ... unless there is nowhere to move' — under the ruling that a
      // compulsion is adjudicated and never performed: the Action is narrowed
      // to the Dash by the engine and the route is the table's.
      'fear',
      'find-traps',
      'floating-disk',
      'gate',
      'gentle-repose',
      // SRD Glyph of Warding's inscription and its invented trigger, beside
      // the rune the DM's door fires.
      'glyph-of-warding',
      'identify',
      'illusory-script',
      // **Knock, read to the end.** Every one of its sentences is about an
      // object — a lock, a bar, a chest, an Arcane Lock on a door — and no
      // object has a state here to be opened; its one filed debt recorded in
      // its own words that the casting it would suppress could never be
      // named. Handed over whole, and the tracked map keeps the reading.
      'knock',
      'legend-lore',
      'locate-animals-or-plants',
      'locate-object',
      'mage-hand',
      // **The third executed spell here.** SRD Magic Circle's mechanical
      // sentences are executed — a barrier, a save on a teleport, an attack
      // mode and an Immunity, all off the Cylinder — and the one handed over
      // is the runes on the floor, which is a fact about the room.
      'magic-circle',
      'magic-mouth',
      'major-image',
      'meld-into-stone',
      'mending',
      'message',
      'minor-illusion',
      'mirage-arcane',
      'planar-ally',
      'purify-food-and-drink',
      // Rope Trick left this list on the second place: the climb, the eight,
      // the isolation and the drop are executed, and the rope and the portal
      // are the definition's own `unmodelled` rather than a whole handover.
      'see-invisibility',
      // **Sending, defined on the owner's ruling of 2026-09-25.** The one die
      // in it — the 5 percent across the planes — is the engine's, thrown only
      // when the caster states the recipient is elsewhere; the message, the
      // reply and the eight-hour block are the table's, handed over whole.
      'sending',
      // **The forty-sixth, and the first that is not a spell the engine merely
      // records.** SRD Silence's three mechanical sentences are executed —
      // an Immunity and a condition derived from the spaces a creature
      // occupies, and a Verbal casting the Sphere refuses — and the sentence
      // handed over is the fourth: no sound is created in the Sphere, which
      // is a fact about the world the engine holds nothing of.
      'silence',
      'silent-image',
      'speak-with-animals',
      'speak-with-dead',
      // **The fourth.** SRD Tiny Hut's barrier, ward and ending are executed;
      // what goes to the table is the dome's weather, its light, its colour
      // and its opacity, and the failure at the casting if it is not big
      // enough — facts about a room and about creatures nobody has placed.
      // SRD Speak with Plants' conversation, beside the two directions of
      // ground it executes.
      'speak-with-plants',
      'tiny-hut',
      'tongues',
      'water-breathing',
      'water-walk',
    ]);
    // And the Range half did not grow, because it was already complete: three
    // SRD spells print a Range that is not Self, Touch or a number of feet, and
    // the third is Sending — whose `Unlimited` is **not** the `dm` arm's. It
    // was undefined and in the map as the counter-example that kept
    // `range: 'dm'` from becoming the arm every awkward Range goes into, and it
    // is defined now (the owner, 2026-09-25) on a fourth kind of its own:
    // `unlimited` measures nothing and asks the table nothing, so the `dm`
    // arm still carries exactly the two Ranges that are a question.
    expect([...DM_RANGED].sort()).toEqual(['dream', 'mirage-arcane']);
    expect(SRD_CONTENT.spell('sending')?.range).toEqual({ kind: 'unlimited' });
    expect(BLOCKED_ON['sending']).toBeUndefined();
  });

  /**
   * **Verbatim, and provably so.** A handover that paraphrased the book would
   * be the engine having an opinion about text it just said was not its own,
   * so every sentence handed over has to be one the SRD prints — either a
   * printed field (`Range: Sight`) or a sentence of the spell's own prose.
   */
  it.each(HANDING_OVER.map((s) => [s] as const))('quotes %s word for word', (spellId) => {
    const units = printedUnitsOf(spellId);
    for (const printed of SRD_CONTENT.spell(spellId)!.dmDecides ?? []) {
      expect(units, `${spellId}: "${printed}"`).toContain(printed);
    }
  });

  /**
   * And a Range the DM decides hands over the Range, which is the one thing it
   * could otherwise fail to mention: a casting that measured nothing and said
   * nothing would be the silent success the ruling exists to refuse.
   */
  it.each(DM_RANGED.map((s) => [s] as const))('hands over the printed Range of %s', (spellId) => {
    const printed = printedFieldsOf(spellId).find((field) => field.startsWith('Range: '));
    expect(SRD_CONTENT.spell(spellId)!.dmDecides ?? [], spellId).toContain(printed);
  });

  /**
   * The two lists say different things, so nothing may sit in both. A clause
   * recorded as a debt *and* handed over would be counted as work somebody may
   * do and disowned in the same breath.
   */
  it.each(HANDING_OVER.map((s) => [s] as const))('files %s’s two lists apart', (spellId) => {
    const definition = SRD_CONTENT.spell(spellId)!;
    const gaps = new Set(definition.unmodelled ?? []);
    expect((definition.dmDecides ?? []).filter((printed) => gaps.has(printed))).toEqual([]);
  });

  /**
   * **The first of the two rules that make the sweep checkable.**
   *
   * The judgement the ruling asks for — could the engine execute this if
   * somebody built the shape, or is it a fact only a person at the table can
   * supply? — is a reading, and a reading nobody can check is how a handover
   * becomes the bin an awkward mechanic goes into. So it is anchored to the
   * marker list the tracked bucket has always been held to: dice, a saving
   * throw, an ability check, an Armour Class, Hit Points, a defence, a
   * condition, a roll mode, a Speed, a percentage, a cost in feet, a teleport,
   * extra damage. A sentence naming one of those is a claim about mechanics,
   * and mechanics are not handed over.
   *
   * ### The one way past it, and it is a reading rather than an exemption
   *
   * P3-S6 read thirty-five tracked spells to the end and found four sentences
   * that trip a marker and are still the table's: Meld into Stone's expulsions
   * and the five feet that walk out of a rock, See Invisibility's sight of the
   * Invisible condition, Magic Mouth's "trigger condition". The marker is
   * firing on a real word — the engine does hold the Prone condition, and does
   * charge movement — and what makes the sentence the table's is the fact
   * underneath it, which no marker can see.
   *
   * So a marked sentence may be handed over **only where the tracked map
   * anchors a `'table'` reading to it**: somebody read that sentence, wrote
   * down why it is the table's, and the note is there to be re-run. That is
   * strictly more than the marker rule asked for — an unread marked sentence
   * is still refused, and the escape cannot be taken by writing a definition
   * alone — and it puts the argument in the map rather than in an exemption
   * list somebody has to maintain.
   */
  const readAsTheTable = (spellId: string, printed: string): boolean =>
    (TRACKED_ADJUDICATED[spellId] ?? []).some(
      (entry) => entry.why === 'table' && printed.includes(entry.clause),
    );

  it.each(HANDING_OVER.map((s) => [s] as const))('names no mechanic in %s’s handover', (spellId) => {
    for (const printed of SRD_CONTENT.spell(spellId)!.dmDecides ?? []) {
      if (readAsTheTable(spellId, printed)) continue;
      expect(mechanicalMarkersIn(printed), `${spellId}: "${printed}"`).toEqual([]);
    }
  });

  /**
   * And the escape is not free: it is asserted to be *used*, and used only by
   * sentences a marker really does see. A rule with no consumer is a rule
   * nobody can tell from a typo, and one whose consumers are all clean anyway
   * would be a licence granted to nothing.
   */
  it('takes the map’s reading only for sentences a marker fires on', () => {
    const marked = HANDING_OVER.flatMap((spellId) =>
      (SRD_CONTENT.spell(spellId)!.dmDecides ?? [])
        .filter((printed) => mechanicalMarkersIn(printed).length > 0)
        .map((printed) => [spellId, printed] as const),
    );
    expect(marked.length).toBeGreaterThan(0);
    for (const [spellId, printed] of marked) {
      expect(readAsTheTable(spellId, printed), `${spellId}: "${printed}"`).toBe(true);
    }
  });

  /**
   * **The second: nothing handed over is a sentence already filed as a debt.**
   *
   * `TRACKED_ADJUDICATED` anchors each entry to a distinctive phrase of the
   * spell's own printed text, so a handover that contained one of those phrases
   * would be the same sentence counted as work somebody may do and disowned in
   * the same breath — the failure the two-lists-apart rule above forbids
   * *within* a definition, arriving from the map instead.
   *
   * This is the rule that kept Control Weather's stage tables a debt. "When you
   * change the weather conditions, find a current condition on the following
   * tables and change its stage by one, up or down" is the DM's *and* waits on
   * the `1d4 × 10 minutes` nothing schedules, and the tracked map says so; the
   * sentences around it, which are only the weather, are handed over.
   *
   * **And it found one breach on the day it was written, which is recorded
   * rather than exempted** — the discipline `origin-and-feature-sweep.test.ts`
   * already keeps. Mirage Arcane's opening sentence is a handover with a debt
   * inside it: what the terrain looks, sounds, smells and feels like is the
   * DM's, and "in an area up to 1 mile square" is a size chosen at the casting
   * that a `SpellArea` cannot record. It went out with the ruling's own three,
   * before there was a rule for it to break. The record is one entry long and
   * the guard bites on everything else, so a second one is an argument somebody
   * has to have rather than a line that slips in.
   */
  const BOTH: readonly (readonly [string, string])[] = [
    ['mirage-arcane', 'in an area up to 1 mile square'],
  ];

  /**
   * **A debt, and not merely an entry.** The rule read every anchor in the map
   * as one, which was true while the only spells here were ones the sweep had
   * re-filed — and is exactly backwards for the thirty-five P3-S6 read to the
   * end, whose entries say `'table'`. Such an entry is not a competing claim on
   * the sentence; it is the *record of this very reading*, and refusing a
   * handover because somebody wrote down why it is a handover would make the
   * two halves of the ruling contradict each other.
   *
   * So the anchors this rule guards are the ones whose `why` is a **shape** —
   * the entries `spellShapesOf` counts and the blocker table ranks. `'engine'`
   * is excluded for the same reason from the other end: a clause the engine
   * executes is not work anybody is owed either, and a spell may not hand it
   * over — which is what the marker rule above catches, since every such
   * sentence names the mechanic the engine rolls.
   */
  const debtAnchorsOf = (spellId: string): readonly string[] =>
    (TRACKED_ADJUDICATED[spellId] ?? [])
      .filter((entry) => entry.why !== 'table' && entry.why !== 'engine')
      .map((entry) => entry.clause);

  it.each(HANDING_OVER.map((s) => [s] as const))(
    'hands over nothing %s files as a debt',
    (spellId) => {
      const recorded = BOTH.filter(([id]) => id === spellId).map(([, anchor]) => anchor);
      const anchors = debtAnchorsOf(spellId).filter((anchor) => !recorded.includes(anchor));
      for (const printed of SRD_CONTENT.spell(spellId)!.dmDecides ?? []) {
        expect(
          anchors.filter((anchor) => printed.includes(anchor)),
          `${spellId}: "${printed}"`,
        ).toEqual([]);
      }
    },
  );

  /**
   * And the rule has something to guard, which a narrowing has to prove: some
   * of these spells really do file a debt beside what they hand over, so the
   * loop above is not running over empty lists.
   */
  it('still guards spells that file a debt of their own', () => {
    const owing = HANDING_OVER.filter((spellId) => debtAnchorsOf(spellId).length > 0);
    expect(owing.length).toBeGreaterThan(1);
  });

  /** And the record is a record: every entry in it is a real overlap. */
  it.each(BOTH)('records %s’s clause that is both', (spellId, anchor) => {
    expect((TRACKED_ADJUDICATED[spellId] ?? []).map((entry) => entry.clause)).toContain(anchor);
    expect(
      (SRD_CONTENT.spell(spellId)!.dmDecides ?? []).filter((printed) => printed.includes(anchor)),
    ).toHaveLength(1);
  });
});

/**
 * Re-filing moves a line between two lists and must move nothing else.
 *
 * The eight the sweep found were all **tracked** definitions with debts of
 * their own, and a re-filing that quietly dropped one would shrink the blocker
 * map by deleting a gap rather than by building it. So what each spell claimed
 * before is pinned here, by shape, beside the count of sentences it now hands
 * over: every one of them is still out of `BLOCKED_ON`, still claims exactly
 * the shapes it claimed, and still says what it owes.
 */
describe('the sweep re-filed lines and retired no debt', () => {
  const REFILED: readonly (readonly [string, readonly string[], number])[] = [
    // Augury's one shape was built: the percentage is a `chance` effect now
    // and it claims none. The re-filing is what this row is about and it still
    // holds — the omen is handed over and nothing was deleted to get here.
    ['augury', [], 3],
    ['commune-with-nature', [], 7],
    [
      'contact-other-plane',
      ['a-dc-the-caster-does-not-set', 'a-dc-the-caster-does-not-set', 'a-deadline-anchored-to-a-rest'],
      4,
    ],
    [
      'control-weather',
      ['a-random-outcome-that-is-not-a-d20', 'a-random-outcome-that-is-not-a-d20'],
      4,
    ],
    ['divination', ['a-random-outcome-that-is-not-a-d20'], 4],
    ['gate', [], 1],
    ['legend-lore', [], 6],
    ['planar-ally', [], 16],
  ];

  it.each(REFILED)('keeps %s’s filing whole', (spellId, shapes, handed) => {
    expect(BLOCKED_ON[spellId], spellId).toBeUndefined();
    expect((TRACKED_ADJUDICATED[spellId] ?? []).map((entry) => entry.why), spellId).toEqual(shapes);
    expect((SRD_CONTENT.spell(spellId)!.dmDecides ?? []).length, spellId).toBe(handed);
  });

  /**
   * And the distinction the re-filing drew has survived the debt being paid.
   *
   * Augury's `unmodelled` line named the percentage and its `dmDecides` names
   * the omen, and the whole of that brief was that the two are different kinds
   * of thing: a debt somebody may pay, and a question nobody here will ever
   * answer. The percentage was paid — it is a `chance` effect — so the debt is
   * gone and the handover is untouched, which is the line holding rather than
   * the line disappearing.
   */
  it('executes Augury’s percentage and still hands over the omen', () => {
    const augury = SRD_CONTENT.spell('augury')!;
    expect(augury.unmodelled ?? []).toEqual([]);
    expect(augury.effects.map((effect) => effect.kind)).toEqual(['chance']);
    expect(augury.dmDecides ?? []).toContain('The GM chooses the omen from the Omens table.');
  });
});

/**
 * The slot this casting spent, asserted over **every** pool rather than one.
 *
 * Six of the spells read to the end are cantrips, and a cantrip spends
 * nothing: `spellSlotKey(0)` throws, because the book prints no such pool. So
 * the claim is made across the whole table instead — the definition's own
 * level is down by one and the other eight are untouched — which says what the
 * single lookup said and also says the casting did not reach for a
 * neighbouring slot.
 */
const spentItsSlot = (
  resources: Parameters<typeof remaining>[0],
  definition: (typeof SPELL_DEFINITIONS)[number],
): void => {
  for (const level of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
    expect(remaining(resources, spellSlotKey(level)), `level ${level}`).toBe(
      level === definition.level ? 1 : 2,
    );
  }
};

/** Whether a casting of this definition is still standing when it settles. */
const standsAfterwards = (definition: (typeof SPELL_DEFINITIONS)[number]): boolean =>
  definition.durationSeconds !== undefined || definition.untilDispelled === true;

describe('each of the forty-seven is cast, and hands its own text to the table', () => {
  it.each(LONG.map((s) => [s] as const))(
    'carries every printed sentence of %s out of the casting',
    (spellId) => {
      const definition = SRD_CONTENT.spell(spellId)!;
      const out = driven(spellId);
      expect(dmDecisionsIn(out.unverified)).toEqual(
        // Once at the declaration and once at the settlement, because both
        // halves of a long casting report what the spell left to the table.
        [...(definition.dmDecides ?? []), ...(definition.dmDecides ?? [])],
      );
      // And the gaps are still gaps, under no mark at all.
      for (const gap of definition.unmodelled ?? []) {
        expect(out.unverified).toContain(`${definition.name}: ${gap}`);
      }
    },
  );

  /** The same of the two that land in one breath, which report once. */
  it.each(ATOMIC.map((s) => [s] as const))(
    'carries every printed sentence of %s out of an Action casting',
    (spellId) => {
      const definition = SRD_CONTENT.spell(spellId)!;
      const out = atomic(spellId);
      expect(dmDecisionsIn(out.unverified)).toEqual([...(definition.dmDecides ?? [])]);
      for (const gap of definition.unmodelled ?? []) {
        expect(out.unverified).toContain(`${definition.name}: ${gap}`);
      }
    },
  );

  /**
   * The slot goes, the clock runs, and a spell with a duration is still
   * standing after it.
   *
   * The three the ruling named all had one; five of the eight the sweep found
   * are Instantaneous, and an Instantaneous rite leaves nothing behind. So the
   * ongoing record is asserted of the definitions that print a Duration and its
   * **absence** is asserted of the ones that do not — which is the half a
   * widened population would otherwise have quietly stopped checking.
   */
  it.each(LONG.map((s) => [s] as const))('adjudicates what it owns for %s', (spellId) => {
    const definition = SRD_CONTENT.spell(spellId)!;
    const out = driven(spellId);
    const after = fold('seed', out.log);
    spentItsSlot(after.creatures.cleric!.resources, definition);
    expect(Object.keys(after.ongoing)).toEqual(standsAfterwards(definition) ? [out.castingId] : []);
    // **Nothing landed on anybody**, which was ten of these spells and is now
    // ten of eleven: every one is a rite whose whole content is the text it
    // hands over. Augury is the exception and is the honest kind — its
    // `chance` effect reports what it decided about this casting's handover,
    // which is an outcome about the caster rather than something done to
    // somebody else.
    // Animate Dead is the second exception and the other honest kind: its
    // `raise` is aimed at the corpse the fixture supplies, and the corpse
    // *is* affected — it leaves the roster and a Zombie stands in its space.
    // The text it hands over is the command structure over that creature.
    const raises = definition.effects.some((effect) => effect.kind === 'raise');
    expect(out.settled.outcomes).toEqual(
      definition.effects.length === 0
        ? []
        : raises
          ? [{ target: CORPSE, affected: true }]
          : [{ target: asCharacterId('cleric'), affected: false }],
    );
  });

  it.each(ATOMIC.map((s) => [s] as const))('spends a slot for %s', (spellId) => {
    const definition = SRD_CONTENT.spell(spellId)!;
    const out = atomic(spellId);
    const after = fold('seed', out.log);
    spentItsSlot(after.creatures.cleric!.resources, definition);
    // **Nothing landed on anybody**, which was every one of these while an
    // atomic handover was a casting whose whole content was the text it hands
    // over. Animal Messenger is the exception and is the honest kind: its one
    // effect is a save whose whole content is its verdict, so the die is
    // rolled, the answer about the Beast comes back in the casting's own
    // outcomes, and nothing is written anywhere for it to be read off later.
    // The verdict itself is not pinned here — what this file is about is that
    // the spell casts and hands its text over — and `verdict-only-save.test.ts`
    // is where the mark's own behaviour is driven.
    // The list this casting ran is the common list and the first branch in
    // key order — SRD Enlarge/Reduce carries every clause in its two branches
    // and an empty common list.
    const ran = optionEffects(definition, Object.keys(definition.options ?? {}).sort()[0]);
    if (ran.length === 0) {
      expect(out.cast.outcomes).toEqual([]);
      return;
    }
    // Gentle Repose is the other exception: its one effect, `preserves`, writes
    // no event and reports no outcome — what Revivify needs is on the record,
    // the moment the keeping began — so the corpse it was aimed at is filed
    // into `aimed` and nothing comes back in the outcomes to be about it.
    if (ran.every((effect) => effect.kind === 'preserves')) {
      expect(out.cast.outcomes).toEqual([]);
      return;
    }
    // The outcomes are about whom the casting was aimed at — the caster, for a
    // spell that may take itself, SRD Enlarge/Reduce — or, for a template the
    // caster points, whoever it caught: SRD Fear's cone finds the raven.
    const aimed = aimedAt(definition).targets;
    if (aimed.length === 0) {
      expect(out.cast.outcomes.length).toBeGreaterThan(0);
    } else {
      expect(out.cast.outcomes.map((one) => one.target)).toEqual(aimed);
    }
    // A save was rolled, or — for a caster taking their own Enlarge/Reduce,
    // who is willing and offered no die — the effect simply landed.
    expect(out.cast.outcomes[0]?.save?.roll ?? out.cast.outcomes[0]?.affected).toBeDefined();
  });

  /**
   * And the text is in the **log**: the declaration pins what the command read
   * from the catalogue, so the fold below is handed no content at all and
   * still knows what the table was asked.
   *
   * Long castings only, and that is the stated limit rather than an oversight.
   * `PendingCasting.unverified` is written onto `spell-declared` and
   * `spell-cast` carries no text at all, so Divination's and Gate's handovers
   * reach their caller and not their log — which is what `dmDecides` says of
   * itself, and closing it is a field on an event rather than a line here.
   */
  it.each(LONG.map((s) => [s] as const))(
    'folds %s’s handover back with no catalogue open',
    (spellId) => {
      const definition = SRD_CONTENT.spell(spellId)!;
      const out = driven(spellId);
      const pending = out.open.pendingCastings[out.castingId];
      expect(dmDecisionsIn(pending!.unverified)).toEqual([...(definition.dmDecides ?? [])]);
    },
  );

  it.each(ATOMIC.map((s) => [s] as const))('writes no pending record for %s', (spellId) => {
    const out = atomic(spellId);
    expect(Object.keys(fold('seed', out.log).pendingCastings)).toEqual([]);
  });

  /**
   * SRD Dream's Range is `Special` and its target is "a creature you know on
   * the same plane of existence" — so a spell that measured a distance would
   * refuse a target the book allows. Driven at a creature outside every range
   * the book prints, because the pass has to be the handover rather than a
   * table that happened to be small.
   */
  it('measures no distance for Dream, whose Range the book left to the DM', () => {
    const faraway: readonly GameEvent[] = SETUP.map((event) =>
      event.type === 'scene-set'
        ? { type: 'scene-set', extent: { width: 4000, depth: 4000, height: 40 } }
        : event.type === 'creature-placed' && event.id === SLEEPER
          ? {
              type: 'creature-placed',
              id: SLEEPER,
              placement: { from: { creature: CLERIC }, feet: 3000, bearing: 0 },
            }
          : event,
    );
    const out = driven('dream', faraway);
    expect(dmDecisionsIn(out.unverified)).toContain('Range: Special');
    expect(Object.keys(fold('seed', out.log).ongoing)).toEqual([out.castingId]);
  });
});
