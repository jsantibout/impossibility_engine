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
| Reaction triggers | A trigger the engine checks; Shield deflects the hit it answered | `a0aca8c` |
| Hellish Rebuke | Damage names its dealer; a Reaction that answers being hurt | `595e6c6` |
| Interruptible casting | A casting held between declaration and effect; Counterspell | `6e12880` |
| Utility audit | 76 spells read one at a time; 30 tracked; `unmodelled` given a guard | `5d1dfc4` |
| Ability checks | A check a spell offers against its own ongoing effect; `checks.ts` reachable | `e9a323f` |
| Once per turn | An attack-damage rider with a per-turn allowance; Sneak Attack, Colossus Slayer | `52274c9` |
| Chosen damage type | A rider whose type the holder names at the hit; Divine Strike, Primal Strike | `bae34d8` |
| Critical range | The die face that scores a Critical Hit, off the sheet; the Champion | `7c0227e` |
| Evasion | A halved Dexterity save becomes none; the Rogue and the Monk | `9a1ebb4` |
| Rolls features change | Advantage on Initiative and on a skill; saving throw proficiencies | `92a3c88` |
| Class pools | Nine features that claimed a pool and had none | `abf6b7b` |
| Partial refill | One use back on a Short Rest; five features that say it | `cc02125` |
| Recovery | A feature that gives another pool's uses back; Sorcerous Restoration, Magical Cunning | `00d2e1b` |
| Self-heal | Spend a use, roll the die, heal; Second Wind, Wholeness of Body | `d3e64e9` |
| Recovery + heal | Uncanny Metabolism, which the two batches above had already built | `1c1e900` |
| Healing touch | A pool of hit points spent by touching somebody; Lay On Hands, Restoring Touch | `ec14f10` |
| Reaction windows | Five named instants shared by spells and features; 8 class Reactions | `e66c2f8` |
| Ongoing spells | A live record of a casting that is still running; Dispel Magic, later-turn use, replacement | `99b7c06` |
| Architecture audit II | An offer is a (reactor, feature) pair; the Ready path’s record; activation guards; retry order; scheduled-damage cleanup | `f2512c7` |
| Spell origins | A casting holds a point; the attack's origin is not its actor; Spiritual Weapon | `adaf5eb` |
| Area triggers | A persistent area catches a creature at a boundary or on entering; Insect Plague, Web, Grease, Black Tentacles | `ffd2e44` |

## Decisions that constrain what comes next

- **A pool that cannot be spent is half a feature.** Every pool in the class
  tables was declared and sized correctly and almost none could be *spent* —
  `restore()` and `healCreature` were both correct and reached by nothing.
  Three spending shapes now exist (a recovery, a self-heal, a healing touch)
  and they are told apart by what the spending buys, not by which class says
  it. See CLAUDE.md, "What A Pool Buys".
- **A limit of "once until you finish a Long Rest" is a pool of one.** Not a
  second kind of limit; the pool system already says exactly that.
- **A cap is derived at use, never stored.** A pool's maximum moves, and a
  number written at creation goes on being the old one.
- **A moment the engine can see is recorded; one it cannot is the table's, and
  says so.** `lastShortRestAt` is a fact beside `lastDamage`. Magical
  Cunning's one-minute rite is fiction — no state tells it from a minute of
  walking. "When you roll Initiative" is the first turn of the fight, which is
  the closest the engine holds and the same window for everyone in the order.
- **Half a feature is not executed, even when the other half is cheap.**
  Persistent Rage says Uncanny Metabolism's sentence and is still `manual`,
  because its second clause is a feature changing another feature's activation
  — one user, and an abstraction with one user is a guess. The note says which
  half and why.

- **Ordering settlements is not ordering moments.** The first version of the
  area triggers raised the end-of-turn and start-of-turn debts in one fold and
  sorted them. Whether the next creature is caught at its start is a question
  about the world the previous creature's end left behind, and sorting does not
  make that world exist. `pendingTurnStart` is the smallest representation that
  does: the end is raised, and a derived pass reaches the start once nothing
  the end owed is outstanding.
- **A spell already cast does not change when its caster does.** `OngoingSpell`
  stored a route *name* and every later use re-derived the numbers from the
  caster's current sheet. Four are pinned instead — save DC, attack modifier,
  spellcasting modifier, caster level — and a casting can now outlive its
  caster, which SRD Grease requires and the engine was quietly forgiving.
- **A guard has to be on every path that spends something.** `mayAct` is the one
  policy and it is per-creature: the debt blocks the creature it is owed by,
  the turn still refuses globally, and Reactions are untouched.
- **Causing a condition and owning it are two different links.** Grease knocks
  you Prone and the book leaves you to stand up; the engine was lifting it when
  the grease ended. `outlivesCasting` records the condition under the spell's
  bare name, and the same change made `on` mean one thing at the cast and at a
  trigger: a live effect the casting owns.
- **"An area trigger" is not one mechanic.** A taxonomy audit read the twenty
  spells and found at least eight detections; this batch built two — a turn
  boundary and a creature entering — and named the rest rather than writing a
  framework from one example. CLAUDE.md, "A Persistent Area Catches You".
- **The clauses are transcribed, not taxonomised.** `AreaTrigger` has three
  fields and each is one SRD sentence; the three frequency behaviours everyone
  names fall out of the combinations. Web caps the *entry* and Insect Plague
  caps the *creature*, and a single per-turn stamp serving both is Insect
  Plague's rule wearing Web's name.
- **The end of a turn belongs to the turn that is ending.** `turnsTaken` has
  already moved on by the time the reducer sees `turn-advanced`, so stamping
  an end-of-turn debt with the new number split a creature's entry and the end
  of the very turn it entered on across two turns. Sharpest bug in the batch.
- **Settlement orders by the moment, never by the key**, and re-reads each debt
  against live state — an end-of-turn effect that drops a caster ends the Web
  a start-of-turn debt was for.
- **A test can pass against a mutation that should break it.** "A move that
  never leaves the area" walked to a landmark outside Grease's 10-foot Cube
  because the spot had been chosen for Web's 20-foot one. The assertion was
  right and the fixture was wrong; only a deliberate break said so.
- **A point is a point until a mechanic proves it needs to be more.** The
  spatial primitive is one optional field — `OngoingSpell.origin: Point` — and
  Spiritual Weapon is the adversarial case *for* it: the spell most obviously
  "a thing" prints no Armour Class, no Hit Points, no occupancy and no action
  of its own, where Unseen Servant and Arcane Hand print all four in the same
  book. A creature record would have been inventing numbers the SRD declines
  to give.
- **Actor and spatial origin are two different things**, and the seam is one
  optional argument (`resolveEffects`'s `from`). The Cleric rolls and the force
  is what is adjacent. The alternatives — teleporting the caster, or making the
  force a creature — were both lies in state.
- **Moving a spell's point is not creature movement**, and nothing about Speed,
  Difficult Terrain, Opportunity Attacks, occupancy or Disengage applies. The
  two share a *ruler* and nothing else, which is why `relocateOrigin` reuses
  `distanceBetweenPoints` rather than `moveCreature`.
- **A guard needs a fixture where it is the only thing that can refuse.** Two
  scene-extent checks looked tested and were not: in a 600-foot hall every
  space past the wall is also past the spell's range, so the range check
  answered first. The discriminating fixture is a room barely wider than the
  spell reaches. Third instance of this lesson, after the multiclass build and
  the Rogue who resisted nothing.
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

- **The SRD says which costs are already paid, and it is not "all of them".**
  Counterspell: "the action, Bonus Action, or Reaction used to cast it is
  **wasted**. If that spell was cast with a spell slot, the slot **isn't
  expended**." So the economy goes at declaration and never comes back, and the
  slot is not taken at all until the casting settles. **There is no refund
  anywhere in this**, which is the whole reason it could be built without a
  compensating event: `spell-declared` records what actually happened, and an
  interruption drops a slot that was never spent. Spend-and-reverse would have
  written a history that was false at both ends.
- **A window that is opt-in is a window that costs nothing.** `resolveSpell`
  without `hold` is byte-for-byte the command it always was, which is why every
  stored log still folds and `golden-log.json` was not touched. Most castings
  have no moment anybody can act in, and making every client perform a two-step
  ceremony to serve a usually-empty moment would be a worse API for no rules
  gain. The engine cannot know whether a Counterspell is coming; the layer
  holding the fight can.
- **The reducer branches on the casting id, not on "is anything pending".** A
  Counterspell is cast *while* a casting is open, so its own `spell-cast` must
  allocate the next id rather than trying to settle somebody else's casting.
  Asking "is a casting open" conflates the two and corrupts the log — and it is
  a mutation the suite catches seventeen tests' worth.
- **The id is allocated at declaration, so the settlement must not allocate
  again.** Naming the open casting is the entire point: `spell-interrupted`
  refers to `cast:3`, and so does a reader asking why Hold Person never landed.
  `spell-declared` advances `castingsBegun`; `spell-cast` settling one does not.
- **Settlement accepts no fresh request.** Targets, level and route were
  resolved and written down at declaration. A settlement that took a new
  request could declare Fireball at the goblins and settle it at the party, and
  nothing in the engine would have noticed — the same class of hole as a
  fixture working out its own save DC.
- **A deadline is pinned before the window opens, never after.**
  `resolveDuration` can refuse, and refusing *at settlement* is a window that
  can never be closed, which is a wedged fight. The same validate-before-rolling
  discipline, applied to the one new place it could be broken.
- **A guard above the duplicate check lies to a retry — third time.** The
  `casting_pending` refusal was written before the command-id check, and a
  retried declaration then reported that somebody was mid-cast: true, and it
  was the retry's own first run. `triggerRefusal` and the six unstamped
  commands were the first two. The shape is always the same — *a retry looks at
  the world its first run made* — and the duplicate check comes first, always.
  Found by a test, not by reading.
- **An unreachable guard is not a rule.** A first draft refused `hold` on a
  released readied spell; `ReleaseCommand` has no `hold` to pass, so the branch
  could never run. Removed in favour of the comment saying where the rule is
  actually enforced — the same reasoning that removed `ignoresPartialCover`.
- **A clause that excludes nothing is documented, not modelled.** Counterspell
  triggers on a spell "with Verbal, Somatic, or Material components", and all
  339 SRD 5.2.1 spells have one. A field whose only reachable value is "yes"
  would be a rule nothing enforces, so the gap rides in `unverified` and a test
  pins the count that makes it safe. If the data ever stops saying it, that
  test goes red rather than the engine quietly waving spells through.
- **A mutation that does not apply proves nothing.** One of the fourteen
  adversarial edits silently matched no text — wrong indentation — and
  "survived". Checking that the file actually changed is part of the technique,
  not a formality.

- **`unmodelled` means the fiction's, and it now has a guard that says so.**
  The tracked shape's one real hazard is that `effects: []` makes every spell
  castable, so any rule at all can be put in a sentence and the suite stays
  green. Two readings of the same note are worlds apart — "the DM decides what
  the badger says" and "the engine ought to floor this Armour Class at 17 and
  nobody has built it" — and at the table they are indistinguishable. So the
  line is drawn mechanically: `spell-tracking.test.ts` reads each tracked
  spell's **own SRD prose** out of the parsed book and scans it for thirteen
  clauses the engine demonstrably owns — dice, a saving throw, an ability
  check, an Armour Class, Hit Points, a Resistance or Immunity, a condition,
  Advantage or Disadvantage, a Speed, a percentage chance, a cost in feet of
  movement, a teleport, extra damage. A hit demands a written adjudication, and
  an adjudication that is **not** "the table's" must name an entry in an
  enumerated `MISSING_SHAPES` map. Tracking Barkskin therefore means writing
  `armor-class` against a shape id, which is a visible act in a list somebody
  reviews rather than a sentence in a spell nobody rereads.
- **The marker test is a floor, not a proof, and it is worth knowing which.**
  It reads prose, so a rule the SRD phrases in none of those words slips
  through: Gate and Etherealness move creatures between planes and trip
  nothing, and Arcanist's Magic Aura changes what other spells think a creature
  *is* without the word "condition". What it does catch is the easy mistake,
  which is most of them — it fires on forty of the forty-five utility spells
  this batch rejected. A test that made a stronger claim would have to parse
  the SRD's English, and a heuristic that pretended to would be worse than a
  floor that admits its height.
- **A written reason is a floor too.** Nothing stops somebody writing
  `why: 'table'` with a plausible sentence for a rule that is really missing
  machinery. That cannot be caught mechanically — it is the difference between
  a true sentence and a false one — so the guard forces the sentence to exist
  and to be specific, and review does the rest. Stated here rather than left
  as an implied guarantee.
- **The audit found exactly one of the original fourteen misfiled, and it was
  the interesting one.** Misty Step's note said the teleport was "a separate
  placement the caller makes" — which reads as a division of labour and is
  really a hole: **no command relocates a creature without charging movement.**
  `moveCreature` spends a budget and `placeCreature` refuses a creature that
  already has a position, so the 30 feet, the unoccupied space and the line of
  sight all go unchecked by anybody. The note now says that, `teleportation` is
  an enumerated shape, and the batch added no new spells to that debt: Plane
  Shift and Word of Recall are tracked because their destination is a *second
  place* the engine has no representation for at all, and Dimension Door and
  Tree Stride were left out because theirs is a point in this scene.
- **The distinction that decided every borderline case.** A clause is the
  table's when the engine's **own** resolution path would never reach it — the
  Disadvantage on a Perception check the DM calls for, the damage when a DM
  rules the stone was destroyed, the Prone on a creature inside an unmodelled
  demiplane. It is mechanical debt when the engine's own path *does* reach it
  and would silently give the wrong answer: Blur, because `resolveAttack` rolls
  every attack; Barkskin and Mage Armor, because the engine derives an Armour
  Class on each one; Death Ward, because the engine drops creatures to 0 itself.
  That line moved five spells out of the batch and let six awkward ones in.
- **A rule whose only reachable answer is "not applicable" is documented, not
  modelled — second user.** Nondetection hides its target from Divination
  spells, and every Divination spell the engine defines is cast at Self or at
  no creature at all, so the clause excludes nothing it can be asked about.
  Same reasoning as Counterspell's components clause, and the generalisation
  rule's second piece of evidence for it.
- **"Until dispelled" is not a long duration, it is the absence of one.**
  Arcane Lock and Continual Flame carry no `durationSeconds`, schedule no
  timer, and run until something ends them — and nothing does, because Dispel
  Magic needs an ability check the engine cannot make. Inventing a large number
  of seconds would have been the engine answering a question the SRD declined
  to ask.
- **A tracked spell's numbers are exactly as easy to get wrong as an executed
  one's, and less is watching.** Nothing downstream notices a duration that is
  ten minutes instead of an hour, so every one is quoted from the book in the
  docstring and `coverage.test.ts` checks name, level, school, casting time and
  Concentration against the parsed SRD. The duration is the field with no
  automatic check: mutating Tongues from 3,600 seconds to 600 is caught only
  because a test drives the clock past the deadline.
- **A mutation that does not apply proves nothing — and the way it fails is
  always new.** Stripping Find Traps' only `unmodelled` note "survived" the
  first attempt; the note contains a typographic apostrophe, the patch script
  read its own source through a Windows console codec, and the replacement
  silently matched nothing. Same lesson as the indentation slip in the previous
  batch, different mechanism. Check the file actually changed.
- **The tracked list is derived, not listed.** `spell-tracking.test.ts` built
  its fourteen spells by hand, and the fifteenth would have been the one nobody
  drove. It now reads `effects.length === 0` off the catalogue, which is the
  same predicate `coverage.ts` counts with — so the spells under test and the
  number in `COVERAGE.md` cannot disagree.

- **"An ability check inside a spell" was three mechanics wearing one phrase,
  and only one of them was buildable.** The audit was the work; the code is
  small. Twenty-two SRD spells contain the words, and they split:

  | Shape | Spells | Verdict |
  |---|---|---|
  | A creature checks against an ongoing effect — see through it, tear free of it | 20 | **built** |
  | The caster checks against a DC derived from *another* spell | Dispel Magic | blocked, see below |
  | A standing modifier on checks the spell did not create | Glibness, Hunter's Mark | not this mechanic at all |

  The third is the giveaway. Glibness replaces a Charisma check's die with a
  15 and Hunter's Mark grants Advantage on Perception or Survival — neither is
  a check the *spell* calls for, and generalising all three together would
  have produced a small programming language for checks instead of a rule.
- **The repeat save and the escape check look identical and are opposites.**
  Both name an ability, a DC and a consequence, and both end an effect on a
  success. What separates them is who decides they happen: a repeat save is an
  **obligation** the turn boundary raises whether anybody remembers it, and
  `pendingSaves` exists so that forgetting one stops the game. A check is an
  **opportunity** the table takes. Nobody is obliged to look at an illusion, so
  nothing raises it, nothing owes it and no turn blocks on it — which is
  exactly why it needed no pending-debt machinery and why building it on top of
  `RepeatSave` would have been wrong.

  | | Repeat save | Effect check |
  |---|---|---|
  | Decided by | the turn boundary | the table |
  | If nobody does it | the turn refuses to advance | nothing; it was never owed |
  | Costs | nothing | the Action, in combat |
- **`checks.ts` is reachable, and it was the fourth instance.** `rollAbilityCheck`
  had been complete, correct, tested and called by **no command at all** since
  it was written — only by its own unit tests. That is the same failure as
  `rollAttack` before `resolveAttack`, `moveCreature` before `resolveMove` and
  `rollDeathSave` before the turn boundary raised one: *a pure function nothing
  calls is a rule nothing enforces*. `resolveEffectCheck` calls it rather than
  re-deriving anything, so proficiency, Expertise, the armour penalties, a
  Blinded creature's automatic failure and the exhaustion penalty all apply
  because that function applies them. There is one ability-check calculator.
- **The timer was already the durable handle; nothing new had to be invented.**
  A check needs the DC an hour after the casting, by which time the caster may
  have levelled, changed which grant supplies the spell, or died. `RepeatSave`
  had settled this question already — it writes its DC down when the effect is
  created — so `EffectCheck` sits beside it on the same `TimedEffect` and is
  read back by `effectKey`, the handle `pendingSaves` has always used. An
  illusion hangs on the **casting's** timer; a Restrained creature's escape
  hangs on the **condition's**. Two placements, no registry, no new state
  container.
- **Who may attempt it is derived from what the timer sits on.** An effect on a
  creature is that creature's to shake off; a casting with no victim — an
  illusion standing in a corridor — is anybody's to see through. SRD Ensnaring
  Strike is the one exception ("the target **or a creature within reach of
  it**") and that spell is blocked on three other things, so the field waits
  for a second user.
- **`onSuccess` carries two members because only two can be written.** SRD
  writes a third — Maze, Phantasmal Force and Detect Thoughts end the whole
  casting on a successful check — and every one of those spells is blocked on
  something that is not the check. A value nothing can be written with is a
  value nothing reads, which is the argument `RiderDuration` already makes.
- **The check costs the Action, and no definition says so.** Every SRD instance
  of this shape spends one — "can take an action to make a Strength
  (Athletics) check", "must take the Study action to inspect your appearance",
  "must take a Search action" — so it is a property of the mechanism rather
  than of any spell. Outside combat there is no economy to spend, exactly as
  with a casting.
- **Which senses an attempt leans on is the caller's to state and the engine's
  to charge for.** Blinded "automatically fails an ability check that requires
  sight", and Minor Illusion is why that cannot live on the definition: it
  creates "a sound **or** an image", so one definition covers a check a blind
  creature can make and one it cannot. `senses` is a *fact* about the attempt,
  in the same category as a situational Advantage — and setting it either way
  cannot produce a success, because nothing the caller passes reaches the
  comparison.
- **An unknown creature is a request; an unknown effect key is a refusal.** The
  asymmetry is the whole "unknown is not false" rule applied twice in one
  command. A creature nobody has told the engine about is a thin *record* and
  there is a provider that fixes it. A timer key the engine has never issued
  cannot be made to exist by any fact out in the fiction — **the engine wrote
  every timer it holds**, so its own ledger is complete knowledge and a miss
  there is genuinely no.
- **Dispel Magic is blocked, and the blocker is worth the whole audit.** SRD
  2024: "Any ongoing spell of level 3 or lower on the target ends. For each
  ongoing spell of level 4 or higher, make an ability check using your
  spellcasting ability (DC 10 plus **that spell's level**)." The check itself is
  now trivial. What the engine cannot supply is the **level of the spell being
  dispelled**: `GameState` keeps no record of an ongoing casting beyond a
  counter, a concentrating caster's `{castingId, spell, level}`, and condition
  sources that carry a name and an id. Nothing holds the level of a casting
  whose caster is not concentrating on it, and nothing enumerates "the spells
  currently on this creature" with their levels.

  Taking the level from the caller was refused rather than built: the engine
  *emitted* that casting, so asking a model for its level is asking fiction to
  supply a fact the engine already established, which is the one thing
  invariant 6 forbids. The honest answer is a durable ongoing-casting record —
  and that is the handle the whole "ongoing effects a later turn acts through"
  bucket needs, so building it inside a batch about ability checks would have
  been exactly the smuggling this batch was told to avoid. Named, ranked, and
  left for the batch that does it properly.
- **A mutation that survives is worth more than nine that bite.** Relabelling
  Disguise Self's Investigation check as "the table's" passed every test:
  a written adjudication is only as honest as whoever wrote it, which the
  previous batch had already documented as this invariant's limit. But *that*
  claim turned out not to be a matter of opinion — a spell that executes a
  check carries one in its definition — so the invariant now asserts both
  directions, and the mutation bites. The limit was real and narrower than it
  looked.
- **`git checkout <file>` is not a way to undo a mutation.** It reverts to
  HEAD, and in a batch that has not committed yet that is every edit in the
  file, not the mutation. Half an hour of the invariant work went that way and
  had to be rewritten. Copy the file first; restore from the copy.

- **"Once per turn" is the allowance, and the qualifications are each feature's
  own sentence.** Four SRD features carry the allowance — Sneak Attack,
  Colossus Slayer, Divine Strike, Primal Strike — which is what makes it a
  shape rather than one class's quirk. What must *not* be generalised with it
  is the qualification: Sneak Attack wants Advantage or a flanking ally and a
  Finesse or Ranged weapon, Colossus Slayer wants a weapon and a wounded
  target, and folding those into one predicate language would be the trigger
  framework this batch was told not to build. They are declared fields on the
  grant, exactly as `usingAbility` and `meleeOnly` already were.
- **It is once per *a* turn, not once per *your* turn, and that is the whole
  reason it is state.** A flag would be cleared by the budget refresh at the
  start of the holder's own turn — the one moment it does not matter — and
  would go on blocking every Reaction in between. So the allowance records the
  global `turnsTaken`, exactly as `spellSlotSpentOnTurn` beside it does, and a
  Rogue who Sneak Attacked on their own turn may Sneak Attack again on the
  Opportunity Attack they take during the Fighter's. Mutating the comparison to
  a presence check fails two tests and nothing else, which is why both had to
  exist.
- **A failed qualification must not eat the allowance.** The spend is computed
  last, after every qualification has had its say, so a Rogue who swings a Mace
  still has their Sneak Attack for the dagger later in the turn. Reordering
  those two lines is a mutation the suite catches.
- **Sneak Attack's ally clause is the first rule to need *declared allegiance*,
  and it withholds rather than invents.** `side` is null until somebody says,
  so a table that is not tracking sides gets no ally — and the attack reports
  it in `unverified` rather than passing quietly. That is the same three-valued
  discipline cover and sight already use, reaching a class feature for the
  first time.
- **A held attack has to remember how its roll came out.** SRD Sneak Attack
  asks "if you have Advantage on the roll", and `resolveAttackDamage` settles
  the damage in a second call that would otherwise have to guess. `mode` joins
  `total` and `natural` on `PendingAttack` for the same reason those are there.
- **`free: true` is what a second attack in one turn actually is.** A Rogue's
  Attack action holds one attack, so the only honest way to swing twice on a
  turn is an attack whose cost is paid elsewhere — which is what
  `takeOpportunityAttack` passes and what the once-per-turn tests use.
- **A test fixture that forces a roll must force the right one.**
  `supply.bonuses` feeds saves, not the attack roll, so a "forced" +40 there
  did nothing and three tests were passing on the luck of their seed. The
  helper now puts the bonus on the command's own `attackBonuses` **and throws
  if the swing does not land** — a fixture that silently stops testing what it
  says it tests is worse than one that fails.

- **Naming no damage type is how "you can" is declined.** SRD Divine Strike and
  Primal Strike both let the holder choose the type at the hit, and both are
  written as "you **can** cause the target to take" — so the choice and the
  opt-out are the same act. There is no other moment at which declining could
  be said, and inventing a separate `decline` field would have been a second
  mechanism for a question the first already answers. Sneak Attack's own "you
  can" is *not* answered this way, because it has no choice to hang it on: the
  engine takes it automatically, and that is recorded in its note as a gap
  rather than pretended away.
- **A chosen type is extra damage, never a bonus — and a mutation proved the
  tests had not said so.** Divine Strike's Radiant is its own damage against
  the target's own Radiant defences; a mace's Bludgeoning is not. Discarding
  the chosen type so the dice rode as a weapon bonus passed *every* test in
  the file, because every fixture target resisted nothing. A
  Bludgeoning-immune thug settles it in one line: the mace deals nothing and
  the Radiant still lands. **A rule about damage types cannot be tested
  against a creature with no damage types.**
- **An "Improved X" feature that only raises a number executes through the
  first feature's own table.** Improved Blessed Strikes says "increases to
  2d8" and nothing else; the dice come from `diceCountByLevel` read at the
  character's class level, so the level-14 feature is the step rather than a
  second grant. Two grants would stack and deal both.
- **An illegal damage type is refused before the action is spent.** A Cleric
  asking Divine Strike for Fire is asking for a rule the SRD does not print, so
  `checkFeatureDamageTypes` runs before the economy and before the die — the
  same validate-before-rolling discipline, and the mutation that moves it after
  the roll fails two tests.

- **A Critical Hit carries its own auto-hit, and the SRD binds them in one
  sentence.** The glossary: "you score a Critical Hit, **and the attack hits**
  regardless of any modifiers or the target's AC." So Improved Critical does
  not merely double dice on a 19 — a Champion's 19 hits an Armour Class it
  could not otherwise reach. Reading the auto-hit as pinned to the *number* 20
  rather than to *scoring a critical* is the alternative, and it is the one
  that contradicts the sentence. Pinned by a test that rolls a 19 against
  Armour Class 50.
- **The natural 1 is pinned to the number, and no feature moves it.** SRD sets
  it by naming the face rather than by a rule a feature could restate, so the
  threshold check excludes it explicitly. Mutating that guard away lets a
  threshold of 1 turn a fumble into a critical, which a test catches.
- **A threshold restates the rule; it does not widen it.** Superior Critical
  says "on a roll of 18-20" rather than "one lower again", so the lowest grant
  wins — the same reading Extra Attack already takes of its own total, and for
  the same reason.
- **On the sheet, not in `standing.ts`.** There is no state of the world in
  which a Champion's 19 stops being a critical, so it is an always-on number
  read off the features at creation, beside `attacksPerAction`. A standing
  effect would be a conditional benefit with no condition.
- **A test that depends on a die face should *find* the seed, not hope for
  one.** The critical-range tests scan seeds for a first natural of 19, 18 and
  1 and say so. Three earlier tests in this file had been passing on the luck
  of a shared seed, which is the same failure in a quieter form.

- **Evasion is named for the SRD rule, not for either class.** The Rogue and
  the Monk both have a feature called Evasion and the texts are word for word
  the same, so `{ kind: 'evasion' }` is the same move `{ kind: 'expertise' }`
  already made — a grant named for a rule several features share. Where they
  differ is one clause, and it is a `StandingRequirement` on the Monk's feature
  alone: "You can't use this feature if you have the Incapacitated condition",
  which the Rogue's text does not say.
- **It bites only where the effect already offers half.** SRD: "an effect that
  allows you to make a Dexterity saving throw **to take only half damage**".
  Sacred Flame offers nothing on a success, so there is no half to take and
  Evasion says nothing about it — a distinction the `onSuccess` field already
  drew for a different reason.
- **A defence is read off the target.** The Rogue standing in the Fireball is
  the one who evades it, so the lookup is on the victim rather than on the
  caster — which is what makes it different in kind from every attack-damage
  rider in the two batches before it.
- **An area spell rolls its dice per target, and that makes cross-target
  arithmetic meaningless.** The first draft of the Evasion tests compared the
  Rogue's damage to a bystander's and failed on numbers that were simply two
  different rolls of 8d6. Worse, comparing the *same* creature across two casts
  is only sound when the generator consumes the same draws either way — and an
  evading target skips its damage roll entirely, so a second evader in the
  blast desynchronises the two runs. The tests are solo: one caster, one
  target, one save, one roll, and the only difference between the two logs is
  the sheet under test. **A fixture whose arithmetic depends on the dice must
  hold the dice still.**

- **Advantage on Initiative is its own grant, not a Dexterity save with a
  different name.** SRD says "Initiative rolls", and Initiative is an ability
  check rolled by a different function from a save — folding them together
  would have made Danger Sense's Dexterity-save Advantage apply to Initiative,
  which it does not. Two features want it (Feral Instinct, Remarkable
  Athlete), which is what makes it a member rather than a guess.
- **Advantage is presence, and a feature that grants it must still cancel.** A
  Barbarian with Feral Instinct and Disadvantage from somewhere else rolls
  *one* die, and both sources stay in `modeSources` so the record can say why a
  normal-looking roll was normal. Deduplicated by source, so a caller who also
  knows about the feature does not apply it twice — the rule Alert's flat bonus
  already follows, now applying to a mode.
- **Remarkable Athlete's Athletics half is reachable, and only because of last
  batch's work.** "Advantage on ... Strength (Athletics) checks" had nowhere to
  bite until a command rolled a skill check, and `resolveEffectCheck` is that
  command: a Champion tearing free of Black Tentacles rolls with Advantage. A
  feature and a spell meeting through a primitive neither of them named is the
  clearest evidence yet that the check shape was the right one.
- **Save proficiencies union rather than count.** Proficiency is binary, so a
  feature naming one the class already had is a no-op — the same rule
  overlapping skill proficiencies follow, and the reason the merge is a `Set`
  rather than a concatenation. Disciplined Survivor's "all saving throws" is
  spelled `'all'` rather than the six written out, because that is how the
  feature reads and because writing six is how one gets missed.

- **Nine features were counted as executed on the strength of a note, and
  executed nothing.** Bardic Inspiration, both Channel Divinities, Wild Shape,
  Second Wind, Action Surge, Monk's Focus, Lay On Hands and Sorcery Points all
  said "declared as a pool" and none was. A Bard built by the engine had a Hit
  Die, three spell-slot pools and a feat's free casting, and nowhere to spend
  an inspiration from.

  **This is the failure the coverage table exists to prevent, wearing the one
  disguise it cannot see through**: a feature declares its own automation, and
  nothing checked the declaration. The guard is now
  `class-pools.test.ts` — *a note that claims a pool must be a feature that
  declares one* — and it is worth more than the nine fixes it forced. A note is
  prose and cannot be parsed for meaning; what it can be checked for is that if
  it says the word, the feature has the thing.
- **The SRD sizes a pool three ways and each is here because a feature uses
  it**: a column of the class table (six of the nine), an ability modifier with
  a floor (Bardic Inspiration: "equal to your Charisma modifier (minimum of
  once)"), and a multiple of the class level (Lay On Hands: "five times your
  Paladin level"). Each read at *that class's* own level, so a multiclassed
  Bard's inspiration does not grow with their Fighter levels.
- **`recovers` is honest about which of these it can express.** Monk's Focus
  and Action Surge come back **whole** on a Short Rest and are tagged
  `short-rest`; Channel Divinity, Wild Shape and Second Wind give back *one*
  on a Short Rest and all on a Long, which the pool system cannot say, so they
  are tagged `long-rest` and their notes name the gap. Tagging them
  `short-rest` would hand a level 1 Fighter their whole Second Wind back after
  every breather.
- **Four features share that partial refill, which is the evidence the next
  batch wants.** Rage, both Channel Divinities, Wild Shape and Second Wind all
  say "one expended use when you finish a Short Rest" — five users of one
  shape, where an hour earlier it looked like Rage's private quirk. `restore()`
  in `resources.ts` already gives back N uses of one pool and is reached by no
  command: the sixth instance of *a pure function nothing calls is a rule
  nothing enforces*.
- **Arcane Recovery stopped being matched by id.** It was the one pool declared
  by name in `poolEvents` because "its single use is not a column in any
  table"; `minimum` covers that, so it now uses the same grant as everything
  else and the special case is gone.

- **"One expended use on a Short Rest" is a shape, and it took five users to
  look like one.** Rage carried it as a documented gap for months — "a partial
  refill the pool system has no shape for, where every other recovery is all or
  nothing" — and it read as that class's quirk. Declaring the other eight class
  pools in the batch before this one turned it into Rage, both Channel
  Divinities, Wild Shape and Second Wind saying the same sentence. That is the
  generalisation rule working the way it is meant to: the evidence arrived
  before the abstraction did.
- **A number rather than a flag, because the SRD writes a number.** All five
  say "one", and a boolean would be a rule that could only ever mean one.
- **A guard nothing can reach is not a rule, and a hand-built fixture can fix
  that.** The `recovers === 'short-rest'` check in `restoreOn` was unreachable
  through any class: every feature with a partial rule is also tagged
  `long-rest`, so a Long Rest takes the whole-refill branch before the partial
  one is consulted. The mutation that removed it passed everything. `restoreOn`
  is a pure function over a pool, so a pool that recovers at **dawn** and
  refills one on a Short Rest can simply be built — and it stands exactly in
  the gap the guard was defending. Better than `placeArea`'s dead
  `no_scene`, which stayed dead because nothing could construct its case.

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
- **A casting can be interrupted; a stack of them cannot.** `pendingCasting`
  holds one casting. A Counterspell answering a Counterspell is legal at a real
  table — Counterspell has Somatic components, so it triggers itself — and is
  refused here rather than nested, because a stack is a generalisation with one
  user and the doctrine says wait for the second. Named so it is a debt rather
  than a surprise.

  **Re-evaluated when the reaction windows landed, and the restriction stands.**
  Eight more class Reactions now run and not one of them needs nesting: a
  damage reduction cannot be reduced, a reroll cannot be rerolled, and
  Retaliation answers damage that has already landed. The second user still has
  not arrived, so the boundary is unchanged and is now documented in
  `CLAUDE.md` rather than only here. What *did* arrive is the evidence for the
  offer list — `pendingMove.provoked` had been one since Opportunity Attacks,
  and `pendingDamage` and `pendingTest` are the second and third, which is the
  order the generalization rule asks for.
- **~~`resolveSpell`'s `saves_pending` guard still sits above the duplicate
  check.~~ Paid**, and the reaction batch had added two more of the same shape
  beside it (`damage_pending`, `test_pending`). All three now live in
  `unsettledRefusal`, skipped for a replayed command, and `activateSpell` —
  which had none of them — reads the same function. Three failing tests in
  `ongoing-spells.test.ts` pin the order.
- **An offer is a (reactor, feature) pair.** Found by the second architecture
  audit: the reducer matched a Reaction answer by reactor alone, so a Rogue 5 /
  Monk 3 hit by a sword — offered Uncanny Dodge and Deflect Attacks together —
  crashed `settleDamage`, and a Fighter / Fiend Warlock's failed save produced
  a `test-settled` batch the fold refused. Fixed in the reducer and the settle
  commands; the multiclass fixture is the one that discriminates. Paid.
- **A readied spell left no live record**, the one of three resolution paths
  without a `spell-ongoing`; and `releaseCasting` did not drop the damage a
  casting had scheduled. Both paid, both pinned.
- **Named by the audit and deliberately left open**, each small and each
  waiting for the mechanic that would make it real:
  - `hit-by-attack` and `casting-a-spell` open on the *actor's* opt-in
    (`hold`) while the other three windows open on the engine's own detection,
    so a Rogue's *Shield* depends on the attacker's command. A pre-flight
    "could anybody answer this" query is the consistent shape.
  - Cutting Words is offered against allies' rolls too, so a Lore Bard makes
    every party hit a two-command exchange. SRD-correct; a tool-surface policy.
  - Spell attacks never open `damage-rolled` and no save inside a spell, a
    Concentration save or a repeat save opens `test-rolled` — Uncanny Dodge
    against Fire Bolt and Indomitable against Hold Person are both blocked on
    one thing, a casting's resolution suspended per target.
  - `OngoingSpell.concentration` has no reader and is derivable from the
    caster's record; `on` is not shrunk when a condition expires by its own
    timer while the casting persists (no executed spell reaches it — Sunbeam,
    the only candidate, is Range: Self); "Until dispelled" spells leave no
    record because `persists` reads a duration; a readied Mage Hand does not
    end the prior hand (`replacedCastings` runs at the cast, not the release);
    and a hand-built `spell-ongoing` for a casting that has already ended is
    accepted, because nothing records that a casting ended.
  - Reactor eligibility scans every creature in the game, not the scene or the
    fight. Fine at one scene; the shape to change when locations arrive.
- ~~**A spell can create a thing, and the thing cannot stand anywhere.**~~
  **Closed**, and the answer was smaller than the debt implied: a casting holds
  an optional `Point`, there is no thing and no record. The doctrine's one
  instruction — do not widen `CreatureState` into a property bag — was kept by
  not needing a second record either. What replaced it as the blocker is a
  *trigger*, not a position: an area that acts when a creature enters it or
  ends its turn in it. See item 1 of "Next actions".

  The four `OngoingSpell` debts listed above are **untouched and still open**:
  `concentration` has no reader, `on` does not shrink when an independently
  timed condition expires, "Until dispelled" spells leave no record, and a
  hand-built `spell-ongoing` for an ended casting is still accepted. None of
  them is on this primitive's path — the origin is created, moved and removed
  through the record's existing lifecycle — so none was touched.
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

## The utility bucket, audited spell by spell

Ninety-one SRD spells are filed as "narrative or exploration". Fifteen were
already implemented — thirteen tracked, plus Guidance and Divine Smite, which
are executed. The remaining **seventy-six were read one at a time against their
own SRD paragraph**, not filed by shape, and partitioned three ways.

| | | |
|---|---|---|
| **A** | everything mechanical is already the engine's; the rest is fiction | **30, all now tracked** |
| **B** | carries a rule the engine should own, and a shape is missing | 42 |
| **C** | depends on a world fact nothing can represent, and inventing one is not on | 4 |

Thirty is not a ceiling anybody hit — it is what survived the line drawn under
"Decisions" above, and the forty-six left out are the map below.

**The four in C**, because they are the only ones whose blocker is not a
mechanism at all: **Etherealness** and **Gate** (the Ethereal Plane and other
planes are not represented, and a spell whose whole effect is being somewhere
else has nothing to be tracked *at*), **Meld into Stone** (every mechanical
clause it has — 6d6 Force, 50 Force, Disadvantage on Perception, Prone on
expulsion — hangs off "you are inside a rock", which is a state nothing can
hold), and **Sending** (SRD prints its range as **Unlimited**, which
`SpellRange` has no member for, and its recipient is a creature that need not
be on the scene or on the plane).

Three spells were rejected for a reason worth naming separately, because they
look like the ones that got in: **Dimension Door** and **Tree Stride** teleport
to a point *in this scene*, which is a position the engine owns, and
**Nondetection**'s neighbour **Arcanist's Magic Aura** changes what other
spells believe a creature's type to be, which `mustBeType` reads on every
casting.

### The shapes that block the rest, ranked

Measured across all 223 parsed spells the engine has no definition for, not
just the utility bucket — a shape is worth building for what it unblocks
everywhere. A spell can need more than one, so the columns do not sum.

| Shape | Open spells | What exists already | Risk |
|---|---|---|---|
| An ability check inside a spell | 22 | `checks.ts` entire, save-DC derivation, the turn-hook machinery a repeat *save* uses | low |
| A standing Advantage or Disadvantage a spell grants | 25 | `ModeSource`, `standingSaveModes`, the merge in `savingSupport` | medium |
| A condition applied with **no** saving throw | 9 | `applySpellEffect` already applies a condition with a casting link and a deadline | very low |
| Resistance or Immunity a spell grants | 17 | `defensesOf`, `CreatureState` defences, standing resistances from features | low |
| Healing that lifts a condition, raises the dead, or raises the maximum | 10 | the `heal` effect, `healCreature`'s refusal of a corpse | low |
| Teleportation | 13 | positions, occupancy, `placeCreature`'s volume test | medium |
| Damage with neither an attack roll nor a save | 19 | `rollSpellDice`, `dealSpellDamage` | low |
| An effect that ends another casting | 15 (**unblocked**) | `state.ongoing` names every running casting, its caster and its level; `spell-ended` ends one whole or on one creature | low |
| An Armour Class a spell sets or floors | 13 (≈4 real) | Unarmoured Defense already replaces the calculation for a *feature* | low |
| A random outcome that is not a d20 | 11 | the generator, `parseNotation` | low |
| Extra damage on the target's later attacks | 7 | `damageBonuses` / `extraDamage`, Rage Damage, Radiant Strikes | medium |
| A Speed a spell changes, and movement modes | 4 printed, far more in play | one `baseSpeed`, no modes | medium |
| Reads the target's current Hit Points | 3 | vitals | very low |

**1. An ability check inside a spell — and the repo's existing note was right,
for a reason the note did not give.** It is not the largest bucket and it is
the one to build first anyway, because of *which* spells it unblocks. Eight of
the twenty-two are illusions — Silent Image, Minor Illusion, Major Image,
Phantasmal Force, Seeming, Programmed Illusion, Project Image, Hallucinatory
Terrain — whose effect is pure fiction and whose **only** mechanical clause is
the Intelligence (Investigation) check against the caster's save DC. That is
the tracked bucket's own neighbouring population: one rule each, and the rule
is this one. Four more are escape checks at a turn boundary (Web, Entangle,
Spike Growth, Ensnaring Strike), which is `RepeatSave` with a check in place of
the save rather than a new mechanism. Dispel Magic and Maze are the caster's
own check against a fixed DC. And three spells *already tracked* name it as
their blocker — Disguise Self, and Glibness and Maze wait behind it.
It reaches `checks.ts`, which is complete, tested and unreachable from any
casting: the fourth instance of "a pure function nothing calls is a rule
nothing enforces", which this file has now recorded three times before.

**2. A standing Advantage or Disadvantage a spell grants.** The largest count
and the highest value at a real table — Blur, Haste, Hex, Hunter's Mark,
Hideous Laughter, Enhance Ability, Beacon of Hope. Second rather than first
because it needs one genuine design decision that the check shape does not: a
mode that applies to rolls made **against** the holder rather than by them.
`BonusApplies` has no such direction, `resolveAttack` does not read the
defender's stored modes, and picking wrongly there would be a mechanism that
has to be rebuilt. Evidence first.

**3. A condition with no saving throw.** The smallest thing on this list — one
`SpellEffect` member, resolving through the same `applySpellEffect` that every
`save` effect already ends at — and it lands Invisibility and Greater
Invisibility outright, whose mechanical consequences `conditions.ts` already
computes context-dependently. Best result for the effort; third only because
nine spells is nine spells.

**4–6** are three low-risk extensions of shapes that already exist, in the
order their counts fall: Resistance and Immunity hung on a casting, healing
that does something besides restore Hit Points, and a `teleportCreature`
command that relocates without charging a movement budget. The last of those is
the first *command* on this list rather than an effect kind, and it is the one
that pays off a debt this batch had to name rather than opening new ground.

**Everything below that is small or rare**, and none of it should jump the
queue on the strength of a count: Magic Missile's undodgeable darts, Power Word
Kill's Hit Point threshold, and Teleport's and Divination's percentile tables
are each one spell's worth of rule wearing a shape's clothes.

Unchanged and still above most of this when measured by spells alone: **areas**
are done but fifty area spells remain open on *other* shapes, **long casting
times** block 43, **ongoing effects a later turn acts through** block 18, and
**summons** block 9. Those four are the standing items below.

### Where the twenty-two check-bearing spells stand now

Every spell whose SRD text carries a check the spell itself calls for,
classified **after** the primitive exists. The point of the column on the
right is that the check was never the only thing wrong with most of them.

| | Spells |
|---|---|
| **Executed, check and all** | Black Tentacles |
| **Tracked, with the check executed** | Disguise Self, Minor Illusion, Silent Image |
| **Already executed; check genuinely unreachable** | Freezing Sphere — its Restrained applies to creatures swimming on water the spell froze, and freezing water is not modelled |
| **Still blocked** | the other seventeen, below |

| Spell | What still blocks it |
|---|---|
| Web, Spike Growth, Earthquake, Control Water | an area that acts on later turns — the save fires when a creature *enters* or *ends its turn* there, and nothing raises that |
| Detect Thoughts, Project Image | an ongoing effect a later turn acts through (a Magic action that drives the spell) |
| Glyph of Warding, Symbol, Hallucinatory Terrain, Tsunami | a casting time of a minute or more |
| Maze | a condition applied with **no** saving throw; the check is ready and the banishment is not |
| Phantasmal Force | a saving throw whose failure creates something that is not a condition, plus damage on the caster's later turns |
| Ensnaring Strike | cast on a hit, plus damage at the start of each of the target's turns |
| Entangle | its area excludes the caster — "Each creature (**other than you**) in the area" — and exactly one SRD spell says that, so the field waits for a second user |
| Major Image | Concentration and duration that **change with the slot level**: "lasts until dispelled, without requiring Concentration, if cast with a level 4+ spell slot", which `SpellDefinition` cannot express |
| Programmed Illusion | a duration of "Until dispelled", so the casting gets no timer and there is nothing for the check to hang on |
| Seeming | a saving throw only *unwilling* targets make, and willingness is not modelled |
| Dispel Magic | the level of the spell being dispelled — see the decisions above |

Four of those blockers are new findings this batch rather than restatements:
**an area that acts on later turns** is a different thing from an area (the
area model works; what is missing is a trigger when somebody walks into one),
**slot-dependent Concentration**, **"Until dispelled" leaves nothing to hang a
rider on**, and **an area that excludes its caster**.

### The ranked map, recalculated after the batch

Measured across the 221 parsed spells the engine has no definition for. A spell
can need more than one shape, so the counts do not sum.

| Rank | Shape | Open spells | What exists already | Risk |
|---|---|---|---|---|
| 1 | An ongoing effect a later turn acts through, **and the casting record it needs** | 18 + Dispel Magic + 17 "ends another casting" | timers, casting ids, `pendingCasting` | medium |
| 2 | A standing Advantage or Disadvantage a spell grants | 25 | `ModeSource`, `standingSaveModes`, the merge in `savingSupport` | medium |
| 3 | An area that acts on later turns | ~12 | areas, positions, turn boundaries, `pendingSaves` | medium |
| 4 | A condition applied with no saving throw | 9 | `applySpellEffect` entire | very low |
| 5 | Resistance or Immunity a spell grants | 17 | `defensesOf`, standing resistances from features | low |
| 6 | Healing that lifts a condition, raises the dead, or raises the maximum | 10 | the `heal` effect | low |
| 7 | Damage with neither an attack roll nor a save | 19 | `rollSpellDice`, `dealSpellDamage` | low |
| 8 | Teleportation | 13 | positions, occupancy, `placeCreature` | medium |
| 9 | An Armour Class a spell sets or floors | ~4 real | Unarmoured Defense already replaces the calculation for a feature | low |
| 10 | A random outcome that is not a d20 | 11 | the generator | low |

**1. An ongoing casting a later turn can act through — and it moved to the top
because of what this batch found, not because of its count.** Going in it was
fourth. Three separate blockers turn out to be the same missing thing: a
**durable record of a live casting** — its level, its caster, and the route
that set its DC.

- **Dispel Magic** needs the level of the spell it is dispelling, and nothing
  holds it.
- **Spiritual Weapon and Call Lightning** (18 spells) need a casting a later
  turn can name and spend an action through.
- **Seventeen spells end another spell** — Dispel Magic, Antimagic Field,
  Darkness against Daylight — and every one needs to enumerate what is running.

That is three concrete mechanics demanding one primitive, which is precisely
the evidence the generalization rule asks for before building one. It is also
the first item on this list whose absence makes the engine *lie by omission*
rather than merely refuse: a Wizard can already cast Silent Image, and the
party's Cleric cannot dispel it.

**2. A standing Advantage or Disadvantage a spell grants** keeps the largest
raw count and the highest table value — Blur, Haste, Hex, Hunter's Mark,
Hideous Laughter, Enhance Ability, Beacon of Hope — and it now has a second
argument in its favour: Glibness and Hunter's Mark fell out of *this* batch's
audit into that bucket, so it is where the ability-check work's leftovers went.
Second rather than first only because it needs one design decision the check
shape did not: a mode that applies to rolls made **against** the holder, which
`BonusApplies` has no direction for and `resolveAttack` does not read.

**3. An area that acts on later turns** is new to this ranking and is the
reason four check-bearing spells are still blocked. The pieces are unusually
close: areas resolve, positions are exact, and `pendingSaves` already shows how
a boundary raises an obligation. What is missing is a *trigger* — "the first
time a creature enters the webs on a turn or starts its turn there".

**4. A condition with no saving throw** is still the cheapest thing on the
list — one `SpellEffect` member through machinery that already applies
conditions with a casting link and a deadline — and it now unblocks Maze
outright, whose check is built and waiting.

**5–10** are unchanged in character from the previous batch's map and unchanged
in order except that teleportation slipped: the previous batch had to name it
as a blocker, and nothing since has made it more pressing.

## The class-feature map, after eleven batches

All 150 non-executed features grouped by the mechanical primitive each needs,
rather than by class. Four more batches took 75 executed features to 80 and
finally spent pools that had been declared and idle since they landed.

| Rank | Shape | Features | Why it is where it is |
|---|---|---|---|
| ~~1~~ | ~~A Reaction a feature takes in answer to something~~ | **8 built** | see below |
| 1 | A turn-scoped stance later rolls read | ~4 | Reckless Attack, and Frenzy waits behind it |
| 2 | A Speed a feature changes | ~5 | blocked on a module seam, not on a rule |
| 3 | An ability modifier on spell damage | 3 | small, and the SRD wording is ambiguous on multi-target spells |
| 4 | An action taken as a Bonus Action | ~4 | Cunning Action, Patient Defense, Step of the Wind, Fleet Step |
| 5 | Weapon mastery properties | 5 | parsed onto weapons, executed by nothing |
| 6 | Transformations | ~6 | Wild Shape's Beast form, and every summon |

**A Reaction a feature takes — built.** Eight run: Uncanny Dodge, Deflect
Attacks, Deflect Energy, Cutting Words, Peerless Skill, Indomitable, Dark One's
Own Luck, Retaliation. `reduceDamage`, `interveneAfterRoll` and `rerollTest`
are all fired at last.

The architectural question was put and answered: **class features do not reuse
the spell machinery, and both sit on a shared window vocabulary instead.** A
spell Reaction is a *casting* — definition, route, slot, action — and a feature
has none of those; what the two genuinely share is the *instant*. See "A
Reaction Is A Window, Not A Trigger" in `CLAUDE.md`.

What is left in this family, each blocked on something named:

| Feature | Blocked on |
|---|---|
| Countercharm | a spell's saving throws being interruptible, **and** a save that records what it was against |
| Superior Hunter's Defense | a Resistance with a deadline, granted in play |
| Slow Fall | falling, which nothing models |
| Disciplined Survivor's reroll | a feature carrying two grants; it already grants six save proficiencies |
| Deflect Attacks' redirect | chaining a second effect — a save and damage — onto a reaction |
| Bardic Inspiration, the holder's use | a resource one creature confers on another |
| A stat block's printed Reactions | `adaptMonster` does not read the Reactions block at all; seven monsters print Parry, which is *Shield*'s window exactly |

**2. A turn-scoped stance.** Reckless Attack, Frenzy, Steady Aim, Studied
Attacks, Sacred Weapon. "Until your next turn" is a deadline the duration
system owns; whether a stance is a `TimedEffect`, a standing effect with a
turn-anchored requirement, or a third thing is a design call with four
features riding on it.

**3. A Speed a feature changes — a seam, not a rule.** Fast Movement,
Unarmored Movement, Roving, Second-Story Work, Acrobatic Movement. "+10 feet
while you aren't wearing armour" is trivial; the blocker is that a combatant's
Speed is captured into `CombatState` at `combat-started` and `beginTurn`
refreshes the movement budget from it, while `combat.ts` is deliberately a
pure module over `CombatState` with no access to creature state. Fixing that
means passing creature state into the turn boundary or moving Speed out of the
combat order, and both are decisions about module boundaries.

**4. An ability modifier on spell damage.** Potent Spellcasting (Cleric and
Druid) and Empowered Evocation. SRD says "add your Wisdom modifier to the
damage you deal with any Cleric cantrip" and does not say whether that is once
or once per target on a cantrip that hits several; Empowered Evocation says
"one damage roll", which is different again.

**5. An action taken as a Bonus Action.** Cunning Action (Dash, Disengage or
Hide), Patient Defense (Disengage), Step of the Wind (Dash), Fleet Step. The
economy already distinguishes an Action from a Bonus Action and `takeDash`,
`takeDisengage` and `takeDodge` all exist; what is missing is a grant saying
which actions a feature may pay for the other way, and the paid upgrades
("expend 1 Focus Point to take **both**") are a second shape. **Hide is not an
action the engine models for anybody**, which is the one thing to settle
before starting: whether Cunning Action can honestly be called executed while
one of its three actions does not exist.

**6. Weapon mastery properties.** Cleave, Graze, Nick, Push, Sap, Slow,
Topple, Vex, wanted by five classes. They are parsed onto the weapons already.
Each is a small rule and several of them touch the attack pipeline in
different places, so it is a batch of eight transcriptions rather than one
primitive — which is why it is below the four above it despite being unblocked.

**Two smaller things noticed in passing and not fixed:**

- **No Epic Boon feat is defined**, so no character above level 18 can be
  created. Every class's level 19 feature grants one and the feat catalogue has
  none, and no test builds a character that high, so nothing says so.
- **Excess-property checking does not protect an event type.** A command
  emitted `command: stamp` on an event whose type did not declare the field
  and TypeScript accepted it, because a union accepts a property any member
  declares. The idempotency sweep is what caught it.

## Next actions, in order

1. ~~**A spell-created thing with a position of its own.**~~ **Done.** The
   primitive is `OngoingSpell.origin: Point` — one optional field, a
   `spell-origin-moved` event, and cleanup that needed no new code because
   `releaseCasting` already removed the record. Spiritual Weapon proved it end
   to end: it appears in a space within 60 feet, strikes from that space, is
   moved 20 feet on a later Bonus Action, and the attack is measured from the
   point while the roll stays the caster's. See CLAUDE.md, "A Casting Can Hold
   A Point".

   **What the audit actually found.** Thirty-nine SRD spells keep a place, not
   eleven, and they do not split the way the previous note guessed — the line
   is drawn by what the SRD *prints*, not by whether the thing moves:

   | | Spells | Status |
   |---|---|---|
   | A point the caster acts from | Spiritual Weapon | **built** |
   | A point the casting keeps and never moves | Call Lightning's cloud, Web, Grease, Fog Cloud, Darkness, Moonbeam, Silence, Spike Growth, Zone of Truth, Wind Wall | the same storage with no `movableBy`; blocked on the triggers below |
   | A thing with printed statistics | Unseen Servant (AC 10, 1 HP), Arcane Hand (AC 20, HP, Large, grapples), Guardian of Faith, Faithful Hound, Phantom Steed, the four Conjures, Summon Dragon, Giant Insect | the **summons** seam, and it is not close to this one |
   | A point whose effect the engine cannot model | Dancing Lights and Daylight (light), Arcane Eye and Passwall (walls as obstacles), Project Image and Secret Chest (a second location) | blocked elsewhere |

   So **a fixed origin and a movable origin share state without sharing
   commands**, which is why the allowance is a field (`origin.movableBy`)
   rather than a boolean beside one. Nothing was built for the fixed case,
   because no fixed-origin spell is unblocked by it alone.

   Three named mechanics now stand between the primitive and the next thirty
   spells, and each is a *trigger* rather than a position:

   - ~~**"a creature that ends its turn in the area"**~~ and
     ~~**"a creature enters the area"**~~ — **both built.** See CLAUDE.md,
     "A Persistent Area Catches You At A Moment The Spell Names": a casting
     keeps its area (the point it already kept, plus the *direction* a
     directional shape was laid along), the turn boundary and an authoritative
     position change raise an `OwedAreaEffect`, and `settleAreaEffects` runs
     the spell's own effects at the level and route the casting was made with.
     Insect Plague, Web, Grease and Black Tentacles all execute, and no two of
     them agree about the boundary or the cap — which is why they were the
     proving set.

     What is **not** built, and each is its own detection rather than a
     variant: an area that *moves onto* a creature (Moonbeam, Cloudkill,
     Incendiary Cloud, Spirit Guardians all print "when the area moves into
     its space" as a separate clause, and no fixed area prints it); a path or
     a distance travelled (Spike Growth); an aura the holder carries; an
     activation that blasts a chosen point (Call Lightning); a barrier (Wind
     Wall). **Stinking Cloud** is start-of-turn and would be a transcription
     but for its consequence: "Poisoned **until the end of the current turn**"
     is a deadline shape the engine does not have, and applying it for the
     casting's minute instead would be a wrong number rather than a missing
     rule.
   - **an activation that resolves an area at a point chosen now** — Call
     Lightning, Storm of Vengeance. Audited as the candidate second user of the
     primitive and rejected: the cloud is exactly the fixed origin wanted, but
     every activation in the engine aims at a creature, and Call Lightning aims
     at a point and blasts around it. A new shape, not a transcription — and
     its "a point you can see" and outdoor-storm damage bonus are facts the
     engine does not hold either.

   **One origin per casting, deliberately.** Dancing Lights is the only SRD
   spell that makes several independently placed things from one casting, and
   it is blocked on light being modelled at all. Adding an index to the event
   and the record later is additive; choosing plurality now would be a shape
   built ahead of any mechanic that could use it.
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
4. **Ongoing effects a later turn can act through** — mostly built. The handle
   exists (`state.ongoing`, keyed by casting id), the spells that need nothing
   else run (Vampiric Touch, Flame Blade), and the ones that act **from a
   point** run too (Spiritual Weapon). Expeditious Retreat, Gust of Wind,
   Telekinesis and Detect Thoughts need neither and are ordinary transcription
   onto `activation`. What is left in this family is not a position any more:
   it is the three triggers named under item 1.
5. **The Reaction spell that is left, and the falling it shares with a
   feature.** Shield, Hellish Rebuke and Counterspell are done, and the class
   features that answer the same instants are done beside them.
   - **Feather Fall** and **Slow Fall** — both need falling. Nothing falls,
     nothing takes fall damage, and no rate of descent is modelled. Two
     mechanics wanting the same missing thing is what would make it a shape;
     it is still furthest away by a distance.
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
| Spells executed | 77 |
| Spells verified end to end | 53 |
| Spells tracked (cast, effect narrated) | 46 |
| Classes | 12 of 12, each with its SRD subclass, levels 1–20 |
| Class features executed | 88 of 230 |
| Tests | 3,981 passing, none skipped |

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
