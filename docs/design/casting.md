# Casting: slots, identity, interruption, and what a casting leaves behind

What a casting *is* — a thing with an identity — how it is paid for, how it can be held open, interrupted, or run across minutes on the clock, and what it leaves behind. **Read this before changing casting, pending castings, ongoing spells, or `commands/casting.ts` and `commands/spell-resolution.ts`.**

> **Authority.** This document is authoritative for its subject. It was
> extracted verbatim from `CLAUDE.md` when that file became the
> constitution and router; the sentences below are the repository's own
> reasoning, unchanged. `docs/IMPOSSIBILITY_ENGINE_DOCTRINE.md` outranks it,
> and `CLAUDE.md` outranks it on anything it still states directly.

---
## Spell Slots Are Pools; A Casting Is A Thing With An Identity

Two ideas carry the whole spell system, and neither is about spells.

**A spell slot is not special.** `resources.ts` holds named pools — a key, a
maximum, a count spent, and what refills them — and slots are just pools named
`spell-slot:1` through `spell-slot:9`. Channel Divinity, Ki, a wand's charges
and a dragon's breath recharge are the same mechanism. Pools are **declared,
never derived**: the engine does not know that a level 3 Wizard has four level
1 slots, because that is a class table and class progression is not modelled.
Keeping the two apart is what lets the pool system land before the class system
does, rather than waiting on it.

**A casting has an identity.** "Hold Person" is not the thing that is running;
*this* casting of Hold Person, by this caster, at this level, is. Two Clerics
can hold the same goblin, and one of them losing Concentration must end exactly
one of the two paralyses. So every casting gets a sequential id — `cast:1`,
`cast:2`, never random, because replay has to reproduce them — and every effect
it creates carries that id inside its source: `Hold Person#cast:3`.

That encoding is deliberate on both sides. `castingIdOf` makes cleanup an exact
match rather than a search for a spell name, which would catch the other
Cleric's spell too. `spellOfSource` gives the narration layer the readable half
back. The engine never has to choose between being precise and being legible.

**Losing Concentration is derived, not commanded.** SRD: "Your Concentration
ends if you have the Incapacitated condition or you die." Nobody decides that,
so the reducer applies it after every event — which means it catches the break
however it arrived: damage to 0 hit points, a Stunning Strike, Exhaustion
reaching 6. No log, however assembled, can produce a state where a dead
wizard's Hold Person is still running. Ending it *by choice* or *by a failed
save* is a decision, so those are events with a reason attached.

The same split explains where the effects go. `concentration-ended` does not
enumerate the conditions it lifts; the reducer finds them by casting id. A
command that listed them would be building a batch against a snapshot, and a
retry a moment later would find that list stale.

**Damage settles its own Concentration save.** `resolveDamage` applies the
damage, works out whether a save is owed, rolls it when given a generator, and
ends the spell in the same batch when it fails. The pieces — `damageCreature`
and `concentrationSaveAfterDamage` — still exist, but composing them meant the
caller had to *remember* the second call, and a caller who forgot left a spell
running that the rules had ended. Remembering is not a thing to design around.

The save is skipped outright when the damage *already* ended the
Concentration — a caster dropped to 0 is Unconscious, therefore Incapacitated,
therefore no longer concentrating, so rolling would waste a die and imply the
spell might have survived. That case reports `already-lost` rather than `none`,
because "nothing to roll" and "it is already gone" are different answers.

**The generator is required, and that is a correction.** An earlier version
made it optional and returned the unrolled save as a `pending` obligation. It
was wrong three ways over, and the third is the one that matters:

1. Nothing in the log or the state held the obligation, so it did not survive a
   reload.
2. Nothing consumed it either, so "resolve exactly once" had no handle —
   `concentrationSaveAfterDamage` is a query and answers the same way however
   often it is asked.
3. **The damage event had already spent the command id.** Retrying the same
   command to make good on the save came back a duplicate no-op reporting
   `none`. The spell stayed up, the save was never made, and the engine said
   everything was fine.

An obligation the engine cannot keep is worse than one it never offered. Every
`ConcentrationConsequence` is now settled, and requiring the generator costs a
caller nothing: they resume it from the state they are already holding. A
caller who wants to look before rolling asks the query, which promises nothing.
If a genuinely deferred save is ever needed — holding the roll open so a player
can spend something first — it needs to be an event and a piece of state, not a
return value.

**The casting id is knowable before the cast.** `nextCastingId(state)` reads
the counter, so a caller can build the source string for the conditions a spell
imposes without digging the id back out of the emitted events. `castSpell` run
twice against the same state produces byte-identical batches — that is what
retry-safety means here — and appending one of them twice is caught as a
corrupt log, because the second copy's id is no longer the next one in
sequence.

### Casting spends the action it costs

`castSpell` validates the spell and expends the slot. It does not touch the
action economy, because it predates having one to touch — and that gap let a
caster throw two Fire Bolts in a turn, since neither expends a slot and the
one-slot-per-turn rule therefore never fired. SRD is plain: "Most spells
require the Magic action to cast", and two Magic actions on one turn is not a
turn.

`resolveCast` is the whole cost of a casting: it validates the spell, spends the
action, Bonus Action or Reaction the casting time names, expends the slot, and
moves Concentration — or refuses and changes nothing at all. The spell is
validated first and the economy second, so a refusal on either side leaves
slots, Concentration and the budget as they were. A retried command id is a
no-op on both halves.

`castSpell` stays for callers reconstructing a log or scripting a fixture,
where the economy is already accounted for. Same split as `damageCreature`
beneath `resolveDamage`, and the same policy: the low-level half exists, and
Maestro's tool surface does not expose it.

**`resolveCast` is a low-level half too**, and this file said the opposite for
a while. Its own docstring has always said that a Reaction's trigger "is
checked one layer up" — `resolveSpell` is where `triggerRefusal` reads the
window, where `unsettledRefusal` asks whether anybody may act at all, and where
the targets, the range and the sight lines are checked. So the operation a tool
surface exposes for a spell the engine has a definition for is `resolveSpell`;
`resolveCast` is what is left for a spell it has none for.

**It is guarded by `mayAct` now, and that debt is discharged.** The exemption
that covered it called itself "a named debt rather than a settled exemption",
and the debt was precise: being the low-level half is a *policy* about who
calls it, and a policy is not a guard. It spends an Action and a slot, so a
caller reaching it while a persistent area owed somebody a saving throw acted
into a world nobody had settled. The one path that must **not** be refused is
the Divine Smite cast inside `resolveAttackDamage`, which settles an attack the
engine is already holding open — so that one calls `resolveCastWith`, the half
with the identity already established, and the exemption that protects the
settlement keeps protecting it. The guard sits **inside** the `once` callback,
which is what `once` is for.

Outside combat there is no economy to spend, so `resolveCast` simply casts.

### What the engine refuses, and what it declines to judge

A refusal costs nothing: no slot, no generator advance, no state change. That
is the existing "validate before rolling" discipline, and casting is the easiest
place to break it, because the natural order — spend the slot, then check —
reads fine and is wrong.

It refuses a slot smaller than the spell, a slot level with none left, a
cantrip that asks for a slot, a level 1+ spell that names neither a slot nor a
reason to skip one, a caster who is Incapacitated or dead, a caster in armour
they lack training in, and a spell name carrying the `#` that would forge a
casting link.

It **declines to judge** whether the caster knows or has prepared the spell, or
has the components. Spell lists, preparation and inventory are not modelled, and
refusing on a rule the engine cannot evaluate is worse than leaving it to the
layer that knows.

### One dispatch, and the rules it dispatches to live next door

`commands/spell-resolution.ts` holds the casting, the pre-flight, the loop and
the dispatch. It does **not** hold the rule each effect kind applies: that is a
function per effect kind over one gathered `EffectContext`, and they live in
sibling modules named for the family each rule belongs to.

| module | the kinds it holds |
|---|---|
| `commands/spell-effect-rolls.ts` | `attack`, `save-damage`, `save` |
| `commands/spell-effect-grants.ts` | `buff`, `roll-mode`, `armor-class`, `damage-defense`, `speed`, `attack-rider` |
| `commands/spell-effect-hit-points.ts` | `heal`, `temp-hp` |
| `commands/spell-effect-conditions.ts` | `condition`, `end-condition` |
| `commands/spell-effect-magic.ts` | `dispel`, `interrupt-casting` |
| `commands/spell-effect-teleport.ts` | `teleport` |

with `commands/spell-effect-context.ts` holding the context type and
`commands/spell-effect-riders.ts` holding what a settled outcome carries —
`applyRiders` and the three pieces it composes.

**The families are the engine's own, not a filing convenience.** The six in
`spell-effect-grants.ts` are exactly the six `grantsOf` walks in
`fold/release.ts`, so the enumerator and the resolver set are the same list
written twice; a seventh family joining one joins the other. The three in
`spell-effect-rolls.ts` are the only three that **host an outcome** —
something rolled, an affirmative branch, riders hung on that branch — which is
the whole of what `applyRiders` exists for, and every other kind lands or does
not land with nothing for a rider to ride. And `spell-effect-teleport.ts`
holds one function, because one is how many are in its family: a module of one
is the true answer where a contrived family would not be.

**The dispatch is still one `switch` with one `never` default**, and moving the
bodies out is exactly why that matters more than it did. The `never` binding is
what makes a kind added to the union and not to the dispatch a compile error
rather than a wrong answer in a fight — a lookup table keyed by `kind` would be
satisfied by a partial one, and a table assembled out of six modules would be
satisfied by five of them.

**`EffectContext` is a leaf both halves import**, which is the one placement
decision the split had to make. Left where it was, every resolver module would
import the module that imports it; that compiles, because a type is erased, and
an import cycle that survives only because of erasure is not an acyclic graph
but one whose failure has been deferred to whichever module loads first.
`packages/engine/scripts/spell-resolution-graph.ts` is the evidence — the same
declaration-level walk `fold-graph.ts` runs, over this family, reading the
layout from a JSON file so that it answers **before and after** the move and a
precondition is not something only the finished code can be asked.

**Why this file and not another.** It was the engine's measured contention
point: across one tranche of twelve merges it was touched by four of them and
ran to three thousand lines, more than the reducer on both counts — and it is
the file that lost a task outright, one that could not run beside two others
because all three wanted it. The split is what lets three rules about three
different families be written at once.

### Limitations, stated rather than papered over

- **A casting time of 1 minute or more is built, in combat and out of it.**
  Outside combat the casting is declared, runs on the clock and settles; in
  combat the clock is derived from turns wrapping and SRD's per-turn Magic
  action is `continueCasting`, with a turn that ends without it failing the
  rite. See "A Casting Of A Minute Or More Runs On The Clock", which is also
  where a Ritual is cast.
- **Three Reaction triggers are enforced; the fourth needs machinery that does
  not exist.** SRD writes a Reaction's casting time as a clause — "Reaction,
  **which you take when you are hit by an attack roll**" — and the clause is a
  rule. `SpellDefinition.trigger` carries it, and a casting whose moment has
  not arrived is refused before a slot or a Reaction is spent.

  **Shield works, including the hard half.** "A +5 bonus to AC, including
  against the triggering attack" means the attack must still be undecided when
  the Reaction lands, and it is: `pendingAttack` — the window built so a Divine
  Smite could land between an attack's two rolls — holds the hit, the roll that
  made it, and the Armour Class it was measured against. So the hit is
  re-measured, and whether +5 is enough is arithmetic the engine owns rather
  than a judgement the model makes.

  Two details in that re-measuring, both from the book. The bonus is applied to
  **the number the attack actually met**, which already has that attacker's
  cover in it — recomputing an Armour Class from the creature would quietly
  drop the cover and let the barrier cancel the pillar. And a **natural 20 hits
  regardless**, so no bonus turns one aside.

  **Hellish Rebuke works, and what it needed was a fact rather than a
  mechanism.** Its trigger is "taking damage from a creature that you can
  see", and its target is "the creature that damaged you" — but every damage
  event carried only a `source`, which is *prose* for the audit trail
  (`'a trap'`, `'Longsword'`). Prose cannot be set on fire. So damage now names
  its dealer where one is known, `CreatureState.lastDamage` remembers the most
  recent, and a trap still names nobody — which is the honest answer, not a
  gap: there is nothing to rebuke.

  **The window is two facts already in state, not a number.** "In response to"
  means immediately, and the finest grain the engine has for that is the turn —
  the same grain the one-slot-per-turn rule uses. Outside combat there are no
  turns, so the clock closes it instead: a Reaction is legal while both the
  turn and `elapsed` still match the moment the damage landed. Inventing a
  window of so many seconds is exactly the kind of number this engine exists
  not to invent.

  **The target is forced, so aiming it elsewhere is refused** rather than
  quietly redirected — the rule `eligibleTargets` states for every spell, and
  the one place a Reaction could have smuggled in a substitution.

  **Counterspell works, and what it needed was for a casting to stop being
  atomic.** See "A Casting Can Be Interrupted" below. One Reaction trigger is
  left:

  | Spell | What it answers | What is missing |
  |---|---|---|
  | Feather Fall | a creature falling | falling, which is not modelled at all |

  A `ReactionTrigger` member arrives with the machinery that makes it
  checkable, never before.
- **Only conditions are linked effects.** Ownership is designed for conditions,
  bonuses, areas and summons alike — the source string is the link, and nothing
  about it is condition-specific — but conditions are the only effect type the
  engine currently applies, so they are the only one implemented.
- **Non-Concentration ongoing spells run, expire, and can be let go.** Give
  `castSpell` a `duration` and the casting ends on time, taking its effects
  with it, whether or not anyone was concentrating; `endOngoingSpell` is how a
  caster ends one early, by naming the casting rather than by holding it.
- **The two-call path has an ordering requirement; `resolveDamage` does not.**
  `concentrationSaveAfterDamage` must be asked of the state *after* the damage
  landed, or it reports a save for a spell the damage already ended. That is a
  thing to know, which is why the one-call operation exists and is what a tool
  surface should reach for.
- **The log records the casting that ended, not each effect that ended with
  it.** Cleanup is derived from the link, so a target's own history shows the
  condition arriving but not leaving. Making it explicit would mean building a
  list that a retry could find stale; the trade was taken deliberately.

## A Casting Can Be Interrupted

`resolveSpell` was atomic: it validated, spent the slot, and landed the
effects in one breath. SRD 2024 Counterspell interrupts "a creature **in the
process of casting a spell**", and there was no such process to interrupt.

**The SRD decides which costs are already paid, and it is not "all of them".**
One sentence settles the whole design:

> "On a failed save, the spell dissipates with no effect, and **the action,
> Bonus Action, or Reaction used to cast it is wasted**. If that spell was cast
> with a spell slot, **the slot isn't expended**."

So the economy is spent at declaration and never given back, and the slot is
**not spent at declaration at all**. That asymmetry is the reason this is a
two-event casting rather than a spend-and-compensate one: there is no refund,
because nothing was taken. Every event still records something that happened.

| | Declaration (`spell-declared`) | Settlement (`spell-cast`) |
|---|---|---|
| Action / Bonus Action / Reaction | **spent** — "wasted" whatever follows | — |
| Concentration the caster was holding | **broken** — "the moment you *start* casting" | — |
| The spell slot | — | **spent** |
| A feat's free daily casting | **spent** | — |
| The new Concentration | — | **started** |
| The casting's own deadline | resolved, so it cannot fail later | scheduled |
| The effects | — | **resolved** |

Two of those rows are readings rather than transcriptions, and are stated here
because nothing else records them. **A feat's free daily casting is spent and
not spared**: the SRD's relief names the spell slot and nothing else, and
extending it to a different resource would be inventing a rule. And **the
one-slot-per-turn rule reads expenditure**, so a countered casting does not use
up the turn's one slot — the marker rides on the settling `spell-cast`.

**It is opt-in, and that is the compatibility story.** `resolveSpell` with no
`hold` is byte-for-byte what it always was: one call, one `spell-cast`, no
pending state — which is why every log written before this exists still folds,
`golden-log.json` included. Turning every casting into a two-step ceremony to
serve a moment that is usually empty would be a worse API for no rules gain.

**The reducer branches on the id, not on "is anything pending".** A
Counterspell is itself cast *while* a casting is open, so its own `spell-cast`
has to allocate the next id in sequence rather than trying to settle somebody
else's casting. Looking the event's own `castingId` up in `pendingCastings` is
what keeps those two cases apart; asking "is a casting open" conflates them and
corrupts the log. That sentence was already right when there was one slot, and
it is the reason the keyed record needed nothing of that case but the lookup.

**The casting id is allocated at declaration**, because the entire point is
that other mechanics can name the casting while it is open — `cast:3` is what
`spell-interrupted` refers to, and what a log reader asking why Hold Person
never landed needs to see. So `spell-declared` advances `castingsBegun` and the
settling `spell-cast` must not advance it again.

**Settlement takes no fresh request.** Who the spell was aimed at, what level it
was cast at and which route supplied it were settled and written down at
declaration; `resolveDeclaredCast` reads them off the pending record. A
settlement that accepted a new request could declare Fireball at the goblins
and settle it at the party, and no rule in the engine would have noticed.

**So everything the caster stated has to be on that record, and two facts were
not.** `PendingCasting` pinned the targets, the origin and the area for exactly
the reason above, and carried neither the **damage type** nor the
**unaffected** list — so a held Spirit Guardians declared Necrotic settled
Radiant, and a creature the caster had explicitly spared was caught anyway.
Both are facts the engine refuses to guess at the *atomic* cast — see "Two
clauses the geometry must not quietly absorb" — and the held path dropped them
silently, which is this file's own warning arriving through the other door:
*picking Radiant because most clerics are good is where a Necrotic-immune
Undead finds the engine out.* The rule is one sentence and it has no exception:
**whether a casting is settled in one breath or held open for a Counterspell
changes nothing about what the caster said.**

Two details, and the second is the one that would have rotted. The stated type
reaches the **effects** as well as the record, because Protection from Energy
states its type for an effect that lands at the cast while Spirit Guardians
states it for an area trigger — so `statedDamageType` is applied at settlement
exactly as the atomic path applies it, and a mutation dropping only that
substitution reddens the Protection from Energy cases and nothing else. And the
sort and the empty-list elision are **one function, three readers** —
`statedFacts`, read by the atomic record, by the declaration, and by the
settlement. It is idempotent on purpose, which is what lets the settlement call
it on an already-normalised pending record rather than spelling the copy out a
second time: two normalisations of one sentence is the failure this file
records about every rule kept in two places, and here it would have meant two
declarations that mean the same thing folding to different bytes.

Both fields are optional, so a declaration written before this has neither and
means what it always meant — which is the whole compatibility story, and why a
pending record needed no upgrade path. `upgradeOngoing` fills an *ongoing*
record from the catalogue; `spell-declared` stores `event.casting` verbatim, so
absent keeps meaning absent with nothing to migrate.

**The deadline is pinned at declaration, not re-resolved at settlement.**
`resolveDuration` can refuse — a turn-anchored duration outside combat — and a
refusal *at settlement* would be a window that could never be closed, which is
a wedged fight. Refusing before the window opens costs nothing, which is the
same validate-before-rolling rule the rest of casting obeys.

**A pending casting is engine debt, and it is guarded the way the others are.**
The turn refuses to advance past it; a second casting is refused while it
stands, except the Reaction that answers it; and a caster who leaves the game
takes it with them, exactly as `settleHoldsInvolving` already does for a held
attack and a declared move. A debt whose only settling command is addressed to
a creature who has left is a campaign that never continues.

**A guard placed before the duplicate check is a lie told to a retry.** The
`casting_pending` refusal was written above the command-id check first, and a
retried declaration then reported that somebody was mid-cast — which was true,
and was the retry's own first run. This is the third time that trap has been
sprung in this file (`triggerRefusal` and the six unstamped commands were the
others), and it is always the same shape: *a retry looks at the world its first
run made*. The duplicate check comes first, always.

**A clause that excludes nothing is documented, not modelled — and this now
has two users.** Nondetection hides its target from Divination spells, and
every Divination spell the engine defines is cast at Self or at no creature at
all, so the clause has no reachable case. Same shape as Counterspell's:

**Counterspell's components clause is not checked, and the reason is in a
test.** SRD triggers it on "casting a spell with Verbal, Somatic, or Material
components" — and all 339 SRD 5.2.1 spells have at least one of the three, so
the qualifier excludes nothing the engine can be asked about. A field whose
only reachable value is "yes" is not a rule, so the gap is reported in
`unverified` and `counterspell.test.ts` pins the count that makes it safe.

**One thing this deliberately is not, and one that it turned out to be.** It
is not a general interruption framework — there is **no stack**, and a
Counterspell answering a Counterspell is refused rather than nested. That
sentence used to read "one pending casting, no stack", and the first half is
gone: several castings may be open at once — see "Several Castings May Be Open,
And A Casting Id Is What Names One". And this
file used to say it was "not the long-casting-time machinery" either, on the
grounds that a casting of a minute or more needs a per-turn obligation rather
than a window. Half of that was right and the conclusion was wrong: the
obligation is what is still missing **in combat**, and outside combat the
process this built is exactly what a long casting is. See the section below.

**And those refusals are values, which they were not.** The exemption above
lets a Reaction *answer* an open casting; nothing said it could not open a
second one, so a Counterspell asking to be **held** while a casting was already
open sailed past the guard and produced a `spell-declared` the reducer rejected
as a corrupt log. The rule was right and the instrument was wrong: an exception
is reserved for programmer error, and "you may answer this casting but you may
not hold an answer open" is something a DM narrates around. `castOrRelease`
returns it, nothing is spent, and the reducer's throw stays where it belongs —
as the backstop for a log that claims it happened anyway.

**They are two rules under two codes now, and neither is an SRD rule.**
`answer_cannot_be_held` is *an answer is not a window*; `answer_to_an_answer`
is *an answer may not answer an answer*. Both are about the **answering
relationship** rather than about how many records exist, which is what they had
to become once the record stopped being unique — their old reason said "one
casting is open at a time", and that is no longer true. And both are **engine
limits standing in for a settle-order rule the engine does not have**: SRD
Counterspell triggers on a creature "casting a spell with Verbal, Somatic, or
Material components", and a creature casting Counterspell is doing exactly
that, so the book permits the nesting and the engine has no order in which two
nested answers would settle. Each refusal reason says so in as many words,
because a limit that reads like a rule is the thing this file keeps finding.

### Several Castings May Be Open, And A Casting Id Is What Names One

`GameState.pendingCastings` is a record keyed by casting id. It was one slot,
engine-wide, and the guard protecting it refused **every other creature's**
casting and activation for the whole of a ten-minute rite — which SRD does not
say, and which IE-034 recorded as a structural accident of a one-instant user
surfacing as a rules refusal.

**The sharper case needs no second creature at all**, and it is the invariant
this is built around. Read sentence by sentence rather than recalled:

| SRD | |
|---|---|
| *Longer Casting Times* | "you must take the Magic action on **each of your turns**" — the obligation is on the caster's own turns, and "you don't expend a spell slot" until it completes |
| *Concentration* | Concentration breaks on starting a spell "**that requires Concentration**" — Shield and Counterspell require none |
| *Reaction* | "You can take a Reaction on **another creature's turn**" |
| *One slot a turn* | "On a turn, you can expend only one spell slot" — it reads **expenditure**, and a pending casting has expended none |

So a wizard mid-rite, attacked, may legally cast Shield: **two pending
castings, one caster**, no nesting and no mechanic the engine lacks. The engine
refused it purely because a record existed.

**Casting identity, not caster identity, is what keys the record**, and there
is deliberately no per-caster rule either. Every pending casting retains its
caster, and settlement, interruption, cancellation and retry all address a
**specific casting id** — `resolveDeclaredCast` takes one and refuses
`no_casting_pending` naming it, its idempotency kind carries it, and a command
id reused for a *different* casting is refused as a recycled id.

**Deleting the uniqueness deleted no rule, and each one is enforced by its own
primitive** — which is the whole argument, and each row is asserted:

| The real rule | Its primitive |
|---|---|
| One Action, Bonus Action or Reaction a turn | `spendAction` / `spendBonusAction` / `spendReaction`. A caster mid-rite has spent that turn's Magic action at the declaration, so a second Action casting is refused **there**, under `no_action` |
| "On a turn, you can expend only one spell slot" | `spellSlotSpentOnTurn`, whose marker rides on the settling `spell-cast` |
| One Concentration | `releaseCasting`, the single door: a second Concentration casting breaks the first at its declaration |
| The rite's per-turn Magic action | `continueCasting`, and the derived failure at the caster's own turn boundary — built, and reading the record this keyed |
| An answer may not open its own window | the two relationship rules above |

**The reducer's invariant is purely id-based.** `spell-declared` throws only if
that casting **id** is already pending, and the sequence check beside it is
what makes a duplicate id impossible in practice — so the throw is the
corrupt-log backstop for *identity*, which is what a reducer is for. Caster
uniqueness is not an identity fact and the reducer says nothing about it.

**The record is kept in casting-number order**, the order `castingsEnded`
already uses and for the same reason: it serialises, so a key order that
followed the accidents of declaration would make the fold something other than
a pure function of the log's content. Ids run in sequence, so today the sort is
a no-op — which is exactly when it is cheap to make structural.

**An ambiguous reference resolves to a casting id or is refused; the engine
never picks.** `answeredCasting` is the one function that decides which casting
a Reaction answers, read twice — by `triggerRefusal` before anything is spent,
and by the `interrupt-casting` resolver on the state its own events have been
folded into, so the two agree by construction rather than by the window being
unique. Three answers, differing in what the caller does next:

| Code | Says | The caller |
|---|---|---|
| `no_trigger` | nothing is being cast, or that casting is over | waits |
| `forced_target` | the named creature is casting nothing, or is not the one casting *this* | re-sends, naming the right creature |
| `ambiguous_casting` | they have several open and the command named none | re-sends, naming a casting id |

`CastSpellRequest.answers` is that id, **optional** because a caster with
exactly one casting open leaves nothing to choose between — and refused
outright (`no_answer_clause`) for a spell that prints no such trigger, which is
the shape `damageType`, `fought` and `teleportTo` already take.
`reactionOpportunities` reports the id to send, on every open casting, to every
creature but that casting's own caster: two offers that differed only in a
casting nobody could see would be an ambiguity refusal naming candidates the
caller was never shown.

**`resolveTurn` keeps a global refusal**, now reading the record and naming the
castings — and reading it **per casting**, which is what the keyed record made
possible: an instant window still blocks the turn, and a casting of a minute or
more does not, because SRD measures that one *in* turns. So a rite standing
beside an unsettled window blocks on the window alone.

**And `settleHoldsInvolving` is genuinely plural now.** It read the single slot
and stopped at the first; a caster may hold a rite and a Shield open at once,
and a debt left standing when its only settler walks out is a fight that can
never advance. The mutation that proves it is taking the first of the list.

**Neither frozen log needed a fixture edit.** `spell-declared` has always
carried the whole record as `event.casting`, so both fold into the keyed record
unchanged — which is the compatibility story in one sentence.

## A Casting Of A Minute Or More Runs On The Clock

**The largest blocker in the book was a casting time**, and none of the three
rankings this repository kept before `missing-shapes.ts` derived them had it at
all: fifty-four spells are touched by it and twelve are blocked on nothing
else — three times any other shape, by a wide margin. `resolveCast` refused
every one of them.

SRD, "Longer Casting Times", whole:

> "Certain spells—including a spell cast as a Ritual—require more time to cast:
> minutes or even hours. While you cast a spell with a casting time of 1 minute
> or more, you must take the Magic action on each of your turns, and you must
> maintain Concentration while you do so. If your Concentration is broken, the
> spell fails, but you don't expend a spell slot. To cast the spell again, you
> must start over."

**The state machine that paragraph asks for was already here, and had been
since Counterspell.** A declared casting is a process with an identity, whose
action is already spent, whose slot is not, and which other mechanics can name
while it is open — and "the slot isn't expended" is the *same sentence* the
Counterspell rule prints, arriving from the other direction. So this is one
field on the pending record, one Concentration that names a casting nothing is
running under yet, and a refusal at the settlement until the clock catches up.
No second mechanism, no second window, no new event type.

| | Declaration (`spell-declared`) | Settlement (`spell-cast`) |
|---|---|---|
| The action | **spent**, where there is a turn to spend it on | — |
| Concentration the caster held | **broken**, "the moment you *start* casting" | — |
| Concentration **on the casting itself** | **started** | ended, or carried on — see below |
| The spell slot | — | **spent** |
| `completesAt` | pinned | the moment settlement waits for |
| The spell's own Duration | — | **starts here** |
| The effects | — | resolved |

### The Concentration is on the casting, and the readers were asked

`creature.concentration` names the **pending** casting id from the declaration,
which is the one question this needed answering before it could be built: does
any reader assume that id is in `state.ongoing`?

Asked of every one of them, the answer is no, and the reason is structural
rather than lucky: **`ongoing` is what a casting left behind, and a casting
that has not taken effect has left nothing behind.** `ongoingSpellsBy`,
`ongoingSpellsOn` and every Dispel reader walk `state.ongoing` and never touch
`concentration` at all, so they simply do not see a rite in progress — which is
correct, because there is nothing there to dispel. `holdsNothingOf` asks what a
casting owns *on a creature* and is reached only from a condition instance's
own source, which a casting with no effects has never written. And the readers
that do read `concentration` all want exactly what is true: the damage save
(`concentrationSaveAfterDamage`) fires, `endConcentration` dismisses it, and
the derived Incapacitated pass ends it.

**`releaseCasting` is still the single door, and it grew one line.** Every
route by which Concentration ends — damage, a dismissal, the derived pass, a
second Concentration spell, the caster leaving — already converged there, so
the pending record is dropped there and nowhere else. That is the whole of SRD's
"the spell fails, but you don't expend a spell slot": nothing is refunded,
because the slot was never taken, which is the same asymmetry
`spell-interrupted` has always written.

**And one exit was not going through it, which is what makes "single door" a
claim worth checking rather than a habit.** `spell-interrupted` cleared the
pending record itself — complete, and complete only while no pending casting
could be concentrated on. With one that can, a Counterspelled rite left its
caster concentrating on a casting that no longer existed: permanently, because
nothing would ever end it, and expensively, because every later hit then rolled
a Constitution save and threw a die for a spell that was not there. SRD is
plain — "the spell dissipates with no effect" — so the case routes through the
door like the other four, and for an ordinary casting it finds no
Concentration and does exactly what that line always did.

**A batch is built against the world its own earlier events leave.**
`removeCreatureEverywhere` wrote `spell-interrupted` and then read the caster's
Concentration off the state *before* it, which was two events about one fact
and became a `concentration-ended` the fold refused outright. Both are read
forward now. It is the snapshot failure this file already records for a command
that lists what it is about to remove, arriving inside one batch instead of
across two commands — and it is only reachable because the interruption now
takes the Concentration, which is the shape of a correct fix exposing the next
thing along.

**A long casting always drops a prior Concentration, whatever the spell is.**
The rule reads "you must maintain Concentration while you do so", so the rite
*requires* Concentration even when the spell it will cast does not — and "you
lose Concentration on an effect the moment you start casting a spell that
requires Concentration" then applies at the declaration.

**Settlement inverts the two branches**, and the fact it reads is
`completesAt` rather than `castingTime`, because a Ritual of an Action-casting-
time spell is a long casting whose printed casting time is not `long`:

| The spell | At settlement |
|---|---|
| takes Concentration | nothing at all — one Concentration, carried on under the same id |
| takes none | `concentration-ended`, reason `completed` |

`completed` is `released`'s shape: a Concentration that existed only to hold
something, ended by that something finally happening rather than by anybody
giving up. It is written **before** the deadline in the same batch, and that
ordering is load-bearing — `concentration-ended` folds through
`releaseCasting`, which takes every timer the casting owns, so a schedule
written first would be wiped by the event saying the rite is over.

**And only a fold can say so, which is why reading the emitted event was not
enough.** Swapping the two pushes leaves every assertion about the *batch*
green: the `effect-scheduled` is still there, with the right deadline on it. It
is gone from `state.timers` a moment later, and the spell then runs for ever —
invisible, because nothing will ever expire it, and findable only by Dispel
Magic. So the fixture folds the settlement, reads the timer out of the state,
and then drives the casting past its own hour and asserts the record is gone.

**`completesAt` and `castingTime === 'long'` agree and cannot disagree, and a
mutation swapping them survives the whole suite.** A Ritual's *printed* casting
time is "Action or Ritual" and the casting it makes is recorded as `long`,
because the Ritual version really does take ten minutes — so every casting the
engine can produce sets both or neither. The field read is the one the branch
is *about*: whether a Concentration was already started for this casting. That
is what `completesAt` says; `castingTime` is what happens to travel with it,
and it is the field a fourth casting-time bucket would come apart on. Stated
rather than dressed up as a fixture, which is the move this file already makes
for the cross-slot rider order.

### The spell's Duration starts when the spell does

`PendingCasting.deadline` is pinned at the declaration so that settlement
cannot fail. For a casting that takes ten minutes that is the wrong moment
altogether: a Detect Magic ritual pinned at its declaration would expire the
instant it finished being cast, its whole ten minutes spent on the rite.

So a clock-deferred casting carries `lastsSeconds` — the **span**, resolved at
settlement against the clock as it then is. It is a number of seconds rather
than a `Duration` because a turn-anchored duration is refused at the
declaration (there are no turns outside combat, and a long casting is refused
inside one), so a span is the only kind that can reach the settlement — which
is what keeps "settlement cannot fail" true rather than merely likely.

**Carrying a number rather than a `Duration` is exactly where the validation
gets lost, and it was.** `resolveDuration` is the single conversion between the
two types and the only thing that refuses a span running backwards, in
fractions of a second, or not a number at all — so a branch that stored the
seconds *instead* of resolving them was the one place in the engine where a
duration went unchecked. What that cost is not abstract: a `NaN` span settles
to a deadline of `null`, which never expires live and expires **immediately**
on reload, because `null` folds back as `0`. One log, two meanings. So the
duration is resolved either way and the span is read back **off the answer** —
`at - elapsed` — which is the same number for every duration that was legal and
no number at all for one that was not.

And the settlement converts through `resolveDuration` too rather than spelling
`elapsed + seconds` out a second time. It cannot refuse, because the span came
off an `elapsed` deadline at the declaration and is a whole number of seconds
forwards by construction; `mustResolve` says that rather than making every
caller ask. Two spellings of one arithmetic is the second answer to one
question this file keeps naming, and here it would have sat four lines under a
comment warning about it.

### `completesAt` is read with `isDue`, and that is a choice

`hasExpired` and `isDue` read a `Deadline` in opposite directions for a
turn-anchored one whose anchor has gone: the first answers **yes**, so nothing
runs for ever, and the second answers **no**, so a moment that will never
arrive collects nothing. A casting completes when its moment genuinely comes,
so `isDue` is the reading — `hasExpired` would complete a casting because the
fight ended, which is a completion the engine invented.

Every value here is an `elapsed` deadline today, because a casting time is a
span of seconds and never a moment in the turn order. **The two therefore
agree, which is exactly why the choice has to be stated rather than left to
luck** — the same argument this file already makes about Acid Arrow's second
hit, arriving on the other function.

### A Ritual is a long casting, and the value already had a writer

The audit that proposed this task said it would be `SlotlessReason.ritual`'s
first writer. It was **not**: `castSpell` has accepted `slotless: 'ritual'`
from its caller since slots landed, and `casting.test.ts` has cast Detect Magic
as a ritual and asserted the event carries it for just as long. What was true
is that the value **meant almost nothing** — nothing checked that the spell
carried the Ritual tag, and nothing added the ten minutes. This makes it mean
what the book says.

SRD: "The Ritual version of a spell takes 10 minutes longer to cast than
normal. It also doesn't expend a spell slot, **which means the ritual version
of a spell can't be cast at a higher level.**" One sentence, three
consequences, and all three are in one function (`castingOf`) rather than three
places:

- **It is always a long casting.** Ten minutes more than an Action is ten
  minutes, which is a minute or more by any reading — so `CastSpellRequest.ritual`
  makes Detect Magic a declared casting settled off the clock even though its
  printed casting time is `Action or Ritual`.
- **It expends nothing** — not a slot, and not a feat's free daily casting
  either, so `choosePayment` is not asked and a casting that names a payment is
  refused rather than having the field quietly ignored.
- **It cannot be upcast**, which is the book's own gloss on the slot, so the
  refusal names the level — and the *rule* is the sentence in front of it, so
  **every** way a caller can say how the casting is paid for is refused, not
  only the one the gloss names. A `slotLevel` at the spell's own level was
  silently dropped and a `slotless` reason silently overwrote the `ritual` the
  casting had just decided, which is the field-quietly-ignored failure this
  very refusal was written against, arriving inside it.

**"Ten minutes longer" is a sum, and no catalogue spell can tell you so.** All
ten definitions carrying the Ritual tag print "Action or Ritual", so none has a
casting time of its own to be longer *than* — and a mutation replacing the sum
with the constant survives the entire suite, because for all ten the two are
600. SRD Alarm prints "1 minute or Ritual" and comes to **660**. `castingOf` is
pure over a definition, so that definition is simply built and handed to it:
the move `restoreOn`'s dawn-recovering pool already makes for a branch no class
can reach, and the rule it protects is the same one — *a guard nothing can
reach is not a rule, and a pure function will take a fixture that reaches it.*

A spell that prints no Ritual tag is refused rather than quietly cast normally
— the shape `damageType` and `fought` already take for a clause a spell does
not print. The tag is **transcribed onto the definition and oracled**, rather
than read out of `SPELL_INDEX` at cast time: a definition is the engine's
authoritative answer about a spell and the book is what checks it, which is the
rule every other printed field already follows.

**Preparation stays unjudged.** SRD requires a Ritual to be prepared, or to
come from a feature that allows casting one unprepared, and spell lists and
preparation are not modelled. Refusing on a rule the engine cannot evaluate is
worse than leaving it to the layer that knows — which is what casting has said
about knowing and preparing a spell since the day it was written, and a Ritual
is not the place to start making an exception.

### The casting time is two printed facts, and only one was ever checked

`srdCastingTime` has answered *which bucket* since tracked spells landed. **How
long** a long casting takes was nobody's, because nothing could be cast that
way — and it is the same unwatched-number class as the Range and the Duration
the oracle already covers. `srdCastingSeconds` parses it, the grammar is
asserted to cover the **whole book** rather than the corner the catalogue uses,
and every definition is held against it in both directions. `castingSeconds` is
**required** on a `long` definition and refused on any other, because `long` is
the SRD's bucket — "minutes or even hours" — and not a span.

**The bucket's floor is one number in one place**, `LONG_CASTING_SECONDS`, read
by the definition validator and by `castSpellWith` alike. They were written
separately and disagreed — sixty against nothing-but-positive — so the
low-level half accepted a six-second `long` casting that no definition could
ever declare. Being the half that takes its caller's word about the *economy*
is not the same as taking a caller's word about arithmetic, and two spellings
of one number is the second answer to one question this file keeps naming.

The Ritual tag is oracled beside it, because the SRD prints it *inside* the
casting time: "Action or Ritual", "1 minute or Ritual". The suffix is the other
casting time the same line offers, so the parser strips it and the ten minutes
a Ritual adds stay the rule's rather than the spell's.

### In combat the obligation is the turn, and it is one field

**In combat the obligation is a state machine on the caster's own turns, and it
is built.** The refusal that stood here named exactly what was missing — SRD's
Magic action on each of those turns — and what it turned out to need was one
field, one command and one derived pass. No second mechanism: the clock a fight
derives from its own rounds is the same clock the settlement already waited on,
and `isDue` reads `completesAt` in combat exactly as it does outside one.

| | |
|---|---|
| `PendingCasting.sustainedOnTurn` | which turn last saw the caster at it — one number, because the boundary asks one question |
| `continueCasting` | the Magic action, on the caster's own turn, guarded by `mayAct` and spent through `spendAction` like every other spender |
| `failUnsustainedCastings` | the turn that ended without it, failing the rite through `releaseCasting` |

**The failure is derived, so it writes no event.** Nobody decides that a turn
ended without the Magic action being taken, exactly as nobody decides that a
Concentration broke — so it is the reducer's, and no log however assembled can
show a rite running past a turn its caster let slip. It leaves by the single
door every other ending already uses, which is also where SRD's "the spell
fails, but you don't expend a spell slot" is kept: nothing is refunded, because
the slot was never taken.

**Taking the action is a decision, so it *is* an event.** `casting-continued`
is the whole of it and it carries no turn number — the turn is
`state.combat.turnsTaken` at the moment it folds, and a number written beside
it would be the second answer to one question this file keeps naming. The
`action-spent` beside it is what the economy reads; this is what the rite reads.

**The turn a rite is declared on needs no second Magic action**, because the
declaration *was* it: `spell-declared` stamps the record itself, and a caller
who asks again is refused `no_action` by the economy — which is the honest
refusal, since it is the economy that says so.

**Absent means no turn has**, which is what a rite declared outside combat
carries into a fight that starts around it, so the caster's first turn of that
fight is the first one it is owed on. And the marker is **dropped when the
fight ends**, because turn numbers restart with the next one: left standing it
would credit turn 3 of the next fight with the Magic action taken on turn 3 of
the last, which is a rite surviving in silence. The rite itself is untouched —
a fight ending is not a Concentration broken.

**The ordering against the boundary's other business is decided rather than
left to luck.** The failure runs **before** the end-of-turn area debts are
raised, so those debts are raised against the world the failure leaves. It is
unobservable today — a casting that has taken no effect owns no area, no timer
and no condition, so it can owe nothing and be owed nothing — and the fixture
that says so is deliberate rather than hoped for: a rite fails at a boundary
that is *also* collecting a Grease's saving throw, and the save owed belongs to
a different casting because it could not belong to this one. Same argument this
section already makes about `isDue` against `hasExpired`.

**The wedge is gone, and `resolveTurn` is what closed it.** A rite pending
across a turn is now skipped by the `casting_pending` guard, because in combat
the clock it settles on is derived from turns wrapping — refusing to advance
past one was refusing the only thing that could ever settle it. An **instant**
window still blocks the turn, and with IE-038's keyed record that is per casting
rather than per record count, so a rite standing beside an unsettled window
blocks on the window alone.

**One hole opened with the refusal and was closed with it.** While a long
casting was refused in combat, a turn-anchored Duration could never reach the
declaration's deadline branch, because `resolveDuration` refuses one outside a
fight. In combat it resolves perfectly well — and pinning it at the declaration
would end the spell a minute before it began, which is exactly the bug
`lastsSeconds` exists to prevent. `duration_not_a_span` refuses it before the
slot, the action and the first die, so a span is still the only kind that can
reach the settlement and settlement still cannot fail.

**A casting in process was one engine-wide, and that limit is gone.**
`castOrRelease` refused `casting_pending` while any casting was open and named
no caster, so during a rite **every other creature's** casting and activation
was refused too — for the whole ten minutes. SRD lets the cleric cast Cure
Wounds while the wizard performs a Ritual, and that refusal corresponded to no
rule at all. The record is keyed by casting id now: see "Several Castings May
Be Open, And A Casting Id Is What Names One". The four tests that pinned the
limit are inverted rather than deleted, so the record of what changed is a
test's own prose.

**A casting declared before a fight and still open when one starts used to
wedge the fight**, and what `startCombat` does to an open casting turned out to
be *nothing at all*. There is no special case: the rite simply enters the
obligation, the caster keeps at it on each of their own turns, and the fight's
own rounds carry the clock to the moment the settlement waits on. Before this
it was `resolveTurn` refusing `casting_pending` and the settlement refusing
`still_casting` until a clock that only turns could advance, with three ways
out — the caster gives up the Concentration, the caster leaves the game, or the
DM declares time passed with `advanceTime`. A test drives a rite through twenty
turns of a two-creature fight to sixty seconds and settles it there, which is
the test that would have caught the wedge.

**The twelve definitions this unblocked are written**, so `castingSeconds` has
writers and the handover it carried is discharged — see "Twelve Spells Whose
Only Blocker Was The Clock" below.

### Twelve Spells Whose Only Blocker Was The Clock

`consumersOf('a-long-casting-time').unblocks` named exactly twelve spells, and
IE-036 read each of their SRD paragraphs and wrote all twelve. Alarm,
Clairvoyance, Commune with Nature, Fabricate, Find the Path, Hallucinatory
Terrain, Identify, Illusory Script, Instant Summons, Legend Lore, Magic Mouth
and Mending — a ward that warns you, a sensor a mile off, three facts about the
countryside, an object fabricated or repaired, a page only your friends can
read, a mouth that speaks when somebody walks past.

**Every one of them is tracked, and that is what reading the paragraphs
decided rather than what the batch set out to do.** Not one changes a number, a
resource or a condition: what the engine owns is the cost, and it now spends
all of it — the action, the slot, the Concentration on the rite, the deadline,
the range and the target rule. The **one** clause among the twelve that is
arithmetic is Hallucinatory Terrain's "make an Intelligence (Investigation)
check against your spell save DC to disbelieve it", which is the sentence
Disguise Self, Minor Illusion and Silent Image already write, and it is
executed.

**The handover fell rather than being rewritten**, which is what a handover is
for. `SpellDefinition.castingSeconds`' exemption in the format's own
unused-member sweep ended "the day any definition prints a casting time of a
minute or more, this fails rather than going on excusing a field that has a
writer", and twelve of them do; the sweep's own "keeps no exemption for a
member something now writes" arm is what removed it. Second time an exemption
has been discharged by deletion — `dash`'s was the first.

**The catalogue is now a witness for a sum that no fixture could reach.**
`castingOf` adds a Ritual's ten minutes to the spell's *own* casting time, and
every one of the ten previously tagged definitions prints "Action or Ritual" —
no casting time of its own — so "0 + 600" and "600" were the same number for
all ten and a mutation replacing the sum with the constant survived the entire
suite. **Six of the twelve print "1 minute or Ritual" and come to 660** —
Alarm, Commune with Nature, Identify, Illusory Script, Instant Summons and
Magic Mouth. That fixture was a hand-built Alarm; it reads
`definitionFor('alarm')` now and a sweep beside it loops over *every* tagged
definition with a casting time of its own, and the same mutation reddens three
tests in two files.

**Alarm is the fixture and was briefly written down as the only case**, in
four places at once, which is worth recording because it is this file's own
most-repeated failure arriving inside the commit that fixed it: a claim of
uniqueness written while five more of the same thing were being added in the
same diff. An independent review measured it. The sweep that loops over every
tagged definition is what makes the prose no longer load-bearing.

**A `long` casting time changes what a sweep over the catalogue has to do**,
and both sweeps were asserting on half a casting the moment these landed. A
casting of a minute or more is a *declared* one, so `resolveSpell` returns a
`spell-declared` and stops; `spell-tracking.test.ts`'s "casts %s" and
`spell-catalogue.test.ts`'s "spends exactly one casting" both expect a
`spell-cast` and would have found none. Both drive the clock to the
definition's own `castingSeconds` and settle by casting id — the honest
generalisation, because what they claim is *one casting*, not *one batch*. The
catalogue sweep asserts the two-event route is taken for exactly the `long`
definitions, so the branch is exercised rather than merely present.

**Three readings the paragraphs settled, each of which could have gone the
other way:**

- **Alarm carries no area and no designation, and the two go together.** SRD
  wards "a door, a window, or an area within range that is **no larger than** a
  20-foot Cube" — two objects and a ceiling the caster chooses under, where
  `SpellArea.size` is one fixed number. And `designatesUnaffected` filters
  which creatures an area's *effects* reach: this area has none, because what
  the ward does when it catches somebody is **tell the caster**, which changes
  no authoritative state at all — no roll, no resource, no condition. So the
  alarm is the table's for the same reason Detect Magic's "you sense the
  presence of any magical effects" is, and the exemption from a warning is the
  table's along with the warning. The validator refuses `designatesUnaffected`
  without an area, which is the guard saying the same thing. Hallucinatory
  Terrain's 150-foot Cube is left off for the first half of that reason, and
  the book says so outright: "creatures within the area aren't changed."
- **Identify may name the creature it touched, or name nobody.** "You touch an
  object throughout the spell's casting ... **If you instead touch a creature**
  throughout the casting, you learn which ongoing spells are affecting it" —
  two things may be touched and one of them is a creature, which is exactly
  `TargetRule.optional`. Naming one buys the Touch range check against a real
  creature; `count: 0` would have refused a target the book plainly allows.
- **What a caster *learns* is never an effect.** "You learn which ongoing
  spells, if any, are currently affecting it" is a fact the engine holds and
  already answers — `ongoingSpellsOn` is the query — and no effect kind reports
  knowledge, because knowing something changes no authoritative state. The
  spell tells the table which question to ask.

**Two clauses among the twelve are debt rather than fiction, and the tracked
guard cannot see either.** Instant Summons' "you can take a Magic action to
speak the object's name and crush the sapphire ... and the spell ends" and
Magic Mouth's "you can have the spell end after it delivers its message" are
both `a-casting-dismissed-early` — an ongoing casting nobody is concentrating
on has no door out, because `endConcentration` is about Concentration. No
`MECHANICAL_MARKER` fires on "the spell ends", so neither could be filed in
`TRACKED_ADJUDICATED`, whose entries must name a marker their own sentence
trips. Each says so in its `unmodelled` clause and names the shape. That is the
floor being a floor, recorded rather than fixed by widening the marker set.

**And the shape survived with an `unblocks` of zero**, which is a state the map
had not held before: forty-two spells still name `a-long-casting-time` and
every one of them names something else too, so building the in-combat per-turn
obligation now finishes nothing on its own. `blocks` is the number a reader
wants and `unblocks` is the number a tranche is planned from, and this is the
clearest case in the map of the two saying different things. The forty-two are
not re-filed: each waits on a shape the map already names, and re-reading one
belongs with whichever task is briefed from *that* shape.

### One code said five things, and two of them were different questions

IE-029 measured that `no_trigger` carried five distinct rules across three
modules and left the casting-path half to the task that owns the file. Two of
the five are not about a trigger at all, and the difference is **what a caller
does next**:

| Code | Says | The caller |
|---|---|---|
| `no_trigger` | the moment has not arrived — no attack held, nothing has damaged you, the window has closed, nobody is casting | waits |
| `no_trigger_stated` | SRD Ready's "you decide what perceivable circumstance will trigger your Reaction", and the command named none | re-sends |
| `forced_target` | the window **is** open and the casting named the wrong creature | re-sends, naming the forced one |

The third is the one that was costing something. SRD forces the target of both
Reaction spells that take one — Hellish Rebuke's "the creature that damaged
you", Counterspell's "a creature in the process of casting a spell" — and a
tool surface told `no_trigger` would give up on a Reaction it could in fact
take. Four voices remain under `no_trigger` and they are one rule, each driven
by name. **Two codes changed**, which is observable behaviour and recorded as a
deliberate change rather than a cleanup.

`nothing_to_interrupt` stays exempt, and its written reason was **re-verified**
against the second way a casting can now be open rather than left to stand: a
Counterspell takes no Concentration and is not itself a long casting, so its
own batch writes no `concentration-ended` and leaves the rite's caster
concentrating — which is what keeps the pending record where the trigger check
found it. A Counterspell is driven at a Ritual and watched to resolve, which is
the re-read reaching the casting.

## A Casting Is History; What It Left Behind Is State

The engine has given every casting an identity since the first spell landed,
and used it to link the conditions and bonuses that casting created. What it
never had was the other half — **which castings are still running, on whom, and
at what level** — and three SRD sentences are unwritable without it:

| Sentence | What it needs live |
|---|---|
| Dispel Magic: "any ongoing spell of level 3 or lower **on the target**" | which spells are on a creature, and their level |
| Vampiric Touch: "you can make the attack again on each of your turns" | the casting, its caster, and the level it was cast at |
| Mage Hand: "the hand vanishes ... **if you cast this spell again**" | the caster's own prior casting of that spell |

`OngoingSpell` in `spells.ts` is that half, held in `state.ongoing` by casting
id. **The log keeps the casting for ever** — which slot went, which action, at
what moment — and this keeps only what a later rule has to ask. Ending the
second never touches the first, which is what the distinction is for: a test
asserts the record is gone and the `spell-cast` event is still there.

**The level is why it exists.** Before it, a spell's level lived in the log and
on a *concentrating* caster, so a spell whose caster was not concentrating had
no live level anywhere and Dispel Magic had nothing to read.

### Everything a later rule reads is pinned; nothing else is kept

A casting already made does not change when its caster does — that is what
`CastingNumbers` has meant since a spell could first catch somebody a minute
later. **It did not cover the area**, and that was the hole the third
whole-engine audit measured: the *shape* of a persistent area and the clauses
that fire in it are catalogue data, and the fold asked `definitionFor` for them
at five call sites on every read. So a replay of last week's log consulted this
week's catalogue, and correcting a transcribed Cube size would raise different
debts in a historical fold than the live session raised — which is "every
future rules fix silently rewrote history" arriving through *data* rather than
through rules, in the one place this file says it must not.

`area` and `areaTrigger` are now pinned on the record at the cast, and
`fold/areas.ts` — the one seam that needs them — imports the catalogue **for
types only**. The rule is unchanged and
now applies to both halves: *pinned for the casting, read live for the creature
it is happening to.*

**Both halves of the clause are read off the record now, and the second half
took a task of its own.** Four fields decide *who* is caught and when — `at`,
`onEntry`, `onAreaEntry`, `oncePerTurn` — and the reducer has read those off
the record since they were pinned. The other two decide *what it costs them*:
`effects` and `label`, which `settleAreaEffects` went on resolving through
`definitionFor`, so a correction to Web's saving throw reached a debt raised
before it — the same hazard from the other end, history rewritten by data.

The compatibility question that was left open turned out to be already
answered. `upgradeOngoing` fills the clause **whole** for a pre-versioned
record as it enters the fold, and `areaDefinitionOf` raises a debt only where
the record carries both an area and a clause — so nothing can be owed that the
record cannot settle, and the settlement reads exactly the fact the detector
used. The clause is stored whole because `AreaTrigger` is one value the SRD
writes as one sentence; it is read whole for the same reason.

**Two fields came off in the same pass, and they had no readers at all.**
`concentration` restated a fact the creature holds — whoever is concentrating
names the casting — and `route` is a *name*, which has to be resolved against a
sheet before it is a number and therefore answers nothing a minute later;
`numbers` is what a later use actually reads. Two answers to one question is
the failure this record was designed to avoid.

**"Absent means what it always meant" is the whole compatibility story.** Both
frozen logs were written in the older shape, and there is no second place those
areas could have been recorded — so a record with no `version` is filled from
the catalogue **once**, as it enters the fold, by `upgradeOngoing`. That
function is the only thing left on the fold's path that opens the catalogue,
its docstring says so, and it is in a module of its own precisely so the
lookup cannot read as ordinary again: five of them sat in `events.ts` with no
reader who knew they were there. A version rather than "is `area` absent",
because absence is ambiguous — most spells have no area, and reading every one
of them as legacy would leave the fold consulting the book for ever.

**A record for a casting that has *ended* is a corrupt log.** The reducer
already refused one for a casting nobody cast and one for a casting already
running; the third case put a finished spell straight back into `ongoing`,
visible again to Dispel Magic, to the turn boundary and to every area detector.
`castingsEnded` is the memory that catches it — written **only** where a record
was actually removed, because `releaseCasting` also runs for castings that
never had one and marking those would refuse the record the same batch is about
to write. It is the single deliberate mention a finished casting leaves in
state, and the cleanup tests say so rather than asserting no mention at all.

### No second identity, and the evidence for that

One casting can affect several creatures — Hold Person at level 3 holds two —
and each is released independently. But each is addressed as *(casting,
creature)*, which the engine has done since the repeat save. The only SRD
spells that make several independently addressable *things* from one casting
are the ones that give those things **positions** — and a position turned out
not to need an identity either: see "A Casting Can Hold A Point", where the
force is a field on the casting and is addressed as the casting. The one spell
that genuinely makes *several* placed things is Dancing Lights, which is
blocked on light being modelled at all, so a second level of identity would
still be a structure invented ahead of any mechanic that needed it.

### Range decides what a spell is *on*; the target list does not

Vampiric Touch is **Range: Self** and punches somebody else every turn. It is
on the wizard. Getting this backwards would let a fighter end it by standing
still and being hit. Everything else is on whom it was cast — **minus whoever
it failed to catch**, because a creature that saved against Banishment is not
banished and a record claiming otherwise reports a hit where there was none.

That is why the record is written at the **end** of the resolution rather than
beside the slot: what a casting is on is not knowable until the casting has
resolved. A tracked spell resolves nothing and keeps all its targets, which is
how Darkvision stays dispellable.

### Lifecycle, and the one place it ends

`releaseCasting` is the **single** place the record is removed, so Concentration
breaking, a deadline arriving and an explicit dispel all converge on one answer
to "is this spell still running". There is no second route by which a finished
spell stays queryable, and no zombie.

| | |
|---|---|
| Created | `spell-ongoing`, once the effects have resolved |
| Concentration lost | the existing derived pass; no event, as before |
| Deadline reached | the existing timer; no event, as before |
| No deadline at all | "Until dispelled" runs with no timer — see that section |
| Dispelled, recast, or dismissed by its caster | `spell-ended`, with a reason |
| A trigger the spell prints | the derived pass; **no event** — see "A Casting Can Be Ended By Something That Happens" |
| Target shakes it off | `withoutTarget` clears the stored half and the release clears the held half; the casting runs for everyone else |
| Target's last effect lapses | they stop being on it, with nothing written: `spellOn` asks the world rather than remembering |
| Target leaves the game | leaves `OngoingSpell.aimed`; the spell is **not** ended, because the SRD does not end a Bless when one of the blessed walks out |
| Created again afterwards | refused as a corrupt log — `castingsEnded` is what remembers |

**Expiry and a broken Concentration still write nothing.** Nobody decides
either, so they stay derived — the same audit trade this file already records
for every other derived ending.

**Three paths resolve a casting, and one record has to come out of all of
them.** The ordinary cast, the settlement of a declared one, and the release
of a readied one all end in `resolveEffects`, and the third wrote no
`spell-ongoing`: a readied Bless was running, concentrated on, adding its d4,
and invisible to Dispel Magic. A fork no single-path fixture can see, so
`ongoing-spells.test.ts` now drives the Ready path to the same record.

**A casting's debts include the damage it scheduled.** `scheduledDamage`
carries the casting id in its source exactly as a condition does, and
`releaseCasting` dropped conditions, bonuses and timers while leaving a later
hit standing. No ongoing spell schedules one yet — both delayed-damage spells
are Instantaneous — which is precisely when a convergence point is cheapest to
complete and easiest to forget.

### What a casting is **on**: stored what the cast knows, derived what the world holds

SRD Dispel Magic ends "any ongoing spell ... **on the target**", so the record
has to answer who that is. It is **two facts of different provenance**, and the
record stores only the one nothing else can supply.

| Bucket | Provenance | Disposition |
|---|---|---|
| the caster of a Range: Self spell | a cast-time declaration | **stored** — `OngoingSpell.aimed` |
| a target the casting reported nothing about, which the geometry did not choose | a cast-time declaration — the tracked spells | **stored**, same field |
| whoever the casting hung a live effect on | a world fact `holdsNothingOf` already answers at every read | **derived** |

So `aimed` is the whole of "on" **minus** what the casting is holding at the
cast, and **`spellOn(state, record)` is "on now"** — the union, in
`fold/release.ts`, with `isOn` for the one-creature question. All four readers
ask it and none of them reads the field: `ongoingSpellsOn`, the Dispel
resolver's "on this creature and nobody else", `endOngoingSpell`'s
`no_effect_there`, and the triggered-endings pass. They used to share a
*field*, which is not the same thing as sharing a rule.

**The name is the point.** `on` invited a reader to take the stored subset for
the answer, and the stored subset is the *smaller* half — usually empty, because
most spells hang something on everyone they catch. A field named for the aiming
cannot be mistaken for a field named for the state.

**Why not derive all of it**, which is the obvious move and is *measured*
wrong: a tracked spell like Darkvision resolves nothing and therefore owns
nothing on its target, for ever, so the rule alone answers nobody and Darkvision
stops being dispellable. And the rescue — seeding the derivation from the
cast-time list — is wrong in the other direction, because a target the casting
was released on is still in that list. `docs/design/space-and-areas.md` carries
the measurement and both populations; `derived-on.test.ts` carries the
fixtures.

**What edits the stored half, and what does not.** `withoutTarget` is kept and
is the only writer: a target who shakes the spell off, is dispelled on, or
leaves the game leaves `aimed`, and a dispelled Darkvision has nothing in the
world to lose, so without it the casting would stay aimed at them for ever.
Growth is not an operation at all any more — the `alsoOn` pass on
`condition-applied` is gone, which also closed its own gap: it saw conditions
and none of the five events that *grant* something. And `expireEffects` no
longer shrinks anything; it used to, in its condition branch and in no other,
which is exactly how a `grants` deadline came to leave a stale name behind.

**Compatibility is two steps and the order matters.** `ONGOING_RECORD_VERSION`
is **3**, the shape that stores `aimed`; a record below it stored the whole of
"on", and the subset is computed in the `spell-ongoing` reducer case, which is
the only place that has the state to compute it from. It is correct there
because the record is written **last** in every resolution path, so everything
the casting holds is already on the creatures.

The step that had to come first is in `upgradeOngoing`: its catalogue fill is
keyed on `version === undefined` and nothing else. Keyed on
`!== ONGOING_RECORD_VERSION`, as it was, *any* bump would route every version 2
record through the fill and overwrite an area pinned at the cast with the book
as it reads now — the exact hazard pinning the area was for, one constant edit
away, and invisible to both frozen logs because both are pre-versioned and take
the fill either way. `casting-end-triggers.test.ts` folds a version 2 record
carrying a 15-foot Cube where the catalogue's Web is a 20-foot one and asserts
it comes out untouched.

**The event carries `WrittenOngoing`; the fold holds `OngoingSpell`.** They
were one type only while they happened to agree. A `spell-ongoing` payload is a
line in a log that may be older than this engine; what reaches `state.ongoing`
has been through `upgradeOngoing`, so it is version 3 and it carries `aimed`.

### `spell-ended` carries the whole of Dispel Magic's target distinction

`on: null` ends the casting and everything it made; `on: <creature>` releases it
on that creature. Both operations have existed since Hold Person's repeat save;
this is the event that names which. SRD lets Dispel Magic target "one creature,
object, or **magical effect**", and that is the same distinction: a spell on
this creature and nobody else has nothing left to be, so it ends, while one that
caught three loses only this one.

### A Caster Lets Go By Naming The Casting, Not By Holding It

SRD's Duration section, under **Time Span**: "While a time-span spell that you
cast is ongoing, you can dismiss it (**no action required**) if you don't have
the Incapacitated condition." The engine had half of that.
`endSpellEffectOn` found its casting through `caster.concentration`, which is
the right question for a Concentration spell and **no question at all** for the
rest — a Mage Armor, a Longstrider or a Magic Mouth is nobody's Concentration,
so nothing held it and nothing could let it go. It was the last place in the
command layer a casting was addressed by its holder rather than by its id.

`endOngoingSpell(caster, castingId, on)` is the correction, and it writes the
`spell-ended` the Dispel resolver already writes: **no new event and no reducer
change**, because both operations have existed since Hold Person's repeat save
and `on` has named which since that event was written.

**What it bought is narrow and is worth stating as narrowly as it is.** The
shape it unblocks — `a-casting-dismissed-early` — finishes **no spell at all**,
and every one of its claimants survives it. It was bought for the correctness
of the addressing, which is the last instance of a rule reachable only through
a fact that is true of one kind of spell.

`endConcentration` stays, and the two are not redundant: that one is about a
*Concentration*, which is what a caster reaches for when they do not know or
care which casting they are holding, and it writes `concentration-ended` with a
reason of its own. Both converge on `releaseCasting`, still the single door.

**`OngoingEndReason` gained `dismissed`** rather than reusing `dispelled`, for
the reason `ConcentrationEndReason` already keeps `voluntary` apart from it
four lines away: a dispel is somebody else's magic defeating yours, and this is
the creator letting go of their own. A log should not say a wizard dispelled
themselves.

**It spends nothing and is guarded anyway** — `relocateCreature`'s combination
exactly, and worth stating rather than leaving to be inferred. SRD spends no
Action, Bonus Action, Reaction, movement or pool use on a dismissal, so the
action-economy sweep never classifies it and no exemption list has anything to
say about it. It consults `mayAct` because ending a casting **forgives what
that casting already owes**: `releaseCasting` drops the casting's outstanding
`OwedAreaEffect`s, so a Web dismissed while somebody's save was owed would lose
a rule the boundary had already raised — the engine losing a rule to its own
bookkeeping, which is the sentence this file already writes about a casting
that outlives its caster. A guard nobody asserts is what this file keeps
finding, so it is driven in both directions, beside `resolveCast`'s.

**A release names a creature the casting is on**, which is `isOn`'s own answer,
and that is where the old command's `no_effect_there` went. It scanned for a
condition instance — only the derived half of the question, and the half a
tracked spell like Darkvision is invisible to, because Darkvision is on
somebody and hangs nothing there. Same code, because it is the same mistake.

#### The word that scopes the clause is the easiest thing here to elide

SRD's Duration section lists **three** forms — Concentration, Instantaneous,
Time Span — and prints the free dismissal under the third and only the third.
A Concentration is free to end by its own separate sentence, which is the one
`endConcentration` has always quoted: "The creator can end Concentration at any
time (no action required)." So both of those are covered, by two sentences
rather than by one.

**"Until dispelled" is neither, and the book gives its caster nothing.** Arcane
Lock and Continual Flame each consume a costly component and print no ending
whatever; a free dismissal of one would be the engine answering a question the
SRD declined to ask, which is the same reading `untilDispelled` already gets
from the other direction — *"Inventing a big number of seconds would be the
engine answering a question the SRD declined to ask."* So it is refused
(`not_dismissible`), which is the shape `ritual`, `damage_type_fixed` and
`no_fought_clause` already take for a clause a spell does not print.

**The duration form is read off the casting, never off the catalogue.** A time
span is a `casting` timer, pinned at the cast; a Concentration is the caster
holding it. Asking `definitionFor` would let a definition corrected next month
decide whether a casting made today may be let go, which is IE-007's rule
applied to one more fact. The discriminating fixture is therefore a casting
with **no deadline at all** — Mage Armor and Continual Flame are both ongoing
and both non-Concentration, and only the timer tells them apart.

It was the elision that got this wrong first, and it is worth recording
because the brief quoted the clause with the same word missing and an
independent review is what caught it: *when the brief and the paragraph
disagree the paragraph wins*, which is the rule the `fought` list already
established.

#### The shape kept all three claimants, and gained two more

This is the fourth time a build has corrected the query that predicted it, and
the first time the correction ran entirely the other way.
`a-casting-dismissed-early` blocked Animal Shapes, Astral Projection and
Gaseous Form; the general sentence is now built, and **every one of those three
prints an exception to it**:

| Spell | SRD | What a dismissal does not carry |
|---|---|---|
| Animal Shapes | "until **the target** ends it as a **Bonus Action**" | the target, and a Bonus Action |
| Gaseous Form | "**the target** ... takes a **Magic action** to end the spell on itself" | the target, and a Magic action |
| Astral Projection | "if **you** take a **Magic action** to dismiss it" | a Magic action |

Two of the three are ended by the **target** rather than by the caster, and all
three cost an action the book prints where SRD's general dismissal costs none.
So the shape survives with its description narrowed to the exceptions rather
than the rule.

**Two more claimants it had never recorded**, and why they were missing is the
tracked guard's own stated floor: **no `MECHANICAL_MARKER` fires on the phrase
"the spell ends"**, so neither Instant Summons' "you can take a Magic action to
speak the object's name and crush the sapphire ... and the spell ends" nor
Magic Mouth's "you can have the spell end after it delivers its message" could
be filed in `TRACKED_ADJUDICATED` at all, and IE-036 recorded both in
`unmodelled` prose instead. Both keep a blocker, and **both are Until
dispelled** — so the duration form above is what refuses them, before the
question of what each sentence asks for is reached at all. Instant Summons is
refused twice over, because it also charges a Magic action where a dismissal
spends nothing; Magic Mouth's "When you cast this spell, you can have the spell
end after it delivers its message" is a choice the caster makes at the casting
whose *consequence* the engine still cannot perform. Both notes are corrected
where they stand.

**That pair is the sharpest thing in the batch, because the first correction
was wrong.** Magic Mouth's note was re-adjudicated from debt to fiction on the
strength of a permission the command should never have had, and it took an
independent review reading the Duration section to find it. A note is only as
honest as the code it describes, and a note *re-filed* on the strength of a
build is the place that bites hardest.

**The marker set was not widened to see them.** It is a floor by design, and a
guard extended so that a record comes out complete is a guard answering its own
question — the same reason `spell-tracking.test.ts` says in its own words that
it reads English and that a rule phrased in none of those words slips past.

### Dispel Magic is 2024, and 2024 removed a roll

"Any ongoing spell of level 3 or lower on the target ends" — **no check at
all** below the threshold. The 2014 habit of rolling for everything is a
different spell. Above it, "DC 10 plus that spell's level", a bare ability check
on the caster's spellcasting ability. And the printed "level 3" is not a third
number: it is the same sentence as *Using a Higher-Level Spell Slot* read at
the spell's own level, so the engine has one rule — **automatic at or below the
level this casting was made at.**

The definition therefore carries **no numbers at all**. Every one of them is a
fact the engine holds, and a definition restating any would be a second place
to get the spell wrong.

### A Casting Can Be Ended By Something That Happens

The table above had four ways a casting ends and every one of them is either a
moment on the clock or somebody's decision. The SRD writes a fifth — a spell
that stops because **something happened**, and nobody decided it — and that is
`SpellDefinition.endsEarly`, a closed list of five transcribed causes.

| Member | SRD |
|---|---|
| `target-attacks`, `target-deals-damage`, `target-casts` | Invisibility: "The spell ends early immediately after the target makes an attack roll, deals damage, or casts a spell." |
| `target-dons-armor` | Mage Armor: "The spell ends early if the target dons armor." |
| `caster-or-ally-damages-target` | Animal Friendship: "If you or one of your allies deals damage to the target, the spells ends." — the raw file's typo included |

**Derived, so no event.** Nobody decides that the target swung, so the reducer
finds it, exactly as it finds a lost Concentration and an arrived deadline. The
same audit trade follows: the log shows the blow and not the spell ending, and
a target's history says the condition arrived and not that it lapsed.

**The scope is printed too, and it is not one answer.** Animal Friendship and
Mage Armor say "the spell ends"; Charm Person bounds the *condition* — "until
the spell ends or until you or your allies damage **it**" — and Mass
Suggestion spells the difference out in its own paragraph, "the spell ends
**for a target**". So `CastingEndTrigger.ends` transcribes which, and the two
doors are `releaseCasting` and `releaseOnTarget`, both of which already
existed. One answer for both would make a level 3 Charm Person free two
creatures for one blow, or leave Animal Friendship running on a Beast the party
has just shot.

**Pinned on the record at the cast**, by IE-007's rule and for its reason: a
trigger list is catalogue data, so a fold that looked it up would let a
sentence corrected next month reach a casting made today. A **pre-versioned**
record is filled from the catalogue by `upgradeOngoing`, exactly as its area
is, because that log never wrote the fact down and there is nowhere else to
read it. **`endsEarly` did not bump the version**, and that is a decision: it
changes the meaning of no field already there, so absence on a version 2 record
means the spell prints no such sentence.

At the time that was also the *only* safe answer, because the catalogue fill
was keyed on `!== ONGOING_RECORD_VERSION` — any bump would have run every
version 2 record through it and overwritten a **pinned** area with the book as
it reads now, the hazard pinning it was for. IE-053 keyed the fill on
`version === undefined`, which is the condition it always meant, and then bumped
to version 3; a version 2 record's own `area`, `areaTrigger` and `endsEarly` are
read off the record and the book is opened only for a record older than the
fields. See the section on what a casting is on, above.

**A trigger hangs on a consequence event, never on `roll-recorded`.** That
event changes no state by rule, and an ending hung there would fire on a roll
whose outcome had not happened. So `target-attacks` reads `attack-made`, which
is the Attack action — and the residue is named rather than hidden:
Invisibility's own `unmodelled` says that a **free** attack roll that *misses*
— an Opportunity Attack, or any swing outside combat — leaves it running,
because nothing but `roll-recorded` names the roller of one. A free swing that
lands still ends it, through the damage it deals.

**"Ally" is declared allegiance, and an undeclared one is withheld rather than
invented.** `allyOfCaster` answers four ways — `caster`, `ally`, `not-ally`,
`unknown` — and only the first two end anything. The caster is never in doubt,
because the sentence names them. A derived pass has no `unverified` line to
write, so **`withheldEndings` is the query** a caller asks instead: it names
each casting carrying the clause and the creatures whose damage could not be
judged. Same three-valued discipline as declared cover, declared sight and
Sneak Attack's flanking clause.

**The subject has to be a creature the casting is on.** Every sentence says
"the target", and `spellOn` is the engine's answer to which creatures those are
— so a Mage Armor on the wizard is untouched by the fighter putting a
breastplate on. It is also the reading that made the fixture discriminating:
an invisible creature who is *also* the one acting cannot tell "read the
casting's target" from "read the event's id" apart.

**The loop terminates structurally, and that was measured rather than
assumed.** The pass releases castings and then reads the state the release
left, so it has to consume something it cannot recreate — the move
`expireEffects` makes by deleting the timer key *before* acting on it. Here it
is the `(casting, creature)` pair, recorded before the release and skipped
afterwards. Progress is in fact implied today by what the two doors remove, and
the mutation that proves so **hung the fold** rather than failing a test:
termination resting on what a function three hundred lines away happens to do
is correct until somebody edits the other end, and a wedged fold is the worst
possible way to find out. With the pair recorded, the same mutation is three
red tests.

**And it is cheap first.** Four event types can say anything at all here and
every other one returns before `state.ongoing` is touched — the discipline
`anyCreature` established for the three passes that sort the whole cast.

#### What this deliberately does not reach, and the spell that corrected the query

A trigger whose fact no consequence event holds is **filed rather than
modelled**, and the list is long enough to be worth reading: *any* damage from
anybody (Modify Memory, Sleep, Sequester, Phantom Steed, Project Image,
Eyebite), a distance two creatures drift apart (Faithful Hound, Warding Bond,
Antilife Shell), a running total dealt (Guardian of Faith), a condition the
caster chooses at the casting (Sequester), letting go of an object
(Shillelagh), leaving an area (Tiny Hut), dropping to 0 Hit Points (Gaseous
Form), another spell ending this one (Geas), and ending **one effect** of a
casting rather than the casting.

That last one is Mislead, and it is the third time in this file that building a
shape corrected the query that predicted it. `a-casting-ended-by-a-trigger` was
Mislead's **only** recorded blocker, so the derivation said this would finish
the spell. SRD says otherwise twice over: "The double lasts for the duration,
but the **invisibility** ends immediately after you make an attack roll, deal
damage, or cast a spell" — `ends` says `casting` or `target` and neither is
*one effect of a casting* — and the entry had never recorded the double at all,
which prints Project Image's sentence word for word. So the shape stays on it
and `a-second-place-to-put-a-creature` joins it. A count is only as good as the
shape it counts, and the way to find out which shapes are bundles is to build
one.

**Hypnotic Pattern is the case that says the list was not widened to fit.** Its
clause is "It wakes up if it takes **any** damage or if another creature takes
an action to shake it awake" — *any* damage is not the caster's or an ally's,
and the second half is an action a spell grants. Neither half is one of the
five, so the adjudication is untouched.

**A trigger on a casting that never runs is refused at authoring.**
`end_trigger_without_casting` is `grant_without_lifetime`'s sentence about the
other thing a definition leaves standing: an Instantaneous casting is over the
moment it resolves, never enters `state.ongoing`, and a trigger on it names a
moment that can never arrive. Its own code rather than that one, because the
fix is different — there is no rider to give a deadline to.

### Acting through a spell on a later turn

`activateSpell` is the narrow shape two SRD spells write identically —
Vampiric Touch and Flame Blade — and it is not scripting. What is pinned and
what is read afresh is the whole design:

| Pinned at the casting | Read again now |
|---|---|
| the level, so the dice do not grow when the caster does | who it is aimed at |
| the numbers themselves, so a levelled-up caster does not move the save DC | the range to them |
| the caster — nobody else may act through it | their Armour Class, conditions, defences |

**Flame Blade is the one that proves the shape is a shape**: its casting does
nothing whatever, so its own effect list is empty and every blow it strikes
comes through the activation. A spell whose activation the engine resolves is
therefore **executed, not tracked**, and `coverage.ts` counts it that way.

**Produce Flame is the same shape at cantrip level, and it separates two ranges
that a single field would have merged.** SRD prints **Range: Self** — what the
casting reaches is the caster's own hand — and then lets a later Magic action
hurl the flame "within 60 feet of you". So the sixty feet are
`activation.range`, checked afresh on every throw, and `range` stays `self`, so
a casting aimed at somebody is refused. Putting the sixty feet in `range` reads
fine and makes the spell castable *at* a creature, which it never is. The dice
follow the same split: a cantrip has no slot, so the growth is
`cantripUpgradesAt` read off the caster — the one number an activation could
otherwise carry quietly wrong for ever.

### The family that works and the family that does not

The twenty-odd spells that act on a later turn split cleanly, and the split is
not about the rule — it is about whether the spell made a **thing with its own
position**:

| | Spells | Status |
|---|---|---|
| A permission the caster exercises | Vampiric Touch, Flame Blade, Produce Flame, Expeditious Retreat, Gust of Wind, Telekinesis, Detect Thoughts | the shape built here |
| A permission exercised **from a point** | Spiritual Weapon, Arcane Sword | see "A Casting Can Hold A Point" below |
| A thing with statistics | Unseen Servant, Arcane Hand, Project Image | the **summons** seam |
| A point whose effect needs a trigger the engine lacks | Flaming Sphere, Call Lightning's cloud, Dancing Lights, Arcane Eye, Mage Hand's hand, Silent Image, Mislead | named, spell by spell, below |

The second row was the doctrine's own "non-creature persistent world objects"
seam and is now open. The third and fourth are not, and the split between them
is the thing that batch settled: **what the SRD prints decides it, not what the
spell looks like.**

## A Casting Can Hold A Point

`OngoingSpell` gained one optional field, `origin: Point`, and that is the
whole of the spatial primitive. No entity, no object record, no second
identity, nothing in the scene's `positions` table.

**Spiritual Weapon is the adversarial case, and it argues against itself.** It
is the spell most obviously "a thing" — a floating spectral weapon that moves
about the battlefield and hits people — so if anything in the SRD justified a
world object, it would. Read against the two spells in the same book that
*are* objects, it prints none of what they print:

| | Spiritual Weapon | Unseen Servant / Arcane Hand |
|---|---|---|
| Armour Class, Hit Points | none | "AC 10, 1 Hit Point"; "AC 20 and Hit Points equal to your Hit Point maximum" |
| Can be attacked | nothing addresses it | dropping to 0 Hit Points ends the spell |
| Occupies its space | nothing says so | Arcane Hand says explicitly that it does **not**, which is a rule only an occupant needs |
| Acts | the caster spends a Bonus Action | commanded, with a Strength score of its own |
| Moved by anyone else | no | no |

So: **a point is a point until a mechanic proves it needs to be more.** Giving
the force a creature record would have been inventing an Armour Class the book
declines to print, and every spell that hits it would then have been the
engine answering a question the SRD asked nobody.

**Three numbers, three homes, and they are not interchangeable.**

| SRD | Field | Measured from |
|---|---|---|
| "appears within range in a space of your choice" | `range` | the caster |
| "one creature within 5 feet of the force" | `origin.reach` | the point |
| "move the force up to 20 feet" | `origin.movableBy` | the point, **now** |

The third is why the allowance lives on the definition rather than a boolean
beside it: a fixed origin — Web's Cube, Call Lightning's cloud — is the same
storage with no `movableBy`, so **a fixed origin and a movable one share
state without sharing commands.** Do not give a spell a movement allowance
because it has a point.

### Actor and spatial origin are two different things

This is the seam the spell forced, and it is one optional argument wide.
`resolveEffects` takes a `from?: Point`; the roller, the attack modifier, the
dice and the level are all still the caster's, and only the *spatial* questions
move — the reach, and the Prone rule that reads "within 5 feet of you".

The two alternatives were both lies in state: moving the caster to the force
(a teleport nothing narrated) or making the force a creature (an Armour Class
nobody printed). Audited across the engine, nothing else needs the distinction
yet — a weapon attack, a spell attack and an Opportunity Attack all originate
at their attacker — so it is an argument rather than a concept.

### Moving the point is not creature movement

The two change coordinates and share nothing else. None of Speed, Difficult
Terrain, Opportunity Attacks, occupancy, Prone-for-sharing, Grappled or
Disengage applies, because the SRD applies none of them to the force. Routing
the relocation through `moveCreature` to reuse the geometry would have imported
every one of them silently, which is why `relocateOrigin` is its own eight-line
function that reuses the *ruler* and nothing else.

What the engine does own is exactly what the SRD prints: the allowance in feet
measured from where the point is **now**, the scene's extent, and the identity
of the casting being moved. The caller chooses the destination.

**The move is part of the activation, not a command of its own.** Every SRD
spell in this family spends one action to move and act — "move the force up to
20 feet **and** repeat the attack", "you can control the hand thus again. As
part of that action, you can move the hand up to 30 feet" — so a separate
command would charge a second Bonus Action or charge none, and both are wrong.
`ActivateSpellCommand.to` is optional because "up to 20 feet" includes none of
them.

### A casting that holds a point is on nobody

`spellOn` answers Dispel Magic's "any ongoing spell **on the target**", and the
force is not on the goblin it hit. A Dispel Magic aimed at that goblin must not
put the Cleric's weapon out, so the presence of an origin *is* the rule: the
spell is on its point, it is aimed at nobody, and it holds nothing on anybody —
which are the two halves of the answer, both empty.

### What the SRD scene test had to be

Two guards looked tested and were not, and the reason is worth keeping: in a
600-foot hall, **every space past the wall is also past sixty feet**, so the
range check answers first and a missing scene check hides behind it
permanently. The discriminating fixture is a room barely wider than the spell
reaches. Same lesson as the multiclass fixture and the Rogue who resisted
nothing: a guard needs a case where it is the *only* thing that can refuse.

### The point goes with the casting, through one door

`releaseCasting` already removed the conditions, bonuses, timers and scheduled
damage a casting created, and the record with them — so the origin needed no
new cleanup at all. Concentration broken, the minute running out, a dispel, the
caster leaving: all four converge there, and a test asserts the serialised
state mentions the casting id **only** in `castingsEnded` — the one deliberate
trace, which is what lets the fold refuse a `spell-ongoing` naming a casting
that is over. No point, no timer, no stamp, no debt, no bonus.

**A new scene leaves the point where it was**, and that is a debt with a name
rather than an accident. `scene-set` unplaces every creature and nothing can
re-place a force — the only command that moves one moves it twenty feet.
Dropping the point instead would be worse: a Spiritual Weapon with no point is
a spell whose every reach check silently stops happening. So the coordinate
stands, the reach comes back in `unverified`, and the real fix is the
doctrine's multiple-scenes seam.

### Which spells this reaches, and which it does not

Thirty-nine SRD spells keep a place. **Two are executable by this primitive
today** — Spiritual Weapon and Arcane Sword — and the honest reason the rest are
not is never "it needs a position":

| Blocked on | Spells |
|---|---|
| A creature that **ends** its turn in an area | Moonbeam, Cloudkill, Incendiary Cloud, Insect Plague (and Grease and Black Tentacles, whose casts already execute) |
| A creature that **starts** its turn in an area — a different boundary, a round apart | Stinking Cloud and Web (**built**), Sleet Storm, Zone of Truth |
| A creature that **enters** an area, on its own move or a forced one | Web, Grease, Insect Plague, Moonbeam, Cloudkill, Incendiary Cloud, Black Tentacles, Sleet Storm, Zone of Truth |
| An area that **moves into** a creature's space — printed only by areas that move | Moonbeam and Spirit Guardians (**built**); Cloudkill and Incendiary Cloud, blocked on automatic turn-start drift |
| Ending a turn within 5 feet of a point, and a point rolled into a creature's space | Flaming Sphere |
| Distance travelled inside an area, which no move records | Spike Growth |
| A wall with a length and a barrier rule, and no later trigger at all | Wind Wall |
| An activation that resolves an area at a point chosen now | Call Lightning, Storm of Vengeance |
| A stat block created mid-fight | Unseen Servant, Arcane Hand, Phantom Steed, Summon Dragon, Giant Insect, Find Familiar, Find Steed, Animate Dead, Create Undead, Animate Objects, Planar Ally, Simulacrum |
| Walls and barriers as obstacles | Arcane Eye, Passwall, Wall of Stone, Prismatic Wall |
| A standing effect derived from where a creature is standing | Spirit Guardians' halved Speed, every Paladin aura |
| Light, which is not modelled | Dancing Lights, Daylight, Darkness |
| A second location | Project Image, Secret Chest |

**Three spells left the stat-block row when it was read against the book**, and
the correction is recorded rather than made quietly. It used to say "the four
Conjures, Guardian of Faith, Faithful Hound"; SRD 5.2.1 rewrote the Conjure
family as **spirits** — a pack, a pillar of light, an Emanation, a point you
strike from — and none of the six prints an Armour Class, Hit Points or a turn,
any more than Guardian of Faith or Faithful Hound does. Conjure Fey turns out
to be Spiritual Weapon's shape exactly and is blocked on nothing at all. What
is in the row now is the spells that genuinely print a stat block, and
`blocked-on.test.ts` asserts both halves so the row cannot drift back. See "A
Consumer Count Is A Query".

**One origin per casting, and Dancing Lights is the reason that is a decision.**
It is the only SRD spell that makes several independently placed things from
one casting — four lights, each within 20 feet of another — and it is blocked
on light being modelled at all, so plural storage would be a shape built ahead
of any mechanic that could use it. Adding an index later is additive to the
event and to the record; choosing plurality now would not be.

**Call Lightning was audited as the candidate second user and rejected.** Its
cloud is a fixed origin, which is exactly the evidence wanted — but its
activation aims at a *point* and resolves an area there, which no activation
does, and its "point you can see" and outdoor-storm damage bonus are facts the
engine does not hold. It is a new shape, not a transcription.

**Arcane Sword is the second user, and it arrived as data.** SRD prints the
same three numbers in the same three places — 90 feet of Range to place the
sword, 5 feet of reach measured from it, 30 feet a later Bonus Action may move
it — so the definition needed no field and no code, which is what a second user
is for. It is also where the value of *not* carrying a rule across became
visible, twice in one paragraph:

- **"you make" is not "you can".** Spiritual Weapon's force appears whether or
  not there is anything beside it, which is `TargetRule.optional`; Arcane Sword
  names the attack without that word, so its casting takes a target and an
  activation naming nobody is refused. One word of SRD, one field.
- **It prints no *Using a Higher-Level Spell Slot* line at all**, so 4d12 from a
  level 9 slot is still 4d12. A `perSlotLevelAbove` copied off the neighbouring
  definition is invisible to every guard, and what catches it is casting the
  spell from two slot levels under one seed and comparing.

Its one gap is the destination: SRD moves the sword "to a spot you can see", and
sight here is a declared fact **from one creature to another** while a
destination is a coordinate. There is no pairwise declaration to read and
nothing it could read instead, so that is the table's — the line declared cover
already draws — and it is adjudicated as such rather than left unsaid.

### Two bugs this found in code that was already there

- **`releaseOnTarget` computed the surviving bonuses and never applied them.**
  From the day it was written. Nothing noticed because every spell that
  released on one target hung a *condition* — Hold Person, Black Tentacles —
  and Dispel Magic is the first thing to release a spell that hung a **bonus**.
  A Bless the rules had ended went on adding its d4.
- **`spell-cast` never declared the `route` it was emitting.** Excess-property
  checking on a union accepts a property **any** member declares, and
  `PendingCasting` declares one — so the field reached the log and no reader
  could see it. This is the second instance of that trap in this file; the
  first was a `command` stamp on an event that did not declare it.
