# Time: durations, turn boundaries, and rests

The two kinds of duration and the one conversion between them, what a turn boundary collects, and how rests and the clock work. **Read this before changing durations, deadlines, turn hooks, or rests.**

> **Authority.** This document is authoritative for its subject. It was
> extracted verbatim from `CLAUDE.md` when that file became the
> constitution and router; the sentences below are the repository's own
> reasoning, unchanged. `docs/IMPOSSIBILITY_ENGINE_DOCTRINE.md` outranks it,
> and `CLAUDE.md` outranks it on anything it still states directly.

---
## Rests And The Clock

There is one clock, counting seconds up from the start of the campaign. No
calendar, no time of day — those are fiction and the DM owns them. What the
rules need is "how long since", and that is subtraction: the sixteen hours
between Long Rests, the hour that turns a broken Long Rest into a Short one.

Seconds because the game's units nest exactly — SRD, "A round represents about
6 seconds", ten rounds to the minute — so every duration the rules name is a
whole number of them and nothing lands between two rounds.

**In combat the clock is derived.** A round ends when the Initiative order
wraps, and six seconds have passed; nobody decides that. Out of combat, how
long the party spent searching the vault is narration, so it arrives as a
`time-advanced` event. Same split as everywhere else: rules are derived,
judgements are events.

**A rest is a span, not a button.** It begins, time passes, it ends. That is
what lets the engine tell a completed rest from an abandoned one, and apply the
rule that turns a Long Rest broken after an hour into a Short Rest rather than
into nothing.

**The engine notices its own interruptions.** The SRD lists four, and three of
them the engine can see: rolling Initiative, casting a spell other than a
cantrip, and taking any damage. Those mark the rest *as they happen*, so ending
it reads what occurred instead of asking the caller to report it — a caller who
had to report them would eventually miss one, and the party would collect a
rest the rules had already broken. The fourth, "1 hour of walking or other
physical exertion", is fiction the engine cannot see, so that one is passed in.
The first cause is the one that broke it; later ones change nothing.

**Hit Dice are a resource pool**, tagged `long-rest`, with the die size in the
key because nothing else knows it: a sheet has a level but no class, and the
class table saying a Wizard takes d6s is not modelled. Declared, never derived
— the same rule as every other pool, and the reason pools landed before classes
did.

Spending them validates every die before rolling any, so asking for more than
are left costs neither a die nor a turn of the generator.

### Limitations, again stated rather than papered over

- **A rest cannot be resumed.** SRD lets you pick a Long Rest back up for one
  extra hour per interruption. Durations did not deliver this: it needs a rest
  that survives its own interruption and accumulates required time, which is a
  change to how a rest ends rather than a deadline on an effect. Beginning a
  fresh rest works.
- **Sleep is not Unconscious.** SRD: "During a Long Rest, you sleep for at
  least 6 hours... During sleep, you have the Unconscious condition." Applying
  that needs the rest to be a state a creature *sits in* mechanically, not just
  a span the engine measures, and it would interact with the Concentration
  break in ways worth testing properly rather than bolting on.
- **Reduced ability scores and a reduced hit point maximum are not restored**,
  because neither is modelled in the first place.

## Durations Are Two Different Things

The SRD writes how long an effect lasts in two ways, and they are **not**
interchangeable:

| | |
|---|---|
| A span of time | "1 minute", "8 hours", "10 days", "Concentration, up to 1 hour" |
| A moment in the turn order | "until the start of your next turn", "until the end of your next turn", "until the end of the current turn" |

A round is six seconds, so folding the second into the first looks free. It is
not. Where "the start of your next turn" falls depends on where the anchor sits
in the Initiative order *and* on whose turn the effect began — anything from
the very next moment to a full round away. Outside combat it has no meaning at
all, because there are no turns.

So `duration.ts` has two types. `Duration` is what a caller asks for: relative,
and sometimes unanswerable. `Deadline` is what the log records: absolute, and
always answerable. `resolveDuration` is the single conversion between them and
it **can refuse** — a turn-anchored duration outside combat, or anchored to a
creature who is not in the fight, is an error rather than an approximation.
That refusal is the whole point of the split.

**The conversion refuses and the command layer asks**, which is one sentence
and two different jobs. `resolveDuration` is a pure helper and hands back a bare
`no_turns` or `not_in_combat`, because it knows a `Duration` and a clock and
nothing whatever about which rule wanted the deadline; the command that does
know turns that into a `turn-order` request naming `beginCombat`, and the caller
establishes the timeline and sends the same command again. That split is the
rule this file already states for every other request kind — see "A missing fact
is a request, not a refusal" — and keeping it is what makes the refusal safe to
leave in place: **the one thing nothing here may ever do is convert a
turn-anchored duration to seconds**, and a conversion that always refuses cannot.

**`schedule` is where the command layer asks, because it is the single door.**
Five modules give an effect a moment to stop at — a condition a DM hangs, a
casting's own Duration, a readied spell's, a feature's activation, the grant a
`speed-change` rider makes — and every one of them reaches that function, so a
sixth gets the request with nothing to remember. The two sites that **ask**
without going through it are the casting's declaration and `riderDurations`'
pre-flight — three other sites call `resolveDuration` directly and convert
nothing, each for a written reason the sweep below checks. The pre-flight sits
**before the slot, the action and the first die** by the
same validate-before-rolling rule the rest of casting obeys — so a Ray of Frost
asked for in a corridor costs its caster nothing at all, which is asserted on
the state rather than on the `Result`.

**And the members are derived too**, one level below the call sites: the clause
a request quotes is read off the duration's own kind, so a turn-anchored
`Duration` member the table does not know would fall through to the bare
refusal — a site left refusing with no symptom, arriving inside the guard
against exactly that. IE-043 added the fifth member in this tranche, so the
population is read out of `resolveDuration`'s own `switch` — the kinds it
answers `no_turns` for, fall-through and all — and every one is driven through
the conversion.

**Every such site is converted or carries a written reason, and it is a derived
sweep rather than a reading.** `turn-context.test.ts` reads every
`resolveDuration` call in `commands/` and `rest.ts` and fails naming any that
hands the bare refusal back, because a site left refusing has no symptom
whatever — no failing test and no wrong number, just an orchestrator that gives
up on a legal cantrip. Three are exempt and each names the fact that ends it:
two whose argument is a **span** and therefore cannot be turn-anchored, and
`scheduleDelayed`, where SRD Acid Arrow's later 2d4 is reported in `unverified`
and not scheduled rather than refused — the casting succeeded and its first hit
landed, so there is nothing for a caller to repair.

**Start and end of turn are a full round apart**, so combatants count turns
begun and turns ended separately. Nothing derives one from the other. The
asymmetry that catches people out lives in the constructors: said on the
anchor's *own* turn, "the end of your next turn" is two turn-endings away,
because the turn in progress has not ended yet, while "the start of your next
turn" is one turn-beginning away, because the turn in progress has already
begun. Callers say `startOfNextTurn(who)` and `endOfNextTurn(who)`; nobody
writes counts by hand.

**And the moment that asymmetry made unsayable is the turn in progress
ending.** SRD writes "until the end of the **current** turn" — Stinking Cloud's
Poisoned, Superior Hunter's Defense's Resistance, Steady Aim's Speed of 0 — and
the nearest thing the vocabulary had was a full round out: `endOfNextTurn` said
of the creature whose turn it is resolves *two* turn-endings away, because the
turn in progress has not ended yet. `endOfCurrentTurn` is the fifth `Duration`
member, and it is exactly one turn-ending away, always.

**It names no anchor at all, and that is the member rather than an omission.**
"The current turn" is a moment in the order and not a fact about a creature, so
the anchor is derived at resolution from whoever is taking the turn. The two
consumers prove the difference is real rather than cosmetic: Stinking Cloud's
clause fires at a *start-of-turn* boundary, so the turn it ends at is the
poisoned creature's own, while Superior Hunter's Defense answers damage taken
on somebody **else's** turn and ends at the attacker's. An `of` field would
have been read by nothing — one duration cannot be told which of those it is —
and a field nothing reads is the speculative member the format's own sweeps
exist to refuse.

It is a **constant** rather than a function for the same reason, and it is
still a constructor in the sense that matters: `resolveDuration` is the only
thing that turns it into a count, so nobody writes one by hand. Combat-scoped
like its four siblings, refusing `no_turns` outside a fight under the code they
already use — **no conversion to seconds anywhere**, because there is no turn
to convert, which is the whole of what the two-type split is for.

**The mutation that proves it is the off-by-a-round it exists to prevent.**
Changing the count from `ended + 1` to `ended + 2` — which is precisely what
using `endOfNextTurn` here would have done — reddens five tests in two files:
the two constructors compared in the same instant, the pair driven through a
fold a round apart, the anchor case, and both ends of Stinking Cloud. And the
mutation that anchors the rider to the **caster** instead reddens the two spell
drives alone, which is what a caster standing outside their own cloud is in the
fixture for.

**Turn-anchored timing is combat-scoped, and that is a policy, not a rule.**
When the fight ends, or the anchor leaves the Initiative order, the moment the
effect was waiting for will never arrive. The SRD does not say what happens
then — it does not contemplate the question, because at a table the DM simply
answers it. Three things the engine could do, and only one of them is safe:

| | |
|---|---|
| Leave it running | A permanently Restrained goblin, with no moment left that could ever free it |
| Convert it to elapsed time | Inventing a number the rules never gave — exactly what this engine exists not to do |
| End it with the fight | Chosen |

So it ends, and the consequences are worth stating rather than discovering:

- **It is gone, not paused.** A second fight does not resume it; nothing was
  kept to resume.
- **It ends early when combat ends early.** Dodge's benefit vanishes the
  instant the last enemy drops, which is usually what a table would say — but
  it is the engine saying it, not the rules.
- **An anchor who flees, dies or is removed takes their effects with them**,
  even where a DM might have ruled that the creature still has turns somewhere
  off-screen.
- **Nothing in the log says why.** Expiry is derived, so the effect is simply
  absent on the next fold — the same audit trade Concentration already makes.

A caller who wants an effect to outlive the fight says so in elapsed time,
which is combat-independent and means exactly what it says. The engine will not
translate between the two on anyone's behalf.

**Expiry is derived, like Concentration breaking.** A duration running out is
not a decision anybody makes, so the reducer ends expired effects after every
event, and no log — however assembled — can show an effect still running past
its own end. Timer keys are visited in sorted order, so a fold is byte-identical
however the effects were scheduled.

**A timer names what it ends**, and `EffectTarget` is the closed list of what
that can be. One condition instance on one creature expires that instance and
nothing else — two Clerics' Hold Persons on one goblin with different durations
end one at a time. A whole casting ends the casting and everything it created,
which is the same cleanup a broken Concentration performs, so "Concentration,
up to 1 minute" is both at once: losing Concentration ends it early, reaching
the cap ends it regardless. A **feature** a creature switched on is SRD Rage's
"lasts until the end of your next turn", on a thing that is neither.

**The fourth is every grant one source made on one creature**, and it is the
one that took a task of its own. `bonuses`, `armorClasses`, `rollModifiers` and
`grantedDefenses` all end when their casting does and nothing ended one
*sooner* — which is why `ModifierRider` carries no `lasts` and why SRD Superior
Hunter's Defense ("Resistance to that damage ... **until the end of the current
turn**") had nowhere to be written. Three decisions, each of which could have
gone the other way:

- **`source`, not a casting id**, so a feature's grant and a casting's use one
  member. `Stoneskin#cast:3` and `ranger:superior-hunters-defense` are the same
  kind of string to a timer.
- **One member, not one per grant kind.** A per-kind member would need a
  per-kind *identity* — `rollModifierKey` against a bare source, which are not
  the same string — and would be four ways to write one sentence. What ends is
  *what that source granted*, which is one question however many of the four
  answer it.
- **It ends the grant and never the casting.** The spell goes on running, stays
  concentrated on and stays in `ongoing`; only what that source hung on that
  creature goes. A casting whose grant expired is still a casting, which is the
  whole difference between this member and `casting`.

Timers are keyed by their target rather than numbered, so re-applying the same
effect from the same source *replaces* its deadline instead of leaving a stale
one behind to end it early.

### One enumerator for the four, because the fourth was threaded through five places

`bonuses`, `armorClasses`, `rollModifiers` and `grantedDefenses` are four lists
of the same shape — a grant, and the source that hung it — and **five functions
walked all four by hand**: `releaseCasting`, `releaseOnTarget`,
`releaseGrants`, `expireEffects` and `holdsNothingOf`. The fourth family
arrived after the other three and had to be added to every one of them. A fifth
added to three of the five is how a grant comes to be ended by a dispel and not
by a deadline — silently, because each site is correct on its own terms, which
is the shape of the two lists of pool kinds `poolsFor` collapsed and the four
readers `roll-modifiers.ts` replaced.

`grantSourcesOf(creature)` is the read and `withoutGrants(creature, predicate)`
is the removal, and all five route through them. The predicate is the whole of
what varied: `releaseCasting` and `releaseOnTarget` match the casting id inside
the source, `releaseGrants` matches the bare source a feature's deadline
carries.

**The list of families is derived from `CreatureState`, not written down.**
`GrantFamily` is every key whose value is a list of things carrying a `source`,
so a fifth family joins it on the day it is *declared* — and `grantsOf`, whose
return type is a mapped type over it, then fails to compile naming the property
it lacks. There is one such literal and `withoutGrants` builds its answer from
it rather than spelling the four out again, so a fifth family is one edit in
one place and the compiler insists on it. That guard was checked by mutation in
both directions before the enumerator was written: a fifth field added to
`CreatureState` reddens the build, and a family removed from the literal reddens
it too.

**And the fifth family arrived, so the guard is a measurement rather than a
prediction.** `speedModifiers` was declared on `CreatureState`, `grantsOf`
stopped compiling naming the property it lacked, and that one line was the
whole of it: `releaseCasting`, `releaseOnTarget`, `releaseGrants`,
`expireEffects` and `holdsNothingOf` all needed nothing. What the fourth family
cost was five edits and the risk of three; what the fifth cost was one, and the
compiler would not let it be none.

**And the sixth arrived the same way**, which is what turns one measurement
into a habit: `attackRiders` was declared for SRD Divine Favor and Hunter's
Mark, `grantsOf` stopped compiling naming it, and the same five walks needed
nothing again. See "A Rider On Later Attacks Is The Sixth Sourced Grant".

**`initiativeBonuses` matches the shape and is excluded**, which is the one
written exemption. Creation derives it from the character's own feats; no
casting hangs it, and no casting, deadline or dispel takes it away. It was in
none of the five walks, and putting it in one would end a feat the rules never
ended.

**Four things it deliberately does not do.** It does not merge the arrays —
they are read by different rules, and a mode is not a bonus. It does not
touch `rollModifierKey`: that two-part identity decides whether a **re-grant**
replaces or stacks, and it is not what an *ending* matches on, because Beacon of
Hope's two modifiers are one casting's grant and one deadline takes both. It
does not enumerate `scheduledDamage`, because a hit still owed is the casting's
debt rather than something the casting is doing to the creature — the reading
that keeps a creature Insect Plague merely damaged off `spellOn`'s answer.
And it does not enumerate conditions, which are a different link with their own
instances and implications; `holdsNothingOf` asks them separately.

**The answer is sorted and deduplicated**, so the family order is unobservable
and serialised state cannot depend on it — and `withoutGrants` returns the
creature *by reference* when nothing matched, which `releaseCasting` reads to
decide whether a derived pass touched anybody at all.

**The evidence that it is one enumerator and not four spelled alike is a
mutation, and it is the evidence `defendingModes` was held to.** Stopping the
shared walk from removing anything reddens the bonuses suite, the
granted-defences suite, the roll-modifier suite and the Armour Class suite
together — and `golden-log-2.json`, which is what says the fold itself runs
through here. Dropping one *family* reddens only that family's suite, which is
the weaker claim and is why the shared walk is the one to break.

**`holdsNothingOf` is the site the frozen logs could not have protected.** It
reads the four in reverse, to decide whether a casting still owns anything on a
creature; an enumerator reporting a grant the release skipped would keep a
finished casting **on** that creature, which is a wrong answer to Dispel Magic
and appears in no log either fixture contains. The set it reports is exactly
the union of the four the five sites read — nothing added, `scheduledDamage`
and the conditions still outside it.

**It used to be `expireEffects` that asked, and IE-053 moved the question.**
That file shrank a casting's list of who it was on when a condition lapsed, in
its condition branch and in no other — so the `grants` branch beside it left a
stale name behind. Both shrinks are gone: `spellOn` asks `holdsNothingOf` at
every read, so releasing the last grant takes the casting off the creature and
no expiry branch has to remember to say so. See "Who a casting is on is two
facts" in `docs/design/space-and-areas.md`.

### What expiry did not buy

Two things expiry is adjacent to and does **not** implement. Both were refused
before on the grounds that time was not modelled; time is modelled now, and
they are still not done, for different reasons:

- **Casting times of 1 minute or more were refused, and the clock was never
  the blocker — which is why the clock alone did not fix it.** SRD requires
  the caster to take the Magic action on *each* turn of the casting and
  maintain Concentration throughout, and the slot is expended only on
  completion. A timer can say when something stops; it cannot say whether the
  caster kept working at it. What the two-event casting supplied was the other
  half — a process with an identity, a Concentration on it, and a settlement
  the clock gates — and the per-turn obligation is one field on that process
  plus the command that stamps it, so **both halves are built now**. See "A
  Casting Of A Minute Or More Runs On The Clock".
- **A rest still cannot be resumed.** SRD lets you pick a Long Rest back up for
  one extra hour per interruption. That needs a rest that survives its own
  interruption and accumulates required time, which is a change to how a rest
  ends, not a deadline on an effect. Beginning a fresh rest works.

Two smaller gaps in the same area, stated so nobody assumes otherwise:

- **A non-Concentration ongoing spell can be dismissed early now**, and the
  sentence that stood here — that it could not, because `endConcentration` is
  about Concentration — was the last place a casting was reached through its
  holder. `endOngoingSpell` names it by its id instead; see "A Caster Lets Go
  By Naming The Casting, Not By Holding It". What SRD's exceptions still cost
  is an action a dismissal does not spend, which is what keeps three spells
  blocked on that shape.
- **The log records the effect being scheduled, not expiring.** Expiry is
  derived, so a target's history shows the condition arriving and its deadline
  being set, but not the moment it lapsed — the same audit trade already made
  for Concentration, for the same reason.

## Turn Boundaries Collect What They Are Owed

SRD effects that repeat a save are everywhere — Hold Person, Dominate Person,
Ensnaring Strike — and they all have one shape: a moment, a save, and something
that happens when it lands. "At the end of each of its turns, the target
repeats the save, ending the spell on itself on a success."

**The effect carries its own hook.** A `RepeatSave` on the timer says which
boundary it fires on, whose turn, which ability, against what DC, what a
success does, and how the roll reads in the log. Everything the resolution
needs is on the effect rather than in the caller's head, because the point is
that nobody has to remember it: the turn knows what it owes.

**Raising is derived; rolling is commanded.** The reducer cannot roll —
randomness enters the log once, at the point of the roll — so `turn-advanced`
*raises* the saves the boundary owes into `pendingSaves`, and `resolveTurn`
rolls them. Raising is derived for the same reason a broken Concentration is:
nobody decides that a turn ended, so nobody should have to remember what
ending it costs.

**A pending save is a debt, not a leak.** This looks like the pending
Concentration save that had to be torn out, and is its opposite in the way that
matters:

| | The one that was wrong | This one |
|---|---|---|
| Where it lived | a return value | `GameState`, derived from `turn-advanced` |
| After a reload | gone | still there, because the fold rebuilds it |
| If forgotten | the spell silently stayed up | **the next turn is refused** |
| How to settle it later | there was no way — the command id was spent | `resolvePendingSaves` |

`resolveTurn` given a generator rolls immediately; given none it leaves the
debt in state and then refuses to advance again until it is paid. Forgetting
stops the game rather than quietly dropping a rule, which is the only version
of "optional" that is honest here.

**One boundary raises one save.** Pendings are keyed by effect *and* turn, so
folding the log twice raises it once, and the next turn raises it again — which
is what "repeats the save" means. An effect that ends first takes its hook and
any outstanding debt with it, so nothing waits on a save for a spell that is
already over.

**And a creature who leaves takes its timers with it.** `pendingSaves` was the
one engine debt of nine with no leaving-creature handling —
`settleHoldsInvolving` closes a held attack and a declared move, and
`dropOrphanedAreaEffects` and `dropStrandedDamage` cover theirs. A Paralyzed
goblin removed mid-fight left its Hold Person timer standing, and
`dropOrphanedSaves` drops a save only when its *timer* is gone: so the debt
survived, `resolvePendingSaves` refused `unknown_creature`, `resolveTurn`
refused `saves_pending`, and **the fight could never advance again**. The
reducer's `creature-removed` now drops every timer that ends something *on*
that creature, and only that creature's — a Hold Person holding two is not both
of them being freed, which is the distinction the casting id was built for,
applied to the target. A **casting's** timer is untouched, because SRD does not
end a Grease because somebody walked out of it. Nothing is written for any of
it: expiry is derived, and nobody decides that a condition on a creature who
has left the game has stopped.

**A success ends the effect where the hook says.** `end-on-target` is Hold
Person's "ending the spell **on itself**": that creature is freed, the casting
carries on for anyone else it caught, and the caster keeps concentrating
because the spell is still doing something. `end-casting` is for effects that
end outright. Either way, other targets, independent effects and the caster's
Concentration are untouched.

One bug this design caught in itself: releasing an effect on one target looked
up its timer by rebuilding a key from the first doomed condition instance — and
`doomed` includes the conditions the effect *implied*, which sort ahead of it
(`incapacitated:...` before `paralyzed:...`). The lookup pointed at the wrong
timer, left the real one running, and the hook fired again on a spell that had
ended. Filtering the timers rather than guessing a key is what fixed it.


### The Order Can Grow, And The Counters Are Relative

`turnCounts` is what every turn-anchored deadline is resolved against — `begun
+ 1` for "the start of your next turn", `ended + 1` or `+ 2` for its end — and
those counters are kept in **exact step** with `combat.order` by every
operation that changes either. The order used to only ever shrink: it was set
by `combat-started` and thinned by `combatant-removed`, so the agreement held
by construction.

`joinCombat` grows it, and that is the first operation that changes the order's
*length* mid-round. What makes it safe is that the counters are read
**relatively** and never against the round: what has to hold is `begun ===
ended` for everybody who is not mid-turn, and one more for whoever is. A
creature that has just walked in has taken no turns, so it arrives at zero and
takes its first turn when the order reaches it. Nothing that was already
anchored on it can exist, because `resolveDuration` refuses `not_in_combat`
for an anchor the fight does not hold — which is the request `joinCombat` was
built to satisfy.

The clock does not move: `round`, `turnsTaken` and `elapsed` are untouched,
because nobody's turn ended. The full account of the insertion, including what
happens to `turnIndex`, is in `docs/design/space-and-areas.md` under "A
Creature Can Join A Fight Already Under Way".
