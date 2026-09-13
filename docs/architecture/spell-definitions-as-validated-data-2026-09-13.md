# Definitions describe mechanics; the software handles truth

Design note for the definitions-as-validated-data pass, from the comparative
architecture audit's recommendations #3 (definitions as data), #4
(outcome-scoped effects) and #6 (SRD as oracle). Written before the code, as
`CLAUDE.md` asks.

## 0. The finding that changes the shape of this pass

The audit's recommendation #3 reads *"move spell and feature definitions out of
TypeScript into validated data files; the current unions become the zod
schema."* Read against the code rather than the line count, that sentence
contains two claims and only one of them is true.

**What is true:** `spell-definitions.ts` is 5,511 lines in one file with two
owners, a merge hazard `CONTRIBUTING.md` has a playbook for, and **nothing
validates a definition at runtime**. The TypeScript compiler is the only guard,
so a definition that does not arrive through `tsc` — authored by a DM, loaded
from a file, proposed by a model — has nothing to check it at all.

**What is not true:** that the definitions are code. They are not. Measured:

| | Count |
|---|---|
| `SpellDefinition` constants | 125 |
| ...that are pure data (no function, no expression, no hook) | **125** |
| ...that carry a code hook the runtime calls | **0** |
| Spell-name special cases in the runtime (`spellId === '…'`) | **0** |

The runtime reads the closed typed unions and nothing else. So this is not a
"content is the program" problem like Avrae's; the representation is already
declarative. **What is missing is the validator, not the format.** Converting
125 object literals to JSON would move the same data into a file that cannot
hold the SRD text each definition is transcribed from — and that text, quoted
in the docstring, is the provenance `PROGRESS.md` relies on.

So the pass builds the missing halves and does not move the file.

## 1. The audit, question by question

### 1. How are spell definitions represented today?

125 `export const X: SpellDefinition` object literals in one module, collected
into a sorted `SPELL_DEFINITIONS` array and looked up by `definitionFor(id)`.
Closed typed unions: `SpellEffect` (11 members), `SpellArea` (6), `TargetRule`,
`AreaTrigger`, `CastingOrigin`, `SpellActivation`, `SpellCheck`, `DiceScaling`.
Every field is a literal; the SRD text each was transcribed from is quoted in
the docstring above it.

### 2. How many are data / partly declarative / bespoke logic?

125 / 0 / 0. See §0.

### 3. Which fields and primitives recur?

| Field | Definitions carrying it |
|---|---|
| `id`, `name`, `level`, `school`, `castingTime`, `concentration`, `range`, `targets`, `effects` | 125 (100%) |
| `unmodelled` | 101 |
| `durationSeconds` | 70 |
| `requiresSight` | 28 |
| `area` | 25 |
| `areaTrigger` | 6 |
| `activation` | 4 |
| `trigger` | 3 |
| `check` | 3 |
| `replacesPriorCasting`, `targetsWithin` | 2 |
| `durationUntil`, `designatesUnaffected`, `damageTypeStated`, `origin` | 1 |

Effect kinds, counted across `effects`, `activation.effects` and
`areaTrigger.effects`: `save-damage` 38, `save` 19, `attack` 15, `buff` 5,
`heal` 4, then one each of `temp-hp`, `attack-damage`, `dispel`,
`interrupt-casting`. Forty uses of the rider fields (`condition`, `plus`,
`delayed`, `check`, `addSpellcastingModifier`, `healsCasterForHalf`).

### 4. Which mechanics cannot be represented declaratively?

`PROGRESS.md`'s ranked map is the authoritative list and is unchanged by this
pass. The nearest ones: standing Advantage or Disadvantage a spell grants (25
spells), a condition applied with no saving throw (9), Resistance or Immunity a
spell grants (17), teleportation (13), damage with neither attack nor save
(19), an Armour Class a spell sets (~4), summons (9), walls and multi-area
templates, slot-dependent Concentration, an area that excludes its caster.

Every one of these needs a **new typed effect member or a new engine
primitive** — none is unlocked by changing where the definitions live. That is
the measurement that sets this pass's priorities.

### 5. What does the creature path teach?

`author_creature` on the probe surface already lets a DM define a creature at
runtime and have the engine treat the definition as truth. Three properties
make that safe, and all three are the design brief for spell definitions:

- every mechanically load-bearing field is **required** at authorship
  (`creature_type`, `max_hp`, `armor_class`, abilities, speed) — nothing is
  defaulted on the DM's behalf;
- the boundary validates, and what is authored becomes established truth that
  later narration may not contradict (`type_established`);
- identity is the key, so a retry is a no-op.

What it does **not** have is a schema object: validation is hand-written
`str()` / `num()` accessors in the tool surface throwing `BadInput`. That is
the gap a shared, pure validator closes — and the reason the validator belongs
in the engine rather than in a tool.

### 6. What structured SRD 5.2 content exists?

`packages/srd/src/generated/spells.json`, 339 spells, zod-validated by
`SpellSchema`: `id`, `name`, `level`, `school`, `classes`, `castingTime`,
`ritual`, `range`, `components`, `duration`, `concentration`, `description`,
`higherLevel`. Also monsters, gear, weapons, armour, tools. The `dnd5e` and
`avrae` repositories the comparative audit read are **no longer in this
workspace**, so the oracle here is SRD 5.2.1 itself, which is the better basis
anyway: it is the engine's own declared basis and needs no licence review.

### 7. Which SRD fields are reliable as an oracle, and which are prose?

Measured across all 339 parsed spells:

| Field | Distinct values | Verdict |
|---|---|---|
| `level`, `school`, `name`, `classes`, `concentration`, `ritual` | — | **structured**; already oracled by `coverage.test.ts` for the first four |
| `castingTime` | small, prefixed | **structured enough**; already oracled |
| `range` | **18** strings: `Self`, `Touch`, `N feet`, `N mile(s)`, and four specials | **structured enough**; *not oracled today* |
| `duration` | **24** strings: `Instantaneous`, `[Concentration, up to / Up to] N unit`, `Until dispelled[ or triggered]`, `Special` | **structured enough**; *not oracled today* |
| `description`, `higherLevel` | free English | **prose**: damage dice, save ability, area shape and size, conditions and scaling all live here and none is structurally recoverable |

So two whole fields are mechanically checkable and unchecked — and
`PROGRESS.md` already names the duration as "the field with no automatic
check", the blind spot that let Fire Bolt throw 2d10 and Finger of Death drop
its flat 30.

Area shape and size are **not** recoverable: SRD 5.2.1 prints plain ranges
(`Self`, `120 feet`) and puts the template in the sentence. Anything claiming
to oracle an area would be parsing English and pretending it was data.

### 8. Where should validation occur?

Three places, three different jobs, and conflating them is how "valid" comes to
mean "in the book":

| Where | What it checks | Applies to |
|---|---|---|
| **Authoring / load** | schema validity: shape, closed vocabularies, cross-field coherence | **any** definition, SRD or homebrew |
| **Build / test** | SRD conformance: does this definition agree with the printed spell | only definitions whose id is a spell in the book |
| **Runtime (unchanged)** | this casting, in this world: range, slot, sight, type, action | every cast |

The engine is pure and may not read a file, so the validator is a pure function
over a value and the *reading* belongs to whoever supplies the definition. The
oracle reads `generated/spells.json` from a test, exactly as
`spell-tracking.test.ts` and `coverage.test.ts` already do.

### 9. How should unsupported clauses stay visible?

The mechanism already exists and is better than anything the reference
implementations have: `unmodelled` is reported in `unverified` on **every
casting**, and `spell-tracking.test.ts` scans each tracked spell's own SRD
prose for thirteen mechanical markers and demands a written, enumerated
adjudication for each hit. This pass extends rather than replaces it: the
oracle's own exemptions are held to the same standard — a definition that
disagrees with the book must say why, in a list somebody reviews, and a stale
exemption fails.

### 10. The smallest architecture change

Four things, in the order they pay:

1. **A pure validator** (`spell-schema.ts`) — the missing half. It puts the
   cross-field invariants in one place instead of scattered across four test
   files, and it is what makes a definition *data* rather than *TypeScript*:
   it validates a value, not a compilation.
2. **An SRD oracle over range and duration** — two whole fields, 125
   definitions, currently unchecked.
3. **Area anchoring as a declared field**, so the geometry pass's one bit of
   information has a home in data before the next area family encodes it in
   runtime logic.
4. **One new typed effect primitive — an Armour Class a spell sets** — which is
   what Mage Armor needs and what Tier 2 hit live.

Everything else the audit lists is a separate pass with its own evidence.

## 2. What is deliberately not built, and why

**Definitions do not move into `GameState`.** Making `definitionFor` read
authored definitions out of state is what would let a homebrew spell actually
be *cast*. It is twelve call sites, two helpers inside the fold
(`areaDefinitionOf`, `creaturesInCastingArea`), one event, one state field and
one validating command — and its only user is authorship, which this pass is
told not to expose. The doctrine's generalization rule settles it: one user is
not evidence. It is recorded as a named seam, with its cost, so the next pass
does not have to rediscover it.

The consequence, stated plainly: **a non-SRD definition can be validated today
and cannot be cast today.** Schema validity and executability are different
things, and this pass delivers the first.

**Definitions do not move to JSON.** See §0. The format is not the problem, and
JSON cannot hold the SRD quotation that is each definition's provenance.

**Outcome-scoped child effects are deferred** — see §5.

**`SpellEffect.damageType` stays `string`.** Narrowing it to `DamageType`
ripples through `damageTypeStated`, `applyDamage`'s keys and the monster
adapter, which is a typing pass rather than a definitions pass. The validator
checks the value instead, which catches the same error at the same place a
homebrew definition would make it.

## 3. The validator

`checkSpellDefinition(definition)` returns **every** problem with a `field` on
each — the shape `checkCharacter` already uses, for the same reason: somebody
authoring a definition does not want to be told about one mistake at a time.
`parseSpellDefinition(value: unknown)` is the same thing over untyped input,
returning the first problem as an ordinary `Result` error.

Every invariant below was run against all 125 definitions before it was
written, and none fires. They are the rules the catalogue already obeys,
written down where a new definition meets them.

| Code | Rule | Why it is a rule and not a taste |
|---|---|---|
| `bad_id` | `^[a-z0-9-]+$` | the id is the join to the parsed book |
| `forged_casting_link` | the name may not contain `#` | `castingSource` encodes `Spell#cast:3`; a `#` in a name forges the link. Refused at runtime today; this catches it at authoring |
| `bad_level`, `unknown_school` | 0–9; one of the eight | |
| `unknown_damage_type` | every `damageType` in `DAMAGE_TYPES` | the field is typed `string` |
| `unknown_condition` | every condition name in `CONDITIONS` | untyped input only |
| `bad_dice` | every notation parses | `scaledDiceFor` splits on `d` and would silently produce `NaNd6` |
| `slot_scaling_on_cantrip` | a cantrip has no `perSlotLevelAbove` / `extraPerSlotLevelAbove` / `flatPerSlotLevelAbove` | a cantrip has no slot to scale with; `scaledDiceFor` reads caster level and would ignore it silently |
| `cantrip_scaling_on_spell` | a levelled spell has no `cantripUpgradesAt` | the mirror, and the exact confusion that threw Fire Bolt for 2d10 |
| `area_and_targets_within` | not both | one says the geometry chooses, the other says it bounds a choice |
| `trigger_without_area` | `areaTrigger` needs `area` | |
| `anchoring_without_area` | `anchoring` needs an `area` or `targetsWithin` | a template convention with no template |
| `anchoring_on_self_area` | `anchoring` is refused on a `self`-origin area | mirrors the refusal `placeArea` already makes on the request |
| `unaffected_without_area` | `designatesUnaffected` needs an area | SRD writes the clause only for areas |
| `stated_damage_type_needs_choice` | `damageTypeStated` needs two or more entries and must contain each printed type | one entry is not a choice |
| `activation_range_and_origin` | an activation has a caster range **or** the casting holds a point, never both | stated in `CLAUDE.md`; two fields saying five feet are two places to get one sentence wrong |
| `activation_does_nothing` | an activation with no effects must move an area | otherwise it spends an action on nothing |
| `moves_area_without_area` | `activation.movesArea` needs `area` | |
| `two_durations` | `durationSeconds` and `durationUntil` are exclusive | |
| `concentration_without_duration` | Concentration needs something to concentrate on | an Instantaneous Concentration spell is incoherent |
| `check_without_duration` | a `check` on the casting needs a duration | there is nothing left standing there to examine |
| `trigger_without_reaction` / `reaction_without_trigger` | a `trigger` and `castingTime: 'reaction'` imply each other | a Reaction whose moment nobody named is one the engine cannot check |
| `silent_gap` | `effects: []` with no `activation` and no `areaTrigger` requires a non-empty `unmodelled` | the tracked rule; a definition that resolved to nothing and said nothing is worse than the refusal it replaced |
| `unlimited_with_count` | `targets.unlimited` requires `count: 0` | `count` means "no number stated" there |

**What it deliberately does not check.** `mustBeType` is not held against a
closed list: creature types are free strings precisely so `author_creature` can
invent one, and a validator that refused an invented type would over-validate
custom content. And nothing here checks *SRD conformance*; that is §4, and it
is a different concept.

## 4. The oracle

`scripts/spell-oracle.ts` parses the two structured-in-prose fields into
values, and the test holds every definition against them.

```
srdRange('120 feet')  -> { kind: 'ranged', feet: 120 }
srdRange('Self')      -> { kind: 'self' }
srdDuration('Concentration, up to 10 minutes')
                      -> { seconds: 600, concentration: true }
srdDuration('Instantaneous')   -> { seconds: null, concentration: false }
srdDuration('Until dispelled') -> { seconds: null, open: true }
```

Run against the catalogue as it stands, all 125 definitions agree about range,
and **one** disagrees about duration:

> **Guiding Bolt** prints `Duration: 1 round` and the definition carries no
> `durationSeconds`.

That is a correct finding and it is not a bug to fix by changing the number.
Guiding Bolt's round exists solely to bound *"the next attack roll made against
it before the end of your next turn has Advantage"*, which is the definition's
one `unmodelled` clause. Giving it `durationSeconds: 6` would schedule a timer
for a casting with nothing to expire and make an ongoing record for a spell
that is on nobody — a behaviour change in service of a number nothing reads.

So the oracle takes the same shape `spell-tracking.test.ts` already uses for
prose: a disagreement is allowed only with a **written exemption naming the
field and the reason**, a stale exemption fails, and an exemption for a
definition that agrees fails too.

**This is not a second source of truth.** The engine definition remains
authoritative for execution. The oracle can say the definition disagrees with
the book; it can never say what the spell does.

## 5. Outcome-scoped effects: deferred, with the reason

The audit's #4 proposes replacing the rider fields on `attack` and
`save-damage` with `onHit` / `onMiss` / `onFail` / `onSuccess` lists over the
same effect union. Not in this pass, and not because it is large:

- **The riders are not free child effects.** `plus` shares one saving throw
  *and* one damage application (Flame Strike's Fire and Radiant are one
  Dexterity save and one resistance calculation). `condition` shares the same
  save. `delayed` is a debt on the target, not an effect. A naive
  `onFail: SpellEffect[]` would let an author write a `save-damage` inside a
  failed save — a second saving throw nested in the first. That is the
  definition becoming a miniature untyped program, which the north star
  forbids.
- So the branch lists need their **own restricted child vocabulary**, and the
  evidence for which members that vocabulary needs is exactly what the next two
  families produce: a condition with no saving throw, and a standing
  Advantage a spell grants. Building it from the five riders that exist today
  would be generalising from one example.
- **Nothing in this pass needs it.** Mage Armor has no outcome at all.
- The validator makes that migration *safer* when it comes, because the
  invariants that have to survive it are now written in one place instead of
  inferred from four test files.

Recorded as the next audit item, not as a gap.

## 6. Area anchoring

`SpellDefinition.anchoring?: PointAnchoring`. Precedence:

```
request.anchoring  >  definition.anchoring  >  'space'
```

The caster keeps the last word, because `CastSpellRequest.anchoring` exists
precisely so "a caster who wants the other" can say so; the definition supplies
the default in place of the hard-coded `'space'`. Absent on both, nothing
changes: `'space'` is still normalised away when the record is built, so every
log written before this folds byte for byte.

**No SRD spell declares one in this pass, and that is a decision rather than an
omission.** SRD 5.2.1 mandates no convention — its "Playing on a Grid" sidebar
covers squares, Speed, entering a square, corners and ranges, and says nothing
whatever about areas of effect; the intersection convention is a 2014 optional
rule. Declaring one per spell would be the engine choosing a rule the book
declined to give, and doing it inside a definitions pass would quietly change
thirteen spells' footprints behind a migration.

The evidence that pass will want is recorded here rather than acted on. Under a
space origin every printed dimension comes out one space wide, because the
origin's own space is counted on both sides:

| Spell | Printed | Spaces under `space` | Spaces under `intersection` |
|---|---|---|---|
| Acid Splash | 5-ft-radius Sphere | 3 (15 ft) | 2 (10 ft) |
| Moonbeam | 5-ft-radius Cylinder | 3 (15 ft) | 2 (10 ft) |
| Shatter, Grease | 10 ft | 5 (25 ft) | 4 (20 ft) |
| Fireball, Web, Black Tentacles, Cloudkill, Insect Plague, Incendiary Cloud, Vitriolic Sphere, Ice Storm | 20 ft | 9 (45 ft) | 8 (40 ft) |
| Hypnotic Pattern, Mass Cure Wounds, Weird | 30 ft | 13 (65 ft) | 12 (60 ft) |
| Circle of Death, Freezing Sphere, Sunburst | 60 ft | 25 (125 ft) | 24 (120 ft) |
| Lightning Bolt, Sunbeam | 5-ft-wide Line | **1 wide** (right already) | 2 wide |
| Burning Hands, Color Spray, Cone of Cold, Fear, Thunderwave, Spirit Guardians | `self` origin | forced `space` | not expressible |

Three things fall out that the next pass should not have to rediscover: every
**point-origin radial or cubic** template in the catalogue is an even-space
footprint and would want `intersection`; every **`self`-origin** template
cannot take one at all, because the origin is a creature's space rather than a
coordinate; and the one shape already right under `space` is the 5-foot-wide
**Line**, which is exactly what the geometry note predicted.

## 7. Mage Armor, and the primitive it needs

> "You touch a willing creature who isn't wearing armor. Until the spell ends,
> the target's **base AC becomes 13 plus its Dexterity modifier**. The spell
> ends early if the target dons armor."

**Not a `buff` on `ac`.** A flat `+3` is arithmetically equal for an ordinary
unarmoured creature and wrong for the two cases that matter: it would stack on
top of a Barbarian's Unarmoured Defense, which SRD Multiclassing forbids — "If
you have multiple ways to calculate your Armor Class, you can benefit from only
one at a time" — and it would stack on top of worn armour, which Mage Armor's
own sentence forbids. Both are silent wrong answers, which is the class of bug
this engine exists not to have.

**It is the same shape Unarmoured Defense already is:** an alternative *base*
calculation, applying while unarmoured, competing with `10 + Dex` and with each
other, the best applicable one winning. `armorClassCalculation` already runs
that comparison for features. Two concrete mechanics asking for one primitive
is the evidence the generalization rule requires, so the comparison takes a
second source rather than growing a second mechanism:

```ts
/** An alternative base Armour Class an ongoing effect supplies. */
export interface GrantedArmorClass {
  readonly source: string;          // 'Mage Armor#cast:3' — the casting link
  readonly base: number;            // 13
  readonly ability: Ability | null; // 'dex'
  readonly shieldAllowed: boolean;
}
```

- `CreatureState.armorClasses` holds them, beside `bonuses`, linked to the
  casting by the same `castingSource` string, so `releaseCasting` and
  `releaseOnTarget` end them with the spell through the machinery that already
  exists.
- `armorClassOf(state, who)` feeds them into `armorClassCalculation`, which
  consults them **only in its unarmoured branch** — so the SRD's "while not
  wearing armour" falls out of where the comparison lives rather than needing a
  field of its own.
- A Shield still adds on top: a Shield is not body armour, and the sheet has
  held the two separately since equipment landed.
- `TargetRule.mustBeUnarmored` carries the casting-time clause ("a willing
  creature who isn't wearing armor"), beside `mustBeType`, where the target
  rules already are. Refusal code `target_wearing_armor`; nothing spent.
- `unmodelled`: **"the spell ends early if the target dons armor"** is not
  detected. The Armour Class stays right either way, because the grant is
  inert while armour is worn; what is missing is the casting *ending*, which
  is observable through `ongoing` and Dispel Magic. Stated rather than papered
  over.
- "Willing" is not modelled and says so, as every other spell that prints it
  does.

Barkskin is deliberately **not** included: "an Armor Class of 17 if its AC is
lower than that" is a floor on the *total*, which is a different rule, and one
spell is not evidence for building it.

## 8. Migration path for the remaining definitions

There is nothing to migrate. All 125 definitions are already in the
representation this pass validates, and the validator runs over every one of
them in a sweep test. What the next family adds is a **new typed effect
member** plus its invariants in `checkSpellDefinition`, and the sweep then
holds every existing definition to them for free.

The mechanical path for a new spell, after this pass:

1. write the definition, quoting the SRD paragraph in the docstring;
2. `checkSpellDefinition` refuses an incoherent combination at authoring time
   rather than at cast time in a sweep;
3. the oracle holds its level, school, casting time, Concentration, **range**
   and **duration** against the printed spell, or a written exemption says why;
4. `spell-tracking.test.ts` demands an adjudication for every mechanical clause
   in its prose the definition does not execute;
5. `npm run coverage` moves the number.
