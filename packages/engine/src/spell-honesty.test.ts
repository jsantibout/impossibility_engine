import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EXECUTED_SPELL_IDS, PARTIAL_SPELLS } from '../scripts/coverage.js';
import { SPELL_DEFINITIONS } from './spell-definitions.js';

/**
 * The honesty guard, pointed at the spells the engine **executes**.
 *
 * `spell-tracking.test.ts` has held the line for the tracked bucket since it
 * existed: `unmodelled` means *this part of the spell belongs to the fiction,
 * and the engine should never decide it*, and it must never come to mean *the
 * engine ought to enforce this and nobody has built it yet*. That guard reads
 * each tracked spell's own **SRD paragraph** out of the parsed book, because a
 * tracked definition resolves nothing and every rule in its text is a claim.
 *
 * The executed bucket is the other half of the population and had no guard at
 * all — 58 of the 82 executed definitions carry `unmodelled` clauses and
 * nothing read one. The third whole-engine audit (2026-09-13, §3.5) found what
 * that costs: a frozen statue and a puff of dust are fiction, and beside them
 * sat "the target cannot regain Hit Points until the end of your next turn",
 * "the save has Advantage if you or your allies are fighting the target", a
 * Hit Point maximum reduction and three Difficult Terrain areas — every one a
 * rule the engine owns or has already named as a missing shape, filed as
 * though it were narration.
 *
 * **The text scanned is the clause, not the paragraph**, and that is the one
 * real difference from the tracked guard. An executed spell's paragraph is
 * mostly *executed*: scanning it would demand an adjudication for the very
 * dice the engine rolls. What is a claim is the sentence the definition wrote
 * about itself, so that is what is read.
 *
 * | | |
 * |---|---|
 * | `'table'` | fiction; the engine's resolution path never arrives at it, and it should never decide it |
 * | a shape id | the path *does* arrive, would answer wrongly, and a named, enumerated shape is missing |
 *
 * And **partial is a consequence rather than a list**: a spell carrying a
 * shape adjudication is one the engine drives and does not finish, which is
 * exactly what `PARTIAL_SPELLS` claims. The list in `coverage.ts` is asserted
 * against the derived set in both directions, so the report cannot drift from
 * the debts.
 */

/**
 * Every executed definition, read off the catalogue rather than listed — and
 * read through the **one** predicate that decides it.
 *
 * `isExecuted` lives in `coverage.ts` because the report counts with it, and
 * it is imported here rather than restated because this guard's entire
 * population is that predicate: a copy that drifted by forgetting
 * `areaTrigger` would quietly stop covering Web, Grease and Insect Plague and
 * nothing would go red. One of the three copies that existed had already lost
 * that arm.
 */
const EXECUTED: readonly string[] = [...EXECUTED_SPELL_IDS].sort();

/** The SRD condition names, which a clause names directly far more often than it says "condition". */
const CONDITIONS =
  'Blinded|Charmed|Deafened|Exhaustion|Frightened|Grappled|Incapacitated|Invisible|Paralyzed|Petrified|Poisoned|Prone|Restrained|Stunned|Unconscious';

/**
 * The mechanics the engine demonstrably owns, as patterns over a clause.
 *
 * Wider than the tracked guard's thirteen, and deliberately: that one reads
 * the book's careful prose, this one reads a sentence somebody here wrote
 * about a gap, and a gap is described in whatever words fit. "The save has
 * Advantage if you or your allies are fighting the target" carries no
 * "Advantage on", and the audit names it as debt — so the pattern is the word
 * rather than the book's phrase.
 *
 * Every entry names something the engine resolves today: the generator and
 * typed damage, vitals, `rollSavingThrow` and `rollAbilityCheck`,
 * `resolveAttack`, `armorClassOf`, `applyConditionTo`, `defensesOf`,
 * `combineRollModes`, Speed and the movement budget, declared Difficult
 * Terrain, forced movement, positions, the action economy and `mayAct`,
 * `mustBeType`, the ruler, declared sight, resource pools, Concentration,
 * `releaseCasting`, death, and what a creature owns and wears. A clause naming
 * none of them is left alone, and nineteen are: light, obscurement, a strong
 * wind, what a weapon looks like, whether a suggestion sounds achievable.
 */
const CLAUSE_MARKERS = [
  ['dice', /\b\d+d\d+\b/],
  ['damage', /\bdamage(d|s)?\b/i],
  ['hit-points', /\bHit Points?\b/],
  ['saving-throw', /\bsav(e|es|ing throw)s?\b/i],
  ['ability-check', /\bcheck\b/i],
  ['attack-roll', /\battack(s|ed|ing)?\b/i],
  ['armor-class', /\bArmou?r Class\b|\bAC\b/],
  ['condition', new RegExp(`\\bcondition\\b|\\b(${CONDITIONS})\\b`, 'i')],
  ['defence', /\b(Resistance|Immunity|Vulnerability|immune)\b/i],
  ['roll-mode', /\b(Advantage|Disadvantage)\b/],
  ['speed', /\bSpeed\b/],
  ['difficult-terrain', /\bDifficult Terrain\b/i],
  ['forced-movement', /\bpush(ed|es)?\b/i],
  ['teleport', /\bteleport/i],
  [
    'action-economy',
    /\b(Reaction|Bonus Action|Magic action|Study action|Opportunity Attacks?|Dash(es)?)\b/,
  ],
  [
    'creature-type',
    /\b(Aberration|Beast|Celestial|Construct|Dragon|Elemental|Fey|Fiend|Giant|Humanoid|Monstrosity|Ooze|Plant|Undead|Zombie)s?\b/,
  ],
  ['range', /\bwithin \d+ (feet|foot)\b|\breach\b|\brange\b/i],
  ['senses', /\b(see|sees|seen|sight|perceives|Blindsight|Truesight|hidden)\b/i],
  ['spell-slot', /\bslot\b/i],
  ['concentration', /\bConcentration\b/],
  ['movement', /\bmovement\b|\bmoves?\b|\bmoving\b/i],
  ['death', /\b(kill(ed|s)?|dies|died|dead)\b/i],
  ['dispel', /\bdispel/i],
  ['equipment', /\b(holding|carries|carrying|wearing|dons|equipped)\b/i],
] as const satisfies readonly (readonly [string, RegExp])[];

type MarkerId = (typeof CLAUSE_MARKERS)[number][0];

/**
 * The mechanical shapes that stand between an executed spell and a finished
 * one, and nothing else.
 *
 * Every id names a gap this repository has already described — in `CLAUDE.md`,
 * in `PROGRESS.md`'s ranked maps, in the audit that asked for this guard, or
 * in the definition's own clause in `spell-definitions.ts`, which is where
 * several of these gaps were first written down — and the description says
 * **which**, because a shape invented here would be an architecture decision
 * smuggled in as a note. A test below holds that: a description naming no
 * source fails, and a shape nothing claims is removed, so the list can rot
 * neither into a wish list nor into a private vocabulary.
 *
 * **This is the executed bucket's list, not a shared one**, and one id —
 * `speed-and-movement-modes` — is deliberately the same string
 * `spell-tracking.test.ts` uses for the same gap. Merging the two lists would
 * mean one population's "no shape sits here unclaimed" guard passing on the
 * other's claim, which is how a shape stays in a map after the last spell
 * needing it has moved; repeating the id keeps the two guards independent and
 * still lets a reader grep one name. Neither description is authoritative over
 * the other — the gap is, and it is `baseSpeed` with nothing that modifies it.
 */
const MISSING_SHAPES = {
  'an-outcome-of-a-spells-own-damage':
    'a third outcome axis, after the saving throw and after the damage: the target reaching 0 Hit Points **because of this spell**. The audit that asked for outcome riders separates it from them by name — a rider rides the roll its host made, and this rides a number the engine went on to compute — and CLAUDE.md’s "Transitions Are Engine-Owned Batches" is where dropping to 0 is already an engine-owned consequence with nowhere for a spell to hang one.',
  'a-repeat-save-beyond-the-turn-hook':
    '`RepeatSave` says a turn boundary, an ability, a DC, and end-on-target or end-casting. The SRD also writes a save on the clock rather than on a turn, a save counted to three successes or three failures, a save that deals damage on a failure, and a save raised by a trigger. PROGRESS.md names the damage half for Ensnaring Strike and Phantasmal Force.',
  'a-casting-ended-by-a-trigger':
    'a casting ends by its deadline, by Concentration, by a dispel or by a recast — CLAUDE.md, "Lifecycle, and the one place it ends". The SRD also ends one when the caster or an ally damages the target and when the target dons armour. `CreatureState.lastDamage` names the dealer and `side` is declared, so the facts are held and nothing hangs an ending on them; the audit (§3.5) reads the Charm clauses as debt.',
  'a-mode-on-the-save-a-spell-forces':
    'CLAUDE.md: "nothing records what a save was against" — the sentence that already blocks Countercharm. A `RollModifier` selects a roll by family, ability and skill, so there is no way to say "the saving throw this casting calls for", and the SRD hands that save Advantage a dozen times.',
  'a-save-keyed-to-a-condition':
    'a save selected by what it is *against* rather than by the ability that rolls it. CLAUDE.md names it and names this spell: "A save keyed to a named **condition** rather than an ability | Protection from Poison", in the table of what the roll-modifier vocabulary deliberately does not reach. Distinct from `a-mode-on-the-save-a-spell-forces`, which is the caster’s own save seen from the other end — this one modifies a save some *other* effect will call for.',
  'a-defence-a-spell-grants':
    'a Resistance, Vulnerability or Immunity that arrives with a spell and leaves with it. `CreatureState.defenses` is written when a creature enters the game and nothing adds to it afterwards; CLAUDE.md lists the want twice, as "A granted Speed, Resistance, or a push | Ray of Frost, Hypnotic Pattern, Stoneskin, Thunderwave" among what a settled outcome may not carry, and as the class-feature gap "Superior Hunter’s Defense needs a Resistance with a deadline".',
  'an-outcome-that-varies-by-creature-type':
    'creature type is authoritative — `declareCreatureType`, `mustBeType` — and reaches targeting only. No effect varies by it, so an automatic failure, extra dice or a refusal to return goes unapplied. CLAUDE.md names the missing filter beside Protection from Evil and Good.',
  'a-stat-block-created-mid-fight':
    'summons. CLAUDE.md, "Which spells this reaches": "A stat block created mid-fight | Unseen Servant, Arcane Hand, the four Conjures, Guardian of Faith, Faithful Hound, Phantom Steed, Summon Dragon, Giant Insect".',
  'speed-and-movement-modes':
    'a Speed a spell changes, and the Fly, Climb and Swim modes the engine does not distinguish. PROGRESS.md ranks it: "A Speed a spell changes, and movement modes | 4 printed, far more in play"; the engine holds one `baseSpeed` and nothing modifies it.',
  'a-standing-effect-derived-from-where-a-creature-stands':
    'a value derived from current state *and* current geometry rather than from a pair of enter-and-leave events that have to stay matched. CLAUDE.md: "A standing effect derived from where a creature is standing | Spirit Guardians’ halved Speed, every Paladin aura"; PROGRESS.md ranks it above automatic drift.',
  'healing-modified-by-an-effect':
    '`healCreature` rolls its dice and caps at the maximum, and nothing stands beside it to forbid the healing or to maximise it. The audit (§3.5) reads Chill Touch’s "can’t regain Hit Points" as a rule the engine owns; Beacon of Hope is the same sentence pushing the other way.',
  'a-hit-point-maximum-a-spell-moves':
    'the maximum is set when a creature is added and by advancement, and no effect moves it. PROGRESS.md ranks "Healing that lifts a condition, raises the dead, or raises the maximum"; the audit names Harm’s reduction as debt.',
  'difficult-terrain-an-area-creates':
    'Difficult Terrain is charged exactly and **declared by the foot** on the move that crosses it (`MoveCommand.difficultFeet`). Deriving it from a spell’s area needs the path a move does not record — CLAUDE.md’s own named gap — so five executed areas are invisible to the ruler. The audit counts "three Difficult Terrain areas" among the clauses that are rules rather than fiction.',
  'an-area-that-moves-by-itself':
    'CLAUDE.md: "Cloudkill and Incendiary Cloud, blocked on automatic turn-start drift". PROGRESS.md says why it is not transcription: the move has to land before the start-of-turn clauses are determined, the direction is derived for one spell and chosen for the other, and a caster with no position has no "away from you" at all.',
  'a-one-shot-roll-modifier':
    'CLAUDE.md: "A one-shot mode is a different mechanic, not a short-lived one." Guiding Bolt’s "the **next** attack roll against it" and Vicious Mockery’s "the next attack roll it makes" need a modifier **consumed** by the roll it changes, and a durable grant applies until its casting ends.',
  'an-action-a-spell-compels-or-forbids':
    'the action economy is the engine’s and `mayAct` guards every spender, and the only lever a spell has on it is a condition the engine names. Forbidding one action, compelling another, or spending somebody else’s Reaction is a rider nothing expresses — which Befuddlement already says in its own words in `spell-definitions.ts`: "which is not a condition the engine names".',
  'a-choice-made-at-the-casting':
    'CLAUDE.md names it for the roll-modifier vocabulary — "An ability **chosen at the casting** | Hex, Enhance Ability, Bestow Curse" — and Guidance says it plainly: "a per-casting choice has nowhere to be recorded". Spirit Guardians’ stated damage type is the one choice that *is* pinned on a casting, which is what shows the general field is missing rather than impossible.',
  'several-attack-rolls-from-one-casting':
    'one casting rolls one attack per target. Eldritch Blast’s beams are separate attack rolls that may take different targets, which `spell-definitions.ts` already records in the clause itself — "which is a shape the engine does not have" — and which is the spell-side twin of the class-feature gap CLAUDE.md names: "Extra attacks inside the Attack action. The economy counts one Attack action, not the attacks in it".',
  'a-duration-the-slot-changes':
    'PROGRESS.md, on Major Image: "Concentration and duration that **change with the slot level** ... which `SpellDefinition` cannot express". `durationSeconds` is one number, so a Dominate cast at a higher level runs for the level 5 minute.',
  'senses-beyond-declared-sight':
    'sight is a pairwise declaration and there is nothing else — CLAUDE.md names the missing piece as "A sight clause read from the **attacker’s** side | Faerie Fire". Blindsight and Truesight are the attacker’s senses, so a spell that excuses them cannot be written.',
  'what-a-creature-is-holding':
    '`inventory` and `equipped` are real and only armour and weapons have a slot; CLAUDE.md: "Nothing checks that two hands are free, either." So a spell that makes a creature drop what it holds, or that hands one a globe to throw later, has nothing authoritative to call.',
  'targeting-rules-that-differ-within-one-casting':
    'one range and one sight requirement are checked against every named target. The SRD sometimes measures a later target from an earlier one, requires sight of only the first, or prints a reach for the attack that is not the spell’s Range — a third measurement beside the caster and the area point CLAUDE.md added for Mass Cure Wounds ("the range then belongs to the point rather than to each target"). `spell-definitions.ts` records the reach half on Vampiric Touch, whose clause says the initial attack’s "within reach" goes unchecked.',
  'a-condition-that-ends-when-its-holder-leaves-an-area':
    'CLAUDE.md says it outright: Web’s Restrained lasts "while in the webs", and "a condition that ends when its holder walks out of an area has no shape here at all".',
  'an-area-that-filters-its-catch':
    'an area catches every creature in it. PROGRESS.md names the gap for Entangle — "its area excludes the caster ... and exactly one SRD spell says that, so the field waits for a second user" — and Hypnotic Pattern’s "that can see the pattern" is the second.',
  'a-second-place-to-put-a-creature':
    'there is one scene, so a creature sent elsewhere has nowhere to be. CLAUDE.md: "A destination *outside* the scene is different in kind ... there is one scene, so Plane Shift and Word of Recall have no position to move anybody to", and "the real fix is the doctrine’s multiple-scenes seam".',
  'forced-movement-a-spell-causes':
    '`moveCreature` takes `forced: true` and reports who is being shared with, and no `SpellEffect` reaches it — CLAUDE.md records both halves: "forced movement passes `forced: true`", and its recurring finding that a pure function nothing calls is a rule nothing enforces.',
  'an-activation-that-resolves-an-area':
    'CLAUDE.md: "An activation that resolves an area at a point chosen now | Call Lightning, Storm of Vengeance". `activateSpell` resolves an attack at a named target and moves an area along a stated route; resolving a **fresh** area in a direction chosen now is neither.',
  'a-condition-benefit-an-effect-takes-away':
    'a benefit the condition layer derives, switched off while the condition itself stays. Three SRD spells print the sentence — Faerie Fire, Starry Wisp, and Mind Spike’s "against you" — and PROGRESS.md already lists Faerie Fire among the clauses the roll vocabulary cannot reach. Invisible’s *attack* halves read declared sight, so the table can answer those; `initiativeConditionModes` grants its Initiative Advantage from the condition’s presence alone, and nothing reaches that at all.',
  'damage-with-neither-an-attack-roll-nor-a-save':
    'PROGRESS.md ranks it at 19 open spells, and Magic Missile is the one this clause names: while that spell cannot be cast, Shield’s second trigger has nothing to fire on.',
} as const;

type ShapeId = keyof typeof MISSING_SHAPES;

interface Adjudication {
  /**
   * A distinctive phrase from the clause this answers.
   *
   * Not an index: a clause that is reordered would silently take its
   * neighbour's licence, and a clause that is **reworded** should have to be
   * read again rather than keep an adjudication written about the old
   * sentence. The phrase must match exactly one of the spell's clauses, which
   * the test asserts in both directions.
   */
  readonly clause: string;
  /** Fiction the engine should never decide, or the shape that blocks it. */
  readonly why: 'table' | ShapeId;
  readonly note: string;
}

/**
 * Why each mechanical clause in an executed spell is not executed.
 *
 * Keyed by spell id and sorted, because this is a list two branches both
 * append to — the same reason `VERIFIED_SPELLS` and the catalogue are sorted.
 */
const ADJUDICATED: Readonly<Record<string, readonly Adjudication[]>> = {
  'animal-friendship': [
    {
      clause: 'ending early if you or an ally damages',
      why: 'a-casting-ended-by-a-trigger',
      note: 'The engine records who dealt the damage and which side they are on, and no casting can ask to be ended when that happens — so the Beast stays friendly for its full day however hard the party hits it.',
    },
  ],
  'arcane-sword': [
    {
      clause: 'to a spot you can see',
      why: 'table',
      note: 'SRD: "move the sword up to 30 feet to a spot you can see". Sight here is a declared fact from one creature to another — `sight-declared` names a `from` and a `to`, both creatures — and a destination is a coordinate. There is no pairwise declaration for the relocation to read and nothing it could read instead, so this is the line declared cover and declared sight already draw: the DM says what the caster can see, and the engine measures the thirty feet.',
    },
  ],
  banishment: [
    {
      clause: 'leaving the battlefield for a demiplane',
      why: 'a-second-place-to-put-a-creature',
      note: 'SRD: "be transported to a harmless demiplane for the duration", and "While there, the target has the Incapacitated condition." There is one scene, so the target is left Incapacitated where it stands — a position the spell does not give it, and one every area of effect and every ruler goes on reading.',
    },
    {
      clause: 'not returning if the spell runs',
      why: 'an-outcome-that-varies-by-creature-type',
      note: 'SRD: "If the target is an Aberration, a Celestial, an Elemental, a Fey, or a Fiend, the target doesn’t return if the spell lasts for 1 minute." The engine holds the type authoritatively and no effect reads it, and the casting’s own expiry carries no consequence either.',
    },
  ],
  'beacon-of-hope': [
    {
      clause: 'the maximum number of Hit Points',
      why: 'healing-modified-by-an-effect',
      note: 'SRD: "regains the maximum number of Hit Points possible from any healing." That is an instruction to the *next* healing roll, and `healCreature` rolls its dice with nothing standing beside it to maximise them.',
    },
  ],
  befuddlement: [
    {
      clause: 'stops the target casting spells',
      why: 'an-action-a-spell-compels-or-forbids',
      note: 'SRD: the target "can’t cast spells or take the Magic action". The action economy is the engine’s, and the only lever a spell has on it is a condition the engine names; forbidding one action and leaving the rest is a rider nothing expresses.',
    },
    {
      clause: 'end of every 30 days',
      why: 'a-repeat-save-beyond-the-turn-hook',
      note: 'A repeat save is raised by a turn boundary. This one runs on elapsed time, which `Deadline` can express and `RepeatSave` cannot, and the Greater Restoration that ends it sooner is the same missing hook from the other side.',
    },
  ],
  'black-tentacles': [
    {
      clause: 'the area is Difficult Terrain',
      why: 'difficult-terrain-an-area-creates',
      note: 'The engine charges Difficult Terrain exactly and takes it as declared feet on the move that crosses it, so an area that makes the ground difficult is invisible to the ruler and every move through the tentacles is charged as open floor.',
    },
  ],
  blight: [
    {
      clause: 'a Plant creature automatically fails',
      why: 'an-outcome-that-varies-by-creature-type',
      note: 'SRD: "A Plant creature automatically fails the save." The save is rolled by the engine and the type is held by the engine, and no effect lets the second decide the first.',
    },
  ],
  'blindness-deafness': [
    {
      clause: 'Deafened instead of Blinded',
      why: 'a-choice-made-at-the-casting',
      note: 'SRD: "it has the Blinded or Deafened condition (your choice) for the duration". The condition is a field on the effect, fixed when the definition was written, and a casting has nowhere to record which of the two this one chose.',
    },
  ],
  blur: [
    {
      clause: 'Blindsight or Truesight',
      why: 'senses-beyond-declared-sight',
      note: 'SRD: "An attacker is immune to this effect if it perceives you with Blindsight or Truesight." Sight is a pairwise declaration and there is nothing else, so every attacker takes the Disadvantage and a Truesight attacker takes it wrongly.',
    },
  ],
  'chain-lightning': [
    {
      clause: 'within 30 feet of the first target',
      why: 'targeting-rules-that-differ-within-one-casting',
      note: 'SRD: the later bolts leap to creatures "within 30 feet of the first target". The engine measures every named target from the caster against the spell’s own Range, so a bolt is allowed at 150 feet from the first target and refused at 35 from the caster.',
    },
    {
      clause: 'only the first target must be seen',
      why: 'targeting-rules-that-differ-within-one-casting',
      note: 'SRD requires sight of the first target only. One sight requirement is checked against every target named, so this casting demands four declared sight lines where the book demands one.',
    },
  ],
  'charm-monster': [
    {
      clause: 'the save has Advantage',
      why: 'a-mode-on-the-save-a-spell-forces',
      note: 'SRD: "It does so with Advantage if you or your allies are fighting it." Both facts are held — the sides are declared and the fight is in the log — and no modifier can be aimed at the saving throw a particular casting calls for.',
    },
    {
      clause: 'ends early if you or your allies damage',
      why: 'a-casting-ended-by-a-trigger',
      note: 'SRD: the Charmed condition lasts "until the spell ends or until you or your allies damage it". The damage event names its dealer and the sides are declared, and no casting can hang its ending on either.',
    },
  ],
  'charm-person': [
    {
      clause: 'the save has Advantage',
      why: 'a-mode-on-the-save-a-spell-forces',
      note: 'SRD: "It does so with Advantage if you or your allies are fighting it." The engine rolls that save itself and has no way to be told that this particular save is the one being helped.',
    },
    {
      clause: 'ends early if you or your allies damage',
      why: 'a-casting-ended-by-a-trigger',
      note: 'SRD: the Charmed condition lasts "until the spell ends or until you or your allies damage it". Nothing raises a casting’s obligation off a damage event, so the Charm outlasts the blow that the rules say broke it.',
    },
  ],
  'chill-touch': [
    {
      clause: 'cannot regain Hit Points',
      why: 'healing-modified-by-an-effect',
      note: 'SRD: "it can’t regain Hit Points until the end of your next turn." Healing is the engine’s arithmetic from end to end, and nothing can stand in front of it and refuse — so a Cure Wounds lands that the spell had forbidden.',
    },
  ],
  cloudkill: [
    {
      clause: 'the same save again when the Sphere moves',
      why: 'an-area-that-moves-by-itself',
      note: 'The three trigger clauses are exactly what `AreaTrigger` transcribes for Web and Moonbeam, and they are not written here because this Sphere is in the wrong place: writing the triggers on an area that does not drift would catch creatures where the cloud has already left.',
    },
    {
      clause: 'the Sphere moving 10 feet away',
      why: 'an-area-that-moves-by-itself',
      note: 'SRD: the Sphere "moves 10 feet away from you" at the start of each of your turns. An area moves today only because a caster spends an action on it or carries it; nothing moves one on the clock.',
    },
  ],
  compulsion: [
    {
      clause: 'the Bonus Action that designates a direction',
      why: 'an-action-a-spell-compels-or-forbids',
      note: 'SRD: "you can take a Bonus Action to designate a direction", and "Each Charmed target must use as much of its movement as possible to move in that direction on its next turn". Movement is spent through a command the mover sends, and no effect makes somebody else spend it.',
    },
    {
      clause: 'repeats after moving',
      why: 'a-repeat-save-beyond-the-turn-hook',
      note: 'The save is raised by the target having moved rather than by a turn boundary, and `RepeatSave` names a boundary and nothing else.',
    },
  ],
  'cone-of-cold': [
    {
      clause: 'a frozen statue',
      why: 'table',
      note: 'The engine owns the death and records it; what the corpse then looks like, and whether it ever thaws, is narration with no mechanical consequence the engine could read back. There is nothing here for a rule to decide.',
    },
  ],
  contagion: [
    {
      clause: 'the ability chosen at the cast',
      why: 'a-choice-made-at-the-casting',
      note: 'SRD: "choose one ability when you cast the spell", and "While Poisoned, the target has Disadvantage on saving throws made with the chosen ability." A `RollModifier` can already name Disadvantage on saves of a stated ability; what it cannot name is the ability this casting chose, because a casting has nowhere to record one.',
    },
    {
      clause: 'until three successes',
      why: 'a-repeat-save-beyond-the-turn-hook',
      note: 'Three successes end it and three failures fix it, so the save carries a running count — the death-save shape rather than the repeat-save one, and `RepeatSave` holds no tally.',
    },
    {
      clause: 'before any effect can end the Poisoned',
      why: 'a-repeat-save-beyond-the-turn-hook',
      note: 'SRD gates the *removal* of the condition behind a save, and a save is raised here only by a turn boundary; nothing puts one in front of another effect’s cure.',
    },
  ],
  disintegrate: [
    {
      clause: 'disintegrated to dust',
      why: 'an-outcome-of-a-spells-own-damage',
      note: 'Not an outcome rider, and the distinction is the whole reason this has a shape of its own: a rider rides the roll its host made, and this fires on a number the engine went on to compute from it — the target reaching 0 Hit Points. The gear turned to dust and the restriction on reviving it ride on the same missing branch.',
    },
  ],
  'dissonant-whispers': [
    {
      clause: 'spends its Reaction fleeing',
      why: 'an-action-a-spell-compels-or-forbids',
      note: 'SRD: it "must immediately use its Reaction, if available, to move as far away from you as it can, using the safest route". The Reaction and the movement are both real budgets, and nothing lets a spell spend somebody else’s.',
    },
  ],
  'divine-smite': [
    {
      clause: 'against a Fiend or an Undead',
      why: 'an-outcome-that-varies-by-creature-type',
      note: 'SRD: "The damage increases by 1d8 if the target is a Fiend or an Undead." The damage is assembled before the target is looked at, and no effect varies its dice by the type of the creature it lands on.',
    },
  ],
  'dominate-beast': [
    {
      clause: 'the save has Advantage',
      why: 'a-mode-on-the-save-a-spell-forces',
      note: 'SRD: "The target has Advantage on the save if you or your allies are fighting it." Nothing records what a save was against, so no grant can reach the one this casting forces.',
    },
    {
      clause: 'whenever it takes damage',
      why: 'a-repeat-save-beyond-the-turn-hook',
      note: 'SRD: "Whenever the target takes damage, it repeats the save, ending the spell on itself on a success." The save is raised by a damage event rather than by a boundary, and the turn hook is the only thing that raises one.',
    },
    {
      clause: 'the telepathic link',
      why: 'an-action-a-spell-compels-or-forbids',
      note: 'Issuing commands and spending your Reaction to make the dominated creature act are both somebody else’s action economy, which no effect can spend.',
    },
    {
      clause: 'higher-level slot lengthens the Concentration',
      why: 'a-duration-the-slot-changes',
      note: 'SRD prints 10 minutes at level 5, 1 hour at 6 and 8 hours at 7 and above. `durationSeconds` is one number, so a Dominate Beast cast at level 7 still ends after the level 4 minute.',
    },
  ],
  'dominate-monster': [
    {
      clause: 'the save has Advantage',
      why: 'a-mode-on-the-save-a-spell-forces',
      note: 'SRD: "The target has Advantage on the save if you or your allies are fighting it." The save this casting rolls has no identity a modifier could name.',
    },
    {
      clause: 'whenever it takes damage',
      why: 'a-repeat-save-beyond-the-turn-hook',
      note: 'SRD raises another Wisdom save each time the target takes damage; the engine raises repeat saves at turn boundaries and nowhere else.',
    },
    {
      clause: 'the telepathic link',
      why: 'an-action-a-spell-compels-or-forbids',
      note: 'Commanding the target, and spending your own Reaction to make it take one of its Reactions, are both somebody else’s budget to spend.',
    },
    {
      clause: 'higher-level slot lengthens the Concentration',
      why: 'a-duration-the-slot-changes',
      note: 'SRD prints 8 hours with a level 9 slot, and the definition carries one duration for every level it can be cast at.',
    },
  ],
  'dominate-person': [
    {
      clause: 'the save has Advantage',
      why: 'a-mode-on-the-save-a-spell-forces',
      note: 'SRD: "The target has Advantage on the save if you or your allies are fighting it." Both halves of that condition are facts the engine holds and cannot attach to a save.',
    },
    {
      clause: 'whenever it takes damage',
      why: 'a-repeat-save-beyond-the-turn-hook',
      note: 'A save raised by damage rather than by a boundary; the damage is recorded and nothing reads it as a moment a spell is owed something.',
    },
    {
      clause: 'the telepathic link',
      why: 'an-action-a-spell-compels-or-forbids',
      note: 'The commands the link carries are the target’s actions, and no effect spends another creature’s action economy.',
    },
    {
      clause: 'higher-level slot lengthens the Concentration',
      why: 'a-duration-the-slot-changes',
      note: 'SRD prints 10 minutes at level 6, 1 hour at 7 and 8 hours at 8 and above; one `durationSeconds` cannot say three numbers.',
    },
  ],
  'eldritch-blast': [
    {
      clause: 'the extra beams',
      why: 'several-attack-rolls-from-one-casting',
      note: 'SRD adds a beam at levels 5, 11 and 17, each its own attack roll and each able to take a different target. One casting rolls one attack per target here, so the cantrip is a third of itself at level 17.',
    },
  ],
  fear: [
    {
      clause: 'drops whatever it is holding',
      why: 'what-a-creature-is-holding',
      note: 'SRD: a creature that fails must "drop whatever it is holding". What a creature owns and what it has equipped are both real state, and nothing takes a weapon out of a hand.',
    },
    {
      clause: 'Dashes away from you',
      why: 'an-action-a-spell-compels-or-forbids',
      note: 'SRD compels the Dash action away from the caster each turn, and ends the Frightened condition on a save made when the target ends its turn out of line of sight. The Dash is a budget nothing else may spend; the sight-conditioned save is the turn hook’s missing half.',
    },
  ],
  'finger-of-death': [
    {
      clause: 'rises as a Zombie',
      why: 'a-stat-block-created-mid-fight',
      note: 'SRD: "A Humanoid killed by this spell rises at the start of your next turn as a **Zombie**", one "that follows your verbal orders". Nothing creates a creature from a stat block during play, which is the summons seam every Conjure waits on.',
    },
  ],
  'flame-blade': [
    {
      clause: 'letting go of the blade',
      why: 'what-a-creature-is-holding',
      note: 'SRD lets the caster drop the blade and evoke it again as a Bonus Action. Whether a hand is free, and what is in it, is not tracked — so there is no state the dropping and re-evoking could change.',
    },
  ],
  'freezing-sphere': [
    {
      clause: 'freezing a body of water',
      why: 'table',
      note: 'The Restrained applies to creatures swimming on water this spell froze, and there is no water: terrain and its state are the world the DM authors, not arithmetic the engine could get right or wrong. The condition is the DM’s to apply through `applyConditionTo`.',
    },
    {
      clause: 'holding the globe back',
      why: 'what-a-creature-is-holding',
      note: 'SRD lets the caster keep the globe in hand to be thrown or slung later, or left to detonate on its own. Nothing tracks what a creature is holding, so there is nowhere for an undetonated globe to sit.',
    },
  ],
  grease: [
    {
      clause: 'becoming Difficult Terrain',
      why: 'difficult-terrain-an-area-creates',
      note: 'The ruler charges Difficult Terrain by the declared foot and reads no area, so a creature walks across the grease at open-floor cost while the spell’s save is resolved exactly.',
    },
  ],
  guidance: [
    {
      clause: 'rather than only the one chosen skill',
      why: 'a-choice-made-at-the-casting',
      note: 'SRD: "You touch a willing creature and choose a skill", and the creature "adds 1d4 to any ability check using the chosen skill". The bonus is granted to the whole ability-check family instead, which is broader than the spell, and the clause says why: a per-casting choice has nowhere to be recorded.',
    },
  ],
  'guiding-bolt': [
    {
      clause: 'the next attack roll against the target',
      why: 'a-one-shot-roll-modifier',
      note: 'SRD: "the next attack roll made against it before the end of your next turn has Advantage." A durable grant applies until its casting ends; nothing is consumed by the roll it changes.',
    },
  ],
  harm: [
    {
      clause: 'Hit Point maximum reduction',
      why: 'a-hit-point-maximum-a-spell-moves',
      note: 'SRD: "its Hit Point maximum is reduced by an amount equal to the Necrotic damage it took", and "This spell can’t reduce a target’s Hit Point maximum below 1." The maximum is the engine’s own number, read by healing, by Massive Damage and by every threshold, and no effect moves it.',
    },
  ],
  'hideous-laughter': [
    {
      clause: 'the second Wisdom save each time the target takes damage',
      why: 'a-repeat-save-beyond-the-turn-hook',
      note: 'SRD: "At the end of each of its turns and each time it takes damage, it makes another Wisdom saving throw." The turn boundary is exactly what `RepeatSave` names and is rolled; a save raised by a **trigger** is not, and nor is the Advantage that one carries.',
    },
    {
      clause: 'unable to end the Prone condition on itself',
      why: 'an-action-a-spell-compels-or-forbids',
      note: 'SRD: "it can\u2019t end the Prone condition on itself." Standing up is something a creature does and the engine does not model it as an action a spell can forbid, so the Prone is lifted by the spell ending and by nothing this clause could stop.',
    },
  ],
  'hypnotic-pattern': [
    {
      clause: 'only a creature that can see the pattern',
      why: 'an-area-that-filters-its-catch',
      note: 'An area catches every creature standing in it. SRD affects only those that can see the pattern, so a blindfolded creature in the Cube is Charmed here and is not Charmed in the book.',
    },
    {
      clause: 'Speed of 0 that rides along',
      why: 'speed-and-movement-modes',
      note: 'The Charmed and the Incapacitated are both imposed by the one Wisdom save the spell rolls. What is left of the sentence is the Speed, and it is the Speed that is missing rather than the branch: SRD says "a Speed of 0", the engine holds one `baseSpeed` and nothing sets it.',
    },
    {
      clause: 'ending for a creature that takes damage',
      why: 'a-casting-ended-by-a-trigger',
      note: 'SRD ends the effect on a creature that takes damage or is shaken awake. The damage is recorded and no casting can be told to release that creature when it lands.',
    },
  ],
  'ice-storm': [
    {
      clause: 'becomes Difficult Terrain',
      why: 'difficult-terrain-an-area-creates',
      note: 'SRD leaves the ground difficult "until the end of your next turn" — a deadline the engine can express over an area it cannot, because terrain reaches the ruler only as declared feet on a move.',
    },
  ],
  'incendiary-cloud': [
    {
      clause: 'the same save again when the Sphere moves',
      why: 'an-area-that-moves-by-itself',
      note: 'The trigger clauses are the ones `AreaTrigger` already transcribes, and writing them on a cloud that never drifts would raise saves at a place the cloud should have left. The drift is what blocks them.',
    },
    {
      clause: 'the cloud moving 10 feet away',
      why: 'an-area-that-moves-by-itself',
      note: 'SRD moves the cloud 10 feet in a direction the caster chooses at the start of each of their turns — a chosen direction where Cloudkill’s is derived, which is why the two do not even share a command.',
    },
  ],
  'insect-plague': [
    {
      clause: 'Lightly Obscured and Difficult Terrain',
      why: 'difficult-terrain-an-area-creates',
      note: 'The swarm’s saves and damage all run; the ground it stands on costs nothing extra to cross, because Difficult Terrain reaches the ruler only as feet a move declares.',
    },
  ],
  invisibility: [
    {
      clause: 'ends early immediately after the target makes an attack roll',
      why: 'a-casting-ended-by-a-trigger',
      note: 'SRD: "The spell ends early immediately after the target makes an attack roll, deals damage, or casts a spell." The engine emits all three — an attack roll, damage naming its dealer, a `spell-cast` — and no casting can ask to be ended when one arrives, so the invisibility runs its full hour. It is the whole of the difference between this spell and Greater Invisibility, which prints the sentence and nothing else.',
    },
  ],
  'lesser-restoration': [
    {
      clause: 'a condition chosen at the casting has nowhere to be recorded',
      why: 'a-choice-made-at-the-casting',
      note: 'SRD: "end one condition on it: Blinded, Deafened, Paralyzed, or Poisoned." One of four, and the caster picks — so a creature both Blinded and Poisoned is fully cured of both, where the book cures one. It is the same gap Blindness/Deafness carries from the other side, where the choice is between imposing two rather than lifting one.',
    },
  ],
  'mage-armor': [
    {
      clause: 'if the target dons armor',
      why: 'a-casting-ended-by-a-trigger',
      note: 'Equipping is an event the engine emits, and no casting can ask to end when one arrives. The Armour Class is right either way — the granted calculation is inert while armour is worn — and the casting goes on running and stays dispellable.',
    },
  ],
  'mass-suggestion': [
    {
      clause: 'ends on a target when you or your allies deal it damage',
      why: 'a-casting-ended-by-a-trigger',
      note: 'The damage half is a trigger the engine holds every fact for and raises nothing from; the completed activity beside it is the table’s, and both end the spell on that one target.',
    },
    {
      clause: 'higher-level slot lengthens the duration',
      why: 'a-duration-the-slot-changes',
      note: 'SRD prints 10 days at level 7, 30 days at 8 and 366 days at 9, and the definition carries the one duration its own level prints.',
    },
  ],
  'mind-spike': [
    {
      clause: 'knowing the target',
      why: 'a-condition-benefit-an-effect-takes-away',
      note: 'Knowing where the target is stays the table’s: the engine holds no knowledge model and sight is a declaration, so a DM who declares the sight has said the whole of that half. The rest is not. Invisible’s attack halves read declared sight, but `initiativeConditionModes` grants its Initiative Advantage from the condition’s presence alone, so for an hour a target the spike has found goes on rolling Initiative with an Advantage the SRD took away from it, decided by the engine and reachable by no declaration.',
    },
  ],
  moonbeam: [
    {
      clause: 'shape-shifted creature reverting',
      why: 'table',
      note: 'A creature’s form is not held anywhere: Wild Shape and every other shape-change is a `manual` feature a DM applies, so there is no form for a failed save to revert and nothing the engine resolves arrives at one.',
    },
  ],
  'phantasmal-killer': [
    {
      clause: 'the Wisdom save at the end of each',
      why: 'a-repeat-save-beyond-the-turn-hook',
      note: 'The boundary is one `RepeatSave` already names; what it cannot do is deal damage on the failure, because a repeat save releases effects and rolls nothing else.',
    },
    {
      clause: 'a successful save ends the spell',
      why: 'a-repeat-save-beyond-the-turn-hook',
      note: 'The ending itself is expressible — `onSuccess: end-casting` exists — and it has no save to ride on, because the repeat save that would carry it deals damage the hook cannot roll.',
    },
  ],
  'protection-from-poison': [
    {
      clause: 'Advantage on saving throws to avoid or end the Poisoned condition',
      why: 'a-save-keyed-to-a-condition',
      note: 'SRD: "the target has Advantage on saving throws to avoid or end the Poisoned condition". A `RollModifier` selects a save by ability and by nothing else, so the nearest sayable thing is Advantage on every Constitution save the target ever makes — which is a different and much larger spell. The engine rolls those saves without it.',
    },
    {
      clause: 'has Resistance to Poison damage',
      why: 'a-defence-a-spell-grants',
      note: 'SRD: "it has Resistance to Poison damage". Resistance is read off `CreatureState.defenses`, which is written when a creature enters the game, and no effect adds to it for a while — so every point of Poison damage during the hour lands in full.',
    },
  ],
  'ray-of-frost': [
    {
      clause: 'Speed is reduced by 10 feet',
      why: 'speed-and-movement-modes',
      note: 'SRD: "its Speed is reduced by 10 feet until the start of your next turn." A creature has one `baseSpeed` and no effect moves it, so the ray hits for full damage and slows nobody.',
    },
  ],
  shatter: [
    {
      clause: 'a Construct has Disadvantage',
      why: 'a-mode-on-the-save-a-spell-forces',
      note: 'SRD: "A Construct has Disadvantage on the save." Two things are missing at once and the first blocks the second: no modifier can name the save a casting forces, and no effect varies by the target’s creature type.',
    },
  ],
  shield: [
    {
      clause: 'Magic Missile',
      why: 'damage-with-neither-an-attack-roll-nor-a-save',
      note: 'Being targeted by Magic Missile is the spell’s second trigger and taking no damage from it is its second benefit, and neither can exist while the spell they name cannot be cast: its darts hit with no attack roll and no save.',
    },
  ],
  'shocking-grasp': [
    {
      clause: 'cannot make Opportunity Attacks',
      why: 'an-action-a-spell-compels-or-forbids',
      note: 'SRD: the target "can’t make Opportunity Attacks until the start of its next turn". The engine offers and spends that Reaction itself, and nothing forbids one action while leaving the rest of the budget alone.',
    },
  ],
  'spirit-guardians': [
    {
      clause: 'halved Speed',
      why: 'a-standing-effect-derived-from-where-a-creature-stands',
      note: 'SRD halves the Speed of every affected creature inside the Emanation. Mutating a base Speed as creatures enter and leave is correct only while every pair of events stays matched, and nothing derives a value from where a creature is standing.',
    },
  ],
  'starry-wisp': [
    {
      clause: 'cannot benefit from the Invisible',
      why: 'a-condition-benefit-an-effect-takes-away',
      note: 'The Dim Light is the table’s, because light is not modelled. Taking the benefit away is not: the attack halves of Invisible read declared sight and a DM can answer those, while `initiativeConditionModes` grants its Initiative Advantage from the condition’s presence alone — so a creature the wisp has lit still rolls Initiative with Advantage, and no declaration exists that would stop it.',
    },
  ],
  suggestion: [
    {
      clause: 'ends early when you or your allies deal damage',
      why: 'a-casting-ended-by-a-trigger',
      note: 'The engine knows who dealt the damage and whose side they are on, and no casting can be told to end when that happens; the completed activity in the same sentence really is the table’s.',
    },
  ],
  sunbeam: [
    {
      clause: 'creates a new Line on a later turn',
      why: 'an-activation-that-resolves-an-area',
      note: 'SRD lets the caster take a Magic action on a later turn to launch the beam again. An activation resolves an attack at a named target and moves an area along a stated route; resolving a fresh area in a direction chosen now is the shape Call Lightning waits on too.',
    },
  ],
  sunburst: [
    {
      clause: 'dispelling magical Darkness',
      why: 'table',
      note: 'Ending a casting is a real operation — `spell-ended` and Dispel Magic both use it — and there is no Darkness casting for it to reach, because light is not modelled and the spell compiles into no definition. A clause with no reachable case is documented rather than modelled, exactly as Counterspell’s components qualifier is — and, like that one, the fact that makes it safe is pinned by a test below rather than trusted.',
    },
  ],
  thunderwave: [
    {
      clause: 'pushed 10 feet away',
      why: 'forced-movement-a-spell-causes',
      note: 'SRD: "is pushed 10 feet away from you" on a failed save. `moveCreature` already takes `forced: true` and reports whose space is being shared; no spell effect reaches it, so the wave deals its damage and moves nobody.',
    },
  ],
  'vampiric-touch': [
    {
      clause: 'goes unchecked',
      why: 'targeting-rules-that-differ-within-one-casting',
      note: 'The spell’s printed Range is Self, which is what the targeting rules read, and the five feet belong to the attack rather than to the spell. Every later use of the casting checks the reach; the attack made at the moment of casting does not.',
    },
  ],
  'vicious-mockery': [
    {
      clause: 'next attack roll before the end of its next turn',
      why: 'a-one-shot-roll-modifier',
      note: 'SRD: the target must succeed on the save or "have Disadvantage on the next attack roll it makes before the end of its next turn". Nothing here is consumed by the roll it changes — a durable grant runs until its casting ends — so the Disadvantage is not granted at all.',
    },
  ],
  web: [
    {
      clause: 'while in the webs',
      why: 'a-condition-that-ends-when-its-holder-leaves-an-area',
      note: 'SRD Restrains a creature "while in the webs". A condition ends with its casting, on a deadline, or on a save; ending because its holder walked out of an area is a lifetime nothing expresses, so it runs until the casting ends or the creature breaks free.',
    },
    {
      clause: 'the webs are Difficult Terrain',
      why: 'difficult-terrain-an-area-creates',
      note: 'Every save the webs call for is raised and resolved; crossing them costs the same as crossing an empty floor, because Difficult Terrain reaches the ruler only as declared feet on a move.',
    },
    {
      clause: 'flammable',
      why: 'table',
      note: 'Whether anybody sets the webs alight is a decision the fiction makes and the engine has no path to: nothing in it starts a fire, and the 2d4 the burning cube deals is damage a DM applies through `resolveDamage` like any other consequence they narrate.',
    },
  ],
  weird: [
    {
      clause: 'deals 5d10 Psychic damage again',
      why: 'a-repeat-save-beyond-the-turn-hook',
      note: 'SRD repeats the Wisdom save at the end of each of the target’s turns, dealing 5d10 Psychic damage again on a failure and ending the spell on that target on a success. The boundary and the ending are expressible; the damage at a boundary is not.',
    },
  ],
};

/**
 * The SRD's own prose for every spell, read off disk.
 *
 * The same reader `spell-tracking.test.ts` and `coverage.test.ts` use, for the
 * same reason: `SPELL_INDEX` carries a spell's id, level, school and class list
 * and deliberately not its description, because the engine is pure and cannot
 * read a file at runtime. A test can, and what is being checked is the book.
 */
const PROSE: ReadonlyMap<string, string> = new Map(
  (
    JSON.parse(
      readFileSync(
        fileURLToPath(new URL('../../srd/src/generated/spells.json', import.meta.url)),
        'utf8',
      ),
    ) as readonly { id: string; description: string; higherLevel?: string }[]
  ).map((spell) => [spell.id, `${spell.description}\n${spell.higherLevel ?? ''}`]),
);

/** The mechanics this clause names. */
const markersIn = (clause: string): readonly MarkerId[] =>
  CLAUSE_MARKERS.filter(([, pattern]) => pattern.test(clause)).map(([marker]) => marker);

const clausesOf = (spellId: string): readonly string[] =>
  SPELL_DEFINITIONS.find((d) => d.id === spellId)?.unmodelled ?? [];

/** The clauses of this spell that name a mechanic the engine owns. */
const mechanicalClausesOf = (spellId: string): readonly string[] =>
  clausesOf(spellId).filter((clause) => markersIn(clause).length > 0);

const entriesFor = (spellId: string): readonly Adjudication[] => ADJUDICATED[spellId] ?? [];

const matching = (entry: Adjudication, clauses: readonly string[]): readonly string[] =>
  clauses.filter((clause) => clause.includes(entry.clause));

describe('an executed spell may not file a rule the engine owns as fiction', () => {
  it('has markers that actually fire, so the rule below is not vacuous', () => {
    // The clauses the audit read as debt, each firing on the mechanic it names.
    expect(markersIn('the target cannot regain Hit Points until the end of your next turn')).toContain(
      'hit-points',
    );
    expect(markersIn('the save has Advantage if you or your allies are fighting the target')).toContain(
      'roll-mode',
    );
    expect(markersIn('the Hit Point maximum reduction equal to the damage taken')).toContain(
      'hit-points',
    );
    expect(
      markersIn('the next attack roll against the target before the end of your next turn has Advantage'),
    ).toContain('attack-roll');
    expect(markersIn('the area is Difficult Terrain for the duration')).toContain(
      'difficult-terrain',
    );
    expect(markersIn('an attacker that perceives the target with Blindsight or Truesight')).toContain(
      'senses',
    );
  });

  /**
   * And the other direction, which is what keeps the marker list from becoming
   * a demand that every sentence be justified: a clause naming nothing the
   * engine owns is left alone.
   */
  it('leaves the fiction alone', () => {
    expect(markersIn('the mote of radiance that sheds sunlight for the duration')).toEqual([]);
    expect(
      markersIn('what the force looks like — "a weapon of your choice" — is narration'),
    ).toEqual([]);
    const quiet = EXECUTED.flatMap((id) =>
      clausesOf(id).filter((clause) => markersIn(clause).length === 0),
    );
    expect(quiet.length).toBeGreaterThan(10);
  });

  it.each(EXECUTED.map((s) => [s] as const))(
    'has a written adjudication for every mechanical clause in %s',
    (spellId) => {
      const entries = entriesFor(spellId);
      for (const clause of mechanicalClausesOf(spellId)) {
        const written = entries.filter((entry) => clause.includes(entry.clause));
        expect(
          written.length,
          `${spellId}: no adjudication for a clause naming ${markersIn(clause).join(', ')} — "${clause}"`,
        ).toBe(1);
      }
    },
  );

  /**
   * A stale exemption is the same failure wearing the other face: a clause
   * that once said something mechanical, no longer does, and keeps a licence
   * for it. An entry must match exactly one clause, and that clause must still
   * be one that names a mechanic.
   */
  it('carries no adjudication for a clause that is gone or is no longer mechanical', () => {
    for (const [spellId, entries] of Object.entries(ADJUDICATED)) {
      for (const entry of entries) {
        const hit = matching(entry, mechanicalClausesOf(spellId));
        expect(hit.length, `${spellId}: "${entry.clause}" matches ${hit.length} clauses`).toBe(1);
      }
    }
  });

  /** And every adjudicated spell is one the catalogue actually executes. */
  it('adjudicates only spells that are executed', () => {
    expect(Object.keys(ADJUDICATED).filter((id) => !EXECUTED.includes(id))).toEqual([]);
  });

  /** In an order two branches can both append to, like every other list here. */
  it('names them in an order two branches can both append to', () => {
    const ids = Object.keys(ADJUDICATED);
    expect(ids).toEqual([...ids].sort());
  });

  /**
   * The half that makes this more than a comment box: a clause that is not the
   * table's must name an enumerated missing shape, and adding one means adding
   * to a reviewed list that says where the repository already described it.
   */
  it('names an enumerated shape for every clause that is not the table’s', () => {
    for (const [spellId, entries] of Object.entries(ADJUDICATED)) {
      for (const entry of entries) {
        if (entry.why === 'table') continue;
        expect(Object.keys(MISSING_SHAPES), `${spellId}/${entry.clause}`).toContain(entry.why);
      }
    }
  });

  /** A note that says nothing is a licence, so each must be a real sentence. */
  it('writes a real sentence for every adjudication', () => {
    for (const [spellId, entries] of Object.entries(ADJUDICATED)) {
      for (const entry of entries) {
        expect(entry.note.length, `${spellId}/${entry.clause}`).toBeGreaterThan(60);
      }
    }
  });

  /** No shape may sit in the map unclaimed, or the map becomes a wish list. */
  it('keeps no shape nothing is blocked on', () => {
    const claimed = new Set(
      Object.values(ADJUDICATED).flatMap((entries) => entries.map((entry) => entry.why)),
    );
    expect(Object.keys(MISSING_SHAPES).filter((shape) => !claimed.has(shape as ShapeId))).toEqual(
      [],
    );
  });

  /**
   * A shape must say **where this repository already described the gap**, and
   * that has to be checkable rather than promised.
   *
   * The rule is the interesting half of the whole map: a shape invented in a
   * note is an architecture decision smuggled past review, and the only thing
   * standing between this list and that is whether each entry can point at
   * prose somebody already reviewed. A docstring saying so is the claim
   * `spell-tracking.test.ts` learned not to trust when it started asserting
   * `engine` in both directions. Four places count, and `spell-definitions.ts`
   * is one of them because a definition's own clause is where several of these
   * gaps were first written down.
   */
  it('makes every shape point at prose somebody already reviewed', () => {
    const sources = ['claude.md', 'progress.md', 'the audit', 'spell-definitions.ts'];
    for (const [shape, description] of Object.entries(MISSING_SHAPES)) {
      const said = description.toLowerCase();
      expect(
        sources.filter((source) => said.includes(source)),
        `${shape} names no place this repository already described it`,
      ).not.toEqual([]);
    }
  });

  /**
   * The one adjudication that is true only while another spell is uncastable.
   *
   * Sunburst "dispels magical Darkness in the area", and ending a casting is an
   * operation the engine really has — `spell-ended`, and Dispel Magic through
   * it. What makes that clause the table's is not the rule but the population:
   * no Darkness definition compiles in, so there is no casting for it to reach.
   * That is exactly Counterspell's components qualifier, and that one is safe
   * because `counterspell.test.ts` pins the count that makes it so. This is the
   * same pin. The day Darkness gets a definition — tracked or executed — it
   * becomes an ongoing casting the engine can end, the clause becomes debt, and
   * this fails rather than going quietly on calling a rule fiction.
   */
  it('pins the fact that makes Sunburst’s dispel clause the table’s', () => {
    const dispelled = SPELL_DEFINITIONS.filter((d) => d.id === 'darkness');
    expect(
      dispelled,
      'Darkness now has a definition, so Sunburst dispelling it is a casting the engine could end',
    ).toEqual([]);
    expect(
      ADJUDICATED['sunburst']?.find((entry) => entry.clause === 'dispelling magical Darkness')?.why,
    ).toBe('table');
  });

  /**
   * And where a note quotes the book, it quotes the book.
   *
   * Found by review: four notes attributed to the SRD a sentence it does not
   * print — Dominate's repeat save, and Charm Person's Advantage clause wearing
   * Dominate's wording. That is the file's own subject failing inside the file,
   * and it is exactly the class of error `coverage.test.ts` already oracles for
   * a definition's printed fields. The quotation is checked against **this**
   * spell's paragraph, because a sentence some other spell prints is the way a
   * neighbouring clause gets lent to a spell that never had it.
   */
  it('quotes the SRD exactly, and quotes the right spell', () => {
    const normalise = (text: string) =>
      text
        .replace(/[‘’]/g, "'")
        .replace(/[“”]/g, '"')
        .replace(/\s+/g, ' ')
        .trim();

    for (const [spellId, entries] of Object.entries(ADJUDICATED)) {
      const printed = normalise(PROSE.get(spellId) ?? '');
      expect(printed.length, `${spellId} is not in the parsed SRD`).toBeGreaterThan(0);
      for (const entry of entries) {
        if (!entry.note.includes('SRD')) continue;
        for (const quoted of entry.note.match(/"[^"]{8,}"/g) ?? []) {
          const fragment = normalise(quoted.slice(1, -1));
          expect(
            printed.includes(fragment),
            `${spellId} quotes "${fragment}", which its SRD paragraph does not print`,
          ).toBe(true);
        }
      }
    }
  });
});

/**
 * Partial is a consequence, not a list.
 *
 * A spell carrying a shape adjudication is one the engine drives and does not
 * finish, which is exactly what the third coverage state claims. Asserting the
 * hand list against the derived set in **both** directions is what stops the
 * report and the debts drifting apart: a clause newly adjudicated to a shape
 * fails the table until `PARTIAL_SPELLS` says so, and an entry that no longer
 * carries a debt fails until it is removed.
 *
 * The list stays in `coverage.ts` rather than being derived there, because
 * `npm run coverage` runs the script outside vitest and importing this file
 * would make the report generator depend on the test suite.
 */
describe('the partial set is derived from the debts', () => {
  const derived = Object.entries(ADJUDICATED)
    .filter(([, entries]) => entries.some((entry) => entry.why !== 'table'))
    .map(([spellId]) => spellId)
    .sort();

  it('has some, so the rule below is not vacuous', () => {
    expect(derived.length).toBeGreaterThan(0);
  });

  it('is exactly what the coverage script publishes', () => {
    expect([...PARTIAL_SPELLS].sort()).toEqual(derived);
  });

  /** Spirit Guardians was the hand list's only entry, and is still partial. */
  it('keeps the spell the third state was invented for', () => {
    expect(derived).toContain('spirit-guardians');
  });

  /** A spell whose every clause is the table's is finished, not partial. */
  it('leaves a spell whose clauses are all fiction out of it', () => {
    const allTable = Object.entries(ADJUDICATED)
      .filter(([, entries]) => entries.every((entry) => entry.why === 'table'))
      .map(([spellId]) => spellId);
    expect(derived.filter((id) => allTable.includes(id))).toEqual([]);
  });
});
