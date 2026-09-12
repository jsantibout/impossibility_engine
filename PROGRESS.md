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
| Coverage | `npm run coverage` → `COVERAGE.md`; definitions asserted against the book | `839e858` |
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
| Action economy | Extra Attack, Dash, Disengage | `16d1ac0` |
| Dodge | The one action whose benefit outlives its turn | `5648241` |
| Difficult terrain | Declared by the foot, charged exactly | `06dd3b1` |
| Ready | An action spent now for a Reaction later; readied spells | `d63d75d` |
| Readied move | "Up to your Speed", out of the Reaction rather than the turn | `eae9c67` |
| Turn-anchored riders | An effect with its own deadline; Color Spray, Sunbeam | `669d151` |
| Riders on a hit | Ray of Sickness poisons; an unmodelled note became behaviour | `8a3f0bb` |
| Engine audit | Error kinds, idempotency sweep, wedge recovery, a loud reducer | `fabb8eb` |
| One channel | `needs-context` is an `Err` everywhere; the spell union is gone | `2d28853` |
| Missing facts | One policy for a fact nobody has told the engine | `9ef2cae` |
| Persistence | A frozen log, the fold's real guarantee, a vocabulary contract | `768623d` |
| Dead code | 14 exports removed, and an architecture CLAUDE.md still described | `312649e` |
| Fold speed | Three derived passes stopped sorting the cast on every event | `8be2697` |
| Doctrine | `docs/IMPOSSIBILITY_ENGINE_DOCTRINE.md`, audited; three conformance debts named | `bac982d` |
| Later damage | A hit a turn boundary collects; Acid Arrow, Vitriolic Sphere | `e21b59a` |
| Architecture audit | Facts have providers; four more guards; every request named | `b1d98a7` |
| Tooling | pnpm → npm workspaces; ESLint 10 | `36016fc`, `5c7e217` |
| Reaction triggers | A trigger the engine checks; Shield deflects the hit it answered | _this batch_ |

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
- **An action anybody can take is not a feature on anybody's sheet.** Dodge is
  the one common action with a lasting benefit, and it needed no new machinery
  — an activated feature with a turn-anchored deadline, granting standing
  effects while it runs. What it lacked was a sheet to be declared on, so
  `actions.ts` holds the one entry rather than every creature ever made
  carrying a copy.
- **"Start of your next turn" and "end of your next turn" are a full round
  apart**, and a test that advances past both cannot tell them apart. The
  discriminating moment for Dodge is *during* the dodger's own next turn.
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
- **The trigger of a readied action is text the engine stores and never
  reads.** SRD asks for "a perceivable circumstance", and the circumstances a
  table readies against — a trapdoor, a chant reaching its third line, a door
  opening — live almost entirely in fiction that structured state has never
  been told about. **Absence from structured state is not evidence a thing
  does not exist**, so an engine that judged triggers would refuse readied
  actions on the strength of its own ignorance, or invent a world to judge
  them in. Maestro says when it fired. Everything around it is the engine's:
  the action spent now, the Reaction spent later, the deadline, and for a
  readied spell the slot and the Concentration.
- **A readied spell is paid for on one turn and resolved on another**, which is
  the first thing to split `resolveSpell` down the middle. SRD: "you cast it as
  normal (expending any resources used to cast it) but hold its energy, which
  you release with your Reaction." Deferring the payment instead would refund
  the slot when Concentration broke, which is precisely the case SRD writes a
  rule for — "the spell dissipates without taking effect" — and the slot is
  gone. So `castOrRelease` takes the casting the Ready already paid for, and
  everything below the payment runs unchanged rather than being copied.
- **Holding the magic and concentrating on the spell are two different
  Concentrations that share a casting id.** Every readied spell requires the
  first; only some spells require the second. So releasing Hold Person changes
  nothing about what the caster is holding, and releasing Blindness/Deafness
  ends the hold — *before* the spell lands, because ending a Concentration ends
  its whole casting, and dropping the hold afterwards would wipe the condition
  the release had just applied.
- **A movement allowance need not come from the turn budget.** SRD Ready:
  "or you choose to move up to your Speed in response to it" — on somebody
  else's turn, where `spendMovement` refuses by construction and is right to,
  because a budget belongs to a turn. So `moveWithin` takes an allowance in
  feet, null for the ordinary case; everything else about the move is
  unchanged, Opportunity Attacks included, because it is still the creature's
  own movement and SRD does not ask what paid for the leaving. The allowance is
  read at the *release*: a mover Grappled while waiting has a Speed of 0, and
  freezing it at the Ready would hand them thirty feet out of the fist.
- **A turn's Disengage does not follow a readied move into the next turn.**
  SRD: "for the rest of the current turn." The two cannot even be taken
  together — both are the action — but reading the flag off the budget without
  asking which turn set it would have let one turn's Disengage cover a Reaction
  taken on another.
- **A rider can outlive its casting, or die before it.** SRD writes dozens of
  effects that end at a moment in the turn order rather than when the spell
  does, and the two spells that prove it are opposites. Color Spray is
  **Instantaneous** and blinds "until the end of your next turn" — there is no
  casting deadline to hang the Blinded on, so the spell could not be written at
  all. Sunbeam runs a **minute** and blinds "until the start of your next turn"
  — hanging it on the casting would blind the target sixty seconds too long.
  `applyConditionTo` has taken a per-condition `Duration` since durations
  landed; what was missing was any way for a definition to ask for one.
- **The anchor lives in the value, not in a field beside it.** SRD writes both
  "until the end of **your** next turn" and "until the end of **its** next
  turn", and they are a full round apart. A bare `'end-of-next-turn'` reads as
  whichever the next person assumes, so the values are spelled
  `end-of-casters-next-turn`. Only the caster-anchored pair exists: every SRD
  spell the engine can currently execute uses it, and each target-anchored
  rider needs machinery this did not build — Sleep wants "each creature of your
  choice" inside an area and a save that escalates on a second failure, Haste's
  lethargy fires when the spell *ends*, and the rest are summons or Reaction
  riders. A value nothing can be written with would be a value nothing reads.
- **A rider is checked before the first die, not when it lands.** A
  turn-anchored deadline cannot be pinned outside combat and `resolveDuration`
  refuses rather than inventing six seconds — but the condition is applied
  *after* the saving throw, so discovering it there would have moved the
  caller's generator for a cast that never happened. `resolveSpell` asks up
  front, which is the same validate-before-rolling rule the rest of casting
  obeys, and is why a Color Spray outside combat costs its caster nothing.
- **One save, two consequences.** Sunbeam deals damage *and* blinds on a single
  Constitution save, so the condition sits inside the `save-damage` effect
  rather than beside it — exactly the argument `plus` already makes for a
  second damage type. Two effects would roll two saves, and a target could then
  fail one and make the other, which is not the spell. And it is on the failure
  branch alone: "On a successful save, it takes half as much damage **only**."
- **A rider hangs in three places, and the third is an attack roll.** A save
  that only imposes a condition, a save that also deals damage, and a hit —
  Color Spray, Sunbeam, Ray of Sickness. The attack branch is the simplest of
  the three, because the roll already settled it and there is no half-measure
  to fall through to: a miss leaves the target untouched. It is also where
  checking the rider up front pays most, since the alternative is throwing the
  ray and rolling its damage before discovering there is no turn to end at.
- **An `unmodelled` note becoming behaviour is the most valuable change here.**
  Ray of Sickness had carried "the target has the Poisoned condition until the
  end of your next turn" as a gap since it was written. The note was honest and
  it reached the table on every casting; it is still better for the engine to
  do it.
- **The fold's cost is per event × per creature, and the cast only grows.**
  Three derived passes ran `Object.keys(creatures).sort()` after *every* event
  to find the handful of creatures that could be affected — and
  `endLostFeatures` copied the whole map first, then usually threw the copy
  away. Measured on a cast of 128 over 2,256 events, those three were 90% of
  the fold. A guard that asks "is any creature concentrating / holding a
  feature / holding a Ready" with a bare `for...in` and no allocation made a
  large cast 9× faster and a long log 3×. Profile before optimising: the
  suspicion going in was that log *length* was the problem, and length was
  already linear and cheap.
- **A guard is only as good as the job it guards.** The first version of
  `dropLapsedReady`'s guard asked whether anybody was holding a readied action
  — and that pass has a second job, sweeping a **stale Ready timer**, which by
  definition runs when `readied` is already null. The suite caught it in one
  run. The optimisation is proved safe by mutation rather than by reading:
  forcing the guard to `true` is behaviourally identical to the code before it
  and passes everything, while forcing it to `false` fails fourteen tests.
- **The fold is a compatibility surface, and it is not pure replay.** The same
  log under the *same* engine version folds to the same state — that is what
  determinism means here. It does **not** follow that a log folds the same way
  under a later version, because five derived passes run after every event and
  those are rules. Change one and every stored campaign folds differently the
  next time it is opened. The trade is right — the alternative is a dead
  wizard's spell still running because the log predates the fix — but it makes
  a rules change potentially a **migration**, and `fixtures/golden-log.json` is
  the frozen log that says when one happened.
- **A golden log is only as good as the state it stops in.** The first version
  of the fixture ended after the fight, where everything had worn off — and an
  empty derived state folds the same way under every expiry rule there has ever
  been. It is saved **mid-encounter** now: a Concentration held, a paralysis
  repeating its save, a Dodge inside its deadline, three live timers.
- **Say what a test adds over the rest of the suite, not what it aspires to.**
  Moving an expiry boundary by one breaks a dozen tests in `duration.test.ts`
  before it reaches the golden log, so claiming the fixture catches rules
  changes in general was an overclaim; it was measured and corrected. What it
  actually adds is the shape of the *log* — a renamed or retired event, a field
  that changed meaning — which is invisible at compile time to a log written
  last season and is exactly what breaks on a deploy.
- **A rule is never silently skipped for want of a fact**, and there are
  exactly three things that may happen instead. If the fact is a
  **precondition of legality**, the engine asks (`needs-context`, nothing
  spent). If it only changes **how well it goes**, the rule proceeds under a
  stated reading and `unverified` says which. If it is **declared-or-default by
  design** — cover absent means none — the default stands and is documented
  where it is read. Which one applies is a property of the *rule*, not of the
  command that reached it, which is how the engine came to ask for a position
  before a Fire Bolt and swing a longsword at any distance at all.
- **No map is not a gap in one.** A scene that does not exist means the table
  is not using positioning — an ambush in a corridor nobody drew — and
  demanding a map before anyone may swing is the obstructive behaviour this
  engine exists not to have. A scene that *does* exist with a creature not on
  it is a gap in a record being actively kept, and one event fixes it. The
  asymmetry is the whole seam, and moving it either way breaks tests in both
  directions.
- **An error says which of two questions it is answering.** `Err` carries
  `kind: 'refusal' | 'needs-context'`. A refusal is the rules saying no under
  facts already established; needs-context is the *record* being thin. An AI DM
  has to branch on that difference and cannot do it by matching error codes.
  **Absence from structured state is not evidence a thing does not exist** — a
  player swinging at the chandelier rope is doing something the engine has not
  been told about, not something impossible. `err` still defaults to a refusal,
  so a careless caller closes the question rather than starting a loop.
- **An idempotency guard that does not engage is worse than none.** Six
  commands took a `commandId`, called `identify`, computed a fingerprint, and
  emitted no event carrying the stamp — so nothing was recorded and the guard
  never fired. What the retry then returned was the real damage: a Dash came
  back `no_action` and a Dodge `already_active`, rules refusals for commands
  that had gone through, which the DM would narrate as a lie. The guard is only
  as real as the event that carries it, and `invariants.test.ts` sweeps every
  command rather than trusting that.
- **A debt that blocks the turn must survive the debtor leaving.**
  `pendingAttack` and `pendingMove` stop the turn advancing, and every command
  that could settle one is addressed to the creature who owes it — so a mover
  killed by the Opportunity Attack they provoked and then cleared off the board
  stopped the fight for good. Leaving the game settles the holds it orphans.
- **A deferred reference can outlive what it names, and an append-only log
  cannot take that back.** A declared move keeps its *placement* so the mover
  still arrives beside whoever they aimed at — and the likeliest thing to kill
  that creature is the Opportunity Attack the move provoked. Re-resolving a
  vanished anchor threw, and the `creature-moved` was already written down: the
  campaign would never load again. A declared move now records the destination
  it measured and falls back to it. **Anything the log defers must have a
  fallback the log already contains.**
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

## Doctrine conformance, and the debts it names

`docs/IMPOSSIBILITY_ENGINE_DOCTRINE.md` landed as the constitutional document — it outranks `CLAUDE.md`
and states what must stay true of the Engine whatever it is asked to do next.
Audited against the code rather than assumed, most of it already holds: state
moves only through events, events carry resolved outcomes, the engine is pure
and headless, no model writes a number, commands are retry-safe, and
`needs-context` is a first-class answer. Three gaps are real and named here so
they are debts rather than surprises.

- **~~A declared fact can be silently overwritten, and no command declares
  one.~~ Paid.** `declareCreatureType` is the authoritative provider for the
  request `resolveSpell` makes; a second, different type is refused with
  `type_established` and a contradicting log is corrupt. The distinction that
  kept it small: **type is durable**, sight and cover are **momentary**. A
  retcon path for a DM who misspoke is deliberately not built.
- **Provenance is per-command, not causal** (invariant 10). Events carry
  `command?: CommandStamp`, which answers *who asked*. Nothing answers *what
  caused this* — there is no link from an event to the event that provoked it,
  and derived changes (expiry, Concentration breaking) write nothing at all, a
  trade `CLAUDE.md` already documents. The doctrine says "eventually", so this
  is a debt with a name rather than a bug.
- **There is one scene.** `state.scene` is a single `PositionState | null`.
  Multiple locations or world regions is a listed compatibility concern, and
  this is the one structural decision that would be expensive to revisit later
  and nearly free to keep open now. No action yet — evidence first, per the
  generalization rule.

### Architecture audit against the doctrine

Measured, not recalled. The numbers are what the code said on the day.

- **Idempotency.** 21 commands called `identify`; four DM-facing mutators did
  not and had no way to take an id at all — `applyConditionTo`,
  `endConcentration`, `setExhaustionLevel`, `grantTemporaryHpTo`. A retried
  `endConcentration` came back `not_concentrating`: a rules refusal for a
  command that had succeeded. All four now take a `CommandIdentity`, stamp
  their event, and sit in the `invariants.test.ts` sweep, which is the
  authoritative list. Still unguarded and deliberately so: `applySpellEffect`,
  `endSpellEffectOn`, `declareResourcePool`, `restoreResourcesOn` — the
  fixture-and-log-reconstruction halves the tool surface does not expose.
- **needs-context consistency.** 62 sites; 55 carried no `ContextRequest`,
  and 37 of those were `unknown_creature` — the single most common one, and
  `contextRequestsOf` returned `[]` for it. Every command-level `needs-context`
  now carries a request (`kind: 'creature'` is new, with 37 users on arrival),
  the sweep asserts it, and requests name the *command* that satisfies them
  rather than a raw event. Pure helpers (`positioning.ts`, `combat.ts`,
  `rest.ts`) return the bare kind by design; the command attaches the request.
  One inconsistency left in place: `placeArea`'s `err('no_scene')` is
  unreachable — both callers check the scene first — so it has no failing test
  and stays as a dead guard rather than a silent behaviour change.
- **Engine independence.** `packages/engine` imports `@ie/shared`, `@ie/srd`
  and nothing else; `node:` appears only in tests and scripts. Clean.
- **`commands.ts` is 5,400 lines and thirteen domains**, in this order:
  vitals (277), conditions (502), declared facts, resources (656), common
  actions (690), Ready (828), movement (1266), attacks (1753), features
  (2308), casting (2571), turns (3165), spell resolution (3848), inventory
  (5203). The coupling is real and it is one thing: every command folds its
  own batch through `applyEvent` and shares private helpers, so a split has to
  choose which helpers become a module's public seam. **Not done here** — a
  move has no failing test to start from, and a 5,000-line reorganisation
  under the rule "do not reorganise solely for cleanliness" is exactly the
  refactor that rule forbids. The map above is the recommendation; spell
  resolution (1,300 lines, the fewest shared helpers) is the natural first
  cut when there is a behavioural reason to touch it.
- **`unknown_combatant` has no provider.** "X is not in this combat" is a
  request with nothing that can satisfy it mid-fight: `combat-started` is the
  only way in. Reinforcements and summons both need a creature joining an
  Initiative order in progress, and that event does not exist. Named here; it
  is the summons blocker in the list below, not a separate item.

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
3. **Target-anchored riders**, and the two things each of them also needs.
   `lasts` carries the caster-anchored pair only. Sleep is the nearest
   candidate and wants "each creature of your choice" inside an area — the area
   model catches everyone in the shape, and putting a party to sleep is a
   *wrong* answer rather than a missing one — plus a repeat save that escalates
   to Unconscious on a second failure, which is a third outcome the hook
   machinery has no room for. Haste's lethargy fires when the spell ends, which
   is a trigger nothing raises.
4. **Ongoing effects a later turn can act through** (18 spells). Spiritual
   Weapon, Call Lightning: a casting that a subsequent turn spends an action to
   use. Needs a handle on the casting that a command can name.
5. **The three Reaction spells that are left**, which are three problems
   rather than one bucket. Shield is done: `SpellDefinition.trigger` is checked
   before anything is spent, and the hit it answers is re-measured against the
   Armour Class it raised. What the others need, each different:
   - **Hellish Rebuke** — `damage-taken` carries a prose `source` (`'a trap'`),
     so the engine cannot say *which creature* damaged you, and the trigger is
     "a creature that you can see". An optional dealer id on the damage events
     is small and additive; the trigger then reads the last one. This is the
     cheapest of the three and the obvious next one.
   - **Counterspell** — needs a casting held between declaration and
     resolution, the way `pendingAttack` holds an attack between its two rolls.
     `resolveSpell` is atomic today, and the slot has to be *refundable*: SRD
     2024 says "the slot isn't expended" on a failed save, so a two-phase cast
     must not spend it until the window closes. This is a public-shape change
     to the most-used command in the engine and wants its own batch.
   - **Feather Fall** — needs falling. Nothing falls, nothing takes fall
     damage, and no rate of descent is modelled. Furthest away by a distance.
6. **Summons** (9 spells). Needs a creature created mid-fight from a stat
   block, which `adaptMonster` can already produce — the gap is an event that
   adds it and ties its life to the casting.
7. **Long casting times** (43 spells). Needs a casting-in-progress state
   machine with a per-turn obligation; the clock alone was never the blocker.
8. **Classes.** See below.

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

Run `npm run coverage`; these were true at the last commit.

| | |
|---|---|
| Spells parsed | 339 |
| Spells executed and verified | 44 |
| Spells tracked (cast, effect narrated) | 14 |
| Classes | 12 of 12, each with its SRD subclass, levels 1–20 |
| Class features executed | 61 of 230 |
| Tests | 2,460 passing, none skipped |

The two numbers worth reading together are the last two. Every class is
**validated** — creation and advancement check scores, skills, feats,
languages, equipment and spells against the book — and most class *features*
are not **executed**. That gap is the honest state of the class system, and
every unexecuted feature carries a note saying what a DM still does.

## How to resume

```bash
npm run coverage   # regenerates COVERAGE.md; the numbers are the truth
npm test
npm run typecheck
npm run lint
```

Then pick the top unfinished item in "Next actions". Work in one coherent
batch, verify the rules against `packages/srd/raw/`, mutate the implementation
to check the new tests actually bite, and commit that batch alone.
