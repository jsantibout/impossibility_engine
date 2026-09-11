# M1 working notes

Where the SRD build has got to, what was decided and why, and what the next
action is. `COVERAGE.md` is the *measurement* and is generated; this is the
*plan* and is written by hand.

Read this first when resuming. It is meant to survive a cold start.

## The shape of the work

The spells are not the work. **The shapes are the work, and the spells are data
once a shape exists.** One area-of-effect mechanism unblocked 73 spells at a
stroke; the next hundred definitions after that are transcription with a quote
attached. So the order is always: find the biggest blocked bucket in
`COVERAGE.md`, build the mechanism, then pour spells into it.

Same for classes. The Wizard path proved the structures in `progression.ts`;
the other eleven classes are transcription onto them, and the seams that are
still Wizard-shaped are named below.

## Done

| Batch | What landed | Commit |
|---|---|---|
| Equipment | Catalogue by id, packs opened, purchases, equip/unequip → AC | `f7e66c9` |
| Equipment state | Sheet armour derived from `equipped`; advancement keeps it | `c19691c` |
| Spell effects | `heal` and `save-damage`; defences in state; auto Concentration saves | `a4d5645` |
| Coverage | `pnpm run coverage` → `COVERAGE.md`; definitions asserted against the book | `839e858` |
| Areas | `resolveSpell` resolves targets from geometry; 4 area spells | `ab54bb0` |
| Spell batch | 21 spells into the existing shapes; `unmodelled` reported at runtime | `534c03a` |
| Buffs + temp HP | `buff` and `temp-hp` effects; bonuses live on the creature | `e127590` |
| Multi-type saves | One save, several damage types; 8 more spells | `70169df` |
| Second class | Wizard-shaped seams opened; Cleric + Life Domain, levels 1–20 | `759aa68` |
| Third class | Fighter + Champion; the no-spellcasting path; ammunition | `f7860a1` |
| Fourth class | Sorcerer + Draconic Sorcery; the `known` casting style | `c2a0b4c` |
| Fifth class | Paladin + Oath of Devotion; half-caster slots, no cantrips | `dbbaf07` |
| Sixth class | Rogue + Thief; the Expertise grant's second user | `5fd7495` |
| Seventh class | Warlock + Fiend Patron; Pact Magic and Short-Rest slots | `b1c6fb4` |
| Barbarian, Monk | Two non-casters; the shared suite runs on every class | `a65c67f` |
| Bard, Druid, Ranger | The last three — **all twelve SRD classes** | `4762633` |
| Class coverage | COVERAGE.md counts classes and executed features too | `a4d8d1a` |
| Multiclassing | Rules module, and wired into creation | `e79b61d` |
| Per-class casting | Two casting classes; Pact Magic its own pool | `d022ca0` |
| No skipped tests | Each class asserts the slot rule that applies to it | `a48bbb1` |
| Unarmoured Defense | A class feature reaches the Armour Class calculation | `cc2df1f` |
| Tracked spells | The engine casts what it cannot execute; 14 utility spells | `3e0e330` |
| Feat notes | 24 features stopped claiming feats do nothing | `c918c21` |
| Standing effects | Conditional modifiers and auras, from state; 5 features | `3a5cdb9` |
| Standing defences | Resistance a feature grants; Elemental Affinity | `e64c5fb` |
| Activated features | Rage: cost, prerequisite, deadline, extension, two ways out | `574d03b` |
| Weapon attacks | `resolveAttack` derives AC, cover, reach, range, proficiency | `f1fda6d` |
| Feature damage | Rage Damage and Radiant Strikes, on the attacks that qualify | `cb5e28e` |
| Held attacks | A hit whose damage waits; Divine Smite cast into it | `be486c2` |
| Audit fixes | Unknown distance; damage a temp-HP pool soaks | `f8043eb` |
| Movement | `resolveMove` spends Speed; Opportunity Attacks | `07630c0` |
| Death saves | The turn boundary rolls what it owes | `5a94ef3` |
| Action economy | Extra Attack, Dash, Disengage | _this batch_ |

## Decisions that constrain what comes next

- **Four states, never conflated**: parsed / tracked / executed / verified.
  **Tracked** is the one added here and it is not a half-finished *executed*:
  the engine spends the action, the slot, the Concentration and the clock, and
  the effect is the DM's. Disguise Self will never be executed, because what a
  caster looks like is not arithmetic. Refusing the cast outright meant the
  slot was never spent, which is a worse answer than either.
- **Three states, never conflated**: parsed / executable / verified.
  `coverage.test.ts` enforces the last two. A definition that drifts from the
  book on name, level, school, casting time or Concentration fails there.
- **An area spell takes a place, not a target list.** Passing both is refused.
  A creature the spell cannot affect is *filtered* from an area and *refused*
  from a named target list — those are different rules and both are SRD.
- **A direction is a point to aim at**, never an angle. Maestro speaks in
  landmarks and creatures.
- **Half-on-a-save comes off before the target's defences.** SRD: "The halved
  damage is equal to half the damage that would be dealt on a failed save."
- **Damage always goes through `resolveDamage`**, so the target's Concentration
  save is rolled by the operation that hurt them.
- **No field without a reader.** `ignoresPartialCover` was written and then
  removed because cover reaches no saving throw; the gap is documented instead.
- **A definition that leaves part of its spell out declares it.**
  `SpellDefinition.unmodelled` comes back in `unverified` on every casting, so
  the gap reaches the narrating layer rather than sitting in a docstring.
- **One event, one thing.** `dash-taken` first both spent the action and
  granted the movement, and the command emitted `action-spent` beside it — so
  replaying the pair charged twice. The action is spent by its own event and
  each other event does only its own half.
- **A pure function nothing calls is a rule nothing enforces.** Three times
  now:
  `rollAttack` was correct and unreachable until `resolveAttack`, and
  `moveCreature`/`spendMovement` were correct and unreachable until
  `resolveMove`; and `rollDeathSave` was correct and unreached until the turn
  boundary raised one, so a character at 0 hit points never rolled at all. A
  script in the scratchpad lists every exported rules function no command and
  no reducer reaches — it is the highest-signal audit this codebase has.
  What is left on that list is mostly queries and deliberate non-exposure
  (`recordExternal*`), plus `rest.ts`, where `beginRest`/`endRest` are still
  reachable only from tests.
- **An attack can be held between its two rolls.** SRD Divine Smite is cast
  "immediately after hitting a target", so there has to *be* an after-hitting.
  `resolveAttack` with `hold` stops after the attack roll and records the hit
  in `state.pendingAttack`; `resolveAttackDamage` settles it. In state rather
  than in a return value, which is the whole difference from the pending
  Concentration save that had to be torn out — the fold rebuilds it, and the
  turn will not advance while it stands.
- **A bonus is not extra damage.** SRD Rage Damage is "a bonus to the damage"
  of the weapon's own type, so a target resisting the sword resists it too;
  Radiant Strikes is "an extra 1d8 Radiant damage", which that resistance does
  nothing to. They go into `damageBonuses` and `extraDamage` respectively, and
  collapsing the two would give one of them the wrong answer.
- **A weapon attack is derived, not assembled.** `rollAttack` was always pure
  and always correct; nothing *found* its arguments, so nothing checked them
  and a fixture could swing a longsword at somebody fifty feet away.
  `resolveAttack` derives the target's Armour Class and cover, the reach and
  the range, who is near enough to hamper a bow, both creatures' conditions
  after features have suppressed any, and whether the attacker is proficient.
- **A modifier somebody has to remember is one a character stops having.**
  Bless lives on the creature in `CreatureState.bonuses` and the engine's own
  rolls read it, merged by source with anything a caller adds. Same rule as
  Alert on Initiative.
- **The link is the casting, not the Concentration.** `applySpellEffect` read
  the casting id off `caster.concentration`, which refused every
  non-Concentration spell with a duration. A caller that knows its casting
  says so.
- **A conditional benefit is derived, never stored.** An aura has no moment at
  which it starts — being in one is a fact about where two creatures are
  standing — so `standing.ts` evaluates from state on every read and nothing is
  written onto the creature it reaches. A stored copy would be an
  unconditional bonus wearing a feature's name, and it would go wrong exactly
  when it mattered: the paladin walks away, the barbarian is stunned.
- **A requirement names the feature it needs, not "whichever granted me".**
  Rage's own benefits require Rage; Mindless Rage is the Berserker's feature
  and requires the *Barbarian's* Rage. The first draft meant the second thing
  by the first, which was right once and would have been wrong here.
- **What an activated feature does is ordinary standing effects.** Turning Rage
  on grants nothing directly and turning it off takes nothing away directly —
  the Resistance and the Advantage simply require it to be active. Neither can
  go stale, which is the same reason auras are derived.
- **The condition a feature names is that feature's, not the mechanism's.**
  `standing.ts` first gated every effect on the holder not being Incapacitated,
  which is what Danger Sense and the Paladin auras say and is *not* a general
  rule — Elemental Affinity names no condition, and a Stunned Sorcerer still
  resists fire. Requirements are declared per feature now, from its own text.
- **Suppression is not removal, and not prevention.** SRD Aura of Courage: a
  Frightened ally's condition "has no effect on that ally while there". The
  condition stays on the creature and bites again the moment they leave, so
  `effectiveConditions` is what every reader of condition *effects* goes
  through, and `creature.conditions` stays the record of what is on them.
- **Allegiance is declared, like cover and sight.** Who is an ally is fiction
  that changes in play, so `CreatureState.side` is null until somebody says.
  Nobody is an ally by default, which withholds a benefit rather than
  inventing one.
- **Equipment, wounds, spent resources and ongoing effects survive advancement.**
  `advanceCharacter` plans against the creature's *live* inventory and equipped
  set, never the creation-time snapshot.
- **A prepared spell belongs to a class, not to a creature.** SRD: "you use the
  spellcasting ability of that class when you cast the spell."
  `SpellcastingState` is therefore a list of `SpellcastingClass`, each with its
  own ability, cantrips and prepared list. The old single `ability`/`cantrips`/
  `prepared` triple could not express a Ranger/Sorcerer and was the reason two
  casting classes were refused.
- **The engine will not decide which class is casting.** Where two classes both
  prepared a spell, `resolveSpell` refuses with `class_required` and names
  `class:<id>` for each. Two preparations are two spells with two save DCs, and
  choosing between them is a fact about the sheet, not a tie to break.
- **Nor which pool pays.** Pact Magic slots live under `pact-slot:N` and recover
  on a Short Rest; ordinary slots under `spell-slot:N` and on a Long Rest. Either
  may pay for either class's spell, so a caster holding both is refused with
  `slot_kind_required`. A caster holding one is asked nothing, which is every
  single-classed character including a pure Warlock.
- **The recovery belongs to the pool, not to the starting class.** It used to be
  read off `choices.classId`, which gave a Warlock/Wizard's ordinary slots a
  Short Rest recovery.
- **A level is taken in one named class.** `AdvanceChoices.classId` says which;
  the default is the starting class, so every existing caller is unchanged.
  `MAX_LEVEL` is checked against the *total*.

## Next actions, in order

1. **Pour the rest of the utility bucket into the tracked shape.** 14 of 91
   are done and the mechanism costs nothing per spell: a definition with real
   metadata, `effects: []`, and an `unmodelled` list naming what the table
   decides. `coverage.test.ts` refuses a tracked spell that declares nothing.
   The ones with a *check* in them — Disguise Self's Investigation against the
   save DC, Dispel Magic's ability check — want a shape of their own, and that
   is the next real mechanism in this area.
2. **Keep pouring spells into the five working shapes.** Attack, save-damage,
   save-condition, area, buff, heal, temp-hp all work now; roughly 90 parsed
   spells fit one of them and need only a definition with its SRD quote.
   `spell-catalogue.test.ts` drives every definition automatically, so the
   test cost of each new one is zero. This is the cheapest coverage there is.
3. **Turn-anchored spell durations.** `SpellDefinition.durationSeconds` is
   elapsed time only, so "until the end of your next turn" cannot be written
   down — Color Spray and several riders are blocked on it. `duration.ts`
   already has `endOfNextTurn`; the definition needs a way to name it.
4. **Damage that arrives on a later turn.** Acid Arrow and Vitriolic Sphere
   deal a second, smaller hit at the end of the target's next turn. The turn
   hook machinery raises *saves*; this needs it to raise damage too.
5. **Ongoing effects a later turn can act through** (18 spells). Spiritual
   Weapon, Call Lightning: a casting that a subsequent turn spends an action to
   use. Needs a handle on the casting that a command can name.
6. **Reaction triggers** (4 spells: Shield, Counterspell). Needs an interrupt
   that can order a cast against the event that triggered it. This is the
   hardest remaining spell mechanism and is deliberately last.
7. **Summons** (9 spells). Needs a creature created mid-fight from a stat
   block, which `adaptMonster` can already produce — the gap is an event that
   adds it and ties its life to the casting.
8. **Long casting times** (43 spells). Needs a casting-in-progress state
   machine with a per-turn obligation; the clock alone was never the blocker.
9. **Classes.** See below.

## Classes: all twelve, with one subclass each

The Wizard-shaped seams are **open**, and the Cleric is the proof:

- A feature says what it **grants** (`expertise`, `spells`) and creation looks
  for the kind. No more matching `wizard:scholar` by id.
- A class declares a **spellcasting style** — `spellbook`, `prepared-from-list`
  or `known` — and `checkSpells` branches on it. A Cleric has no spellbook and
  writing in one is refused.
- A grant can be **fixed** rather than chosen: Life Domain spells are always
  prepared and ask the player nothing, where the Evoker's two are a choice.
- `FeatureChoice` gained an `option` kind for "one of these named things" —
  Divine Order, and later Fighting Style, Metamagic, Manoeuvres.

Four classes in, and **all three spellcasting styles plus none** are now
exercised: Wizard (spellbook), Cleric (prepared-from-list), Sorcerer (known),
Fighter (no spellcasting at all). Each opened something:

- The Fighter proved `spellcasting?: undefined` — a class that casts nothing
  now short-circuits the spell rules rather than being asked for a spellbook,
  and its spellcasting ability is **null** rather than its primary ability,
  which would have given it a spell save DC off Strength.
- Three equipment packages rather than two; the loop never assumed a count.
- Fighting Style feats are registered, so `category` on `FeatDefinition`
  finally has something in it and a Fighter cannot take Alert as a Style.
- Ammunition reached the catalogue, priced **per round** rather than per
  bundle: Arrows are 1 GP for 20, so one arrow is 5 copper and an inventory
  counts arrows rather than bundles.

- The Sorcerer proved `known`, brought the second `option` choice (Metamagic,
  two of ten) and the first subclass grant that is **not on the class list** —
  Draconic Sorcery gives Command, a Cleric spell, which is the whole reason a
  granted spell skips the class-list check.

- The Paladin proved **half-casting needs no machinery** — the table already
  held slots per level, and a shorter row that grows slower is the whole of it
  — and brought the second use of absent-versus-zero: a caster with slots and
  a prepared list but **no cantrips column at all**.

- The Rogue proved the **Expertise grant** by being its second user — two
  skills rather than one, chosen from the character's own proficiencies, and
  granted twice (levels 1 and 6). A generalisation with one user is a guess.
  It is also the first class to choose **four** skills and the first to bring
  a tool proficiency of its own.

**A rules correction worth keeping:** 2024 moved Paladin *and Ranger*
spellcasting to **level 1**. 2014 started both at 2, which is the version most
tables remember, and an earlier note in this file said so. The SRD 5.2.1 tables
print two prepared spells and two level 1 slots at level 1 for both.

- The Warlock proved **Pact Magic** with one new field,
  `spellcasting.slotRecovery`. The slot table already stored counts per spell
  level, so "two slots at level 3 and nothing below" is `[0, 0, 2]`, and
  `spellSlotTable` drops the empty levels so no level 1 pool is ever declared.

- The Barbarian and Monk both wanted **Unarmoured Defense**, with different
  abilities, and Draconic Resilience wanted a third. That made it a *shape*
  rather than a quirk, and it is **built**: `FeatureGrant` has an
  `unarmored-defense` kind, the sheet carries every alternative a character's
  features grant, and `armorClassCalculation` takes the best applicable one and
  records which rule won. The Monk's "or wielding a Shield" is the clause that
  gets dropped by hand, and it costs the whole calculation rather than the
  Shield's bonus.
- They also found the third feature-id string match, in `gatherProficiencies`:
  `human:skillful` was matched by id, so the Barbarian's Primal Knowledge
  granted no proficiency. Any feature whose choice is a skill now grants it,
  with Expertise the documented exception.
- `progression.test.ts`'s well-formed suite now runs on **every** registered
  class, and found that Pact Magic legitimately breaks "slots never go
  backwards" — a Warlock's slots move up rather than accumulate. The
  invariant is scoped, and the Warlock has its own.

- The Ranger is the one combination no other class has — a **half-caster that
  knows rather than prepares** — and needed nothing new, which is what being
  twelfth rather than second is for.
- The Bard needed `SkillChoices.from` to become optional, for SRD's "Choose
  any 3 skills". Absent means any skill, rather than a copy of the whole list:
  different rules, and only one survives the game gaining a skill.
- **Circle of the Land is the one subclass grant the engine cannot express.**
  Its spells are chosen *after each Long Rest* from one of four land types, so
  they are neither fixed nor decided at creation. The feature grants nothing
  and its note says what it would take: a grant that can be re-chosen on a
  rest, which is a rest mechanic rather than a creation one.

What remains in the class system, in likely order:

- **Sneak Attack**, which wants once-per-turn bookkeeping and a condition the
  engine can now nearly see: Advantage on the roll, or an ally within 5 feet
  of the target.
- **A pool that refills partly.** SRD Rage gives back *one* use on a Short Rest
  and all of them on a Long Rest; `restoreOn` refills a whole pool by tag, and
  every other recovery in the game is all or nothing.
- **A grant that can be re-chosen on a rest**, for Circle of the Land, for
  the Barbarian's Weapon Mastery swap, and for every "swap a prepared spell on
  a Long Rest" rule.
- **Feature execution.** Every class is transcribed and validated; almost no
  class *feature* is executed. Each says what a DM still has to do, and the
  recurring blockers are: extra attacks inside the Attack action, Reactions
  with triggers, auras that follow a creature, and defences that can change
  after a rest.
- **Multiclassing is wired.** `multiclass.ts` holds the rules that only exist
  between classes; `CharacterChoices.multiclass` carries the extra classes, and
  creation reads the total level for the Proficiency Bonus, each class's own
  level for its features, the union for armour training, each class's die for
  hit points, and the weighted sum for slots.
  **Two casting classes now work**, through creation, advancement and
  `resolveSpell`. `CharacterChoices.spellsByClass` carries the spells of any
  class the flat fields do not describe, each validated against that class's
  own table, list and slot ceiling; the SRD's own worked example — a level 4
  Ranger / level 3 Sorcerer with five Ranger spells, six Sorcerer spells, four
  cantrips and slots of 4/3/2 — is `multiclass-spells.test.ts`.
  What is still missing here: **swapping a prepared spell on a Long Rest**,
  which is the same rest mechanic Circle of the Land wants.
- **Mystic Arcanum** (Warlock 11+) is four one-use pools attached to spells
  chosen at those levels. Not modelled, and the reason a Warlock here has no
  slots above level 5.

## Where the numbers stand

Run `pnpm run coverage`; these were true at the last commit.

| | |
|---|---|
| Spells parsed | 339 |
| Spells executed and verified | 44 |
| Spells tracked (cast, effect narrated) | 14 |
| Classes | 12 of 12, each with its SRD subclass, levels 1–20 |
| Class features executed | 61 of 230 |
| Tests | 2,439 passing, none skipped |

The two numbers worth reading together are the last two. Every class is
**validated** — creation and advancement check scores, skills, feats,
languages, equipment and spells against the book — and most class *features*
are not **executed**. That gap is the honest state of the class system, and
every unexecuted feature carries a note saying what a DM still does.

## How to resume

```bash
pnpm run coverage   # regenerates COVERAGE.md; the numbers are the truth
pnpm test
pnpm run typecheck
pnpm run lint
```

Then pick the top unfinished item in "Next actions". Work in one coherent
batch, verify the rules against `packages/srd/raw/`, mutate the implementation
to check the new tests actually bite, and commit that batch alone.
