# Rolls, modifiers, dice, damage, and reaction windows

Named modifiers on every D20 Test, advantage as a property of a roll, individually addressable dice, typed damage components, and the five reaction windows. **Read this before changing the D20 pipeline, damage application, or reactions.**

> **Authority.** This document is authoritative for its subject. It was
> extracted verbatim from `CLAUDE.md` when that file became the
> constitution and router; the sentences below are the repository's own
> reasoning, unchanged. `docs/IMPOSSIBILITY_ENGINE_DOCTRINE.md` outranks it,
> and `CLAUDE.md` outranks it on anything it still states directly.

---
## Dice Are Individually Addressable

Many rules act on a single die rather than a total, so `DieRoll` records what a
die showed (`rolled`), what it counts as (`value`), where it came from
(`origin`), what became of it (`disposition`), and which effect touched it.
Nothing collapses to a bare number before the rules have had their say.

The SRD has three distinct shapes here, and they are modelled separately
because they compose differently:

| Shape | Rule | Built-in |
|---|---|---|
| Substitute a value | Great Weapon Fighting: 1 or 2 counts as 3 | `treatLowRollsAs` |
| Add a die on a trigger | Sorcerous Burst: an 8 adds a d8, capped at the spellcasting modifier | `explodeOnMax` |
| Reroll chosen dice | Empowered Spell: reroll up to Cha modifier dice | `rerollDice` |

Rerolls are applied afterwards and take explicit indices, because the rules
that use them let the *player* choose which dice — not a predicate the engine
matches. Rerolled dice stay in the record marked `rerolled`, so the log shows
what was given up.

Two behaviours worth not breaking: a bonus die can itself trigger another (the
cap is what terminates it), and triggers read `rolled`, never the substituted
`value` — otherwise substituting a 1 up to a maximum would fire an explosion
that never happened.

## Modifiers Are Named, On Every D20 Test

`Bonus` (in `bonuses.ts`, shared because `attack.ts` imports `checks.ts`)
carries a `source`, so a log can say *why* a number was what it was rather than
presenting an unexplained total. Flat bonuses fold into the d20's own modifier;
dice bonuses are rolled separately and added, which keeps the natural-20 and
natural-1 rules reading the die rather than a total Bless has inflated.

Advantage is attributed the same way, via `ModeSource`. Because advantage
cancels rather than stacks, `modeSources` records **every** source including
ones that cancelled — so a normal-looking roll can still explain itself
("Boots of Elvenkind vs Plate Armor").

**There is a real window after a roll lands and before its outcome settles**,
and three distinct effects fill it. All are Reactions, usually taken by someone
*other* than the roller, which is why every one carries a source.

| Effect | Shape | API |
|---|---|---|
| Bardic Inspiration | **Add** a rolled die, after a failure | `interveneAfterRoll` |
| Cutting Words | **Subtract** one, after a success — and it applies to **damage rolls** too | `interveneAfterRoll` / `reduceDamage` |
| Indomitable | **Reroll** the save entirely, "you must use the new roll" | `rerollTest` |

The first two are one mechanism with a sign, so they share a function — Bend
Luck pushes either way, which settles the argument for a `direction` parameter
over two functions.

`rerollTest` is **not** take-the-better-of-two: a reroll that comes up worse
stands, because that is what "you must use the new roll" means. The superseded
roll is kept on the result so the log still shows what was given up.

`reduceDamage` takes its amount off the **total**, never off a component: a
reduction is not damage of any type, and subtracting it from the slashing half
of a flaming sword would give a fire-immune target the wrong answer.

None of these check whether the test succeeded or failed. Bardic Inspiration
requires a failure and Cutting Words a success, but those conditions belong to
those features, not to the mechanism.

**An Armour Class is something an effect can push on.** `BonusApplies` covers
attacks, saves and ability checks — all rolls — and now `ac`, which is not a
roll but a number rolls are measured *against*. It is in the same union rather
than a mechanism of its own because the SRD writes it in the same sentence
shape: Shield of Faith's "+2 bonus to AC" beside Bless's "+1d4 to the attack
roll". Only the flat half reaches an Armour Class; a standing number has no
moment at which a die could be thrown for it, and no SRD spell asks for one.

`armorClassOf(state, id)` is the reader. `armorClass(sheet)` still answers for
a creature nobody has cast anything on, and is what it falls back to. Cover
stays outside both: it is a fact about one attacker's line to one target, not
about the target, so the attack that reads it adds it.

The engine never infers which bonuses apply. Whether Archery or Boots of
Elvenkind is in play is a question about feats and inventory, which the engine
does not model; the layer that knows passes them in, and the engine applies
them correctly.

## Advantage Is A Property Of A Roll, Not Of A Creature

`combineRollModes` has settled a list of modes correctly since the day it was
written, and `ModeSource` has attributed each one. What sat between them was
nothing: a mode reached a roll through a hard-coded reader that knew **one
question** — `standingSaveModes` could answer about a save, `standingSkillModes`
about a skill check, `standingInitiativeModes` about Initiative, and
`attackedWithDisadvantage` about a weapon attack. Four readers, four grant
kinds, and no way for a fifth question to be asked at all. So the twenty-odd
SRD spells that grant a standing Advantage or Disadvantage had nowhere to be
written down, and Blur — "any creature has Disadvantage on attack rolls
**against you**" — could not be said in the vocabulary even in principle.

`roll-modifiers.ts` is one question asked once:

> **Does this source modify THIS roll?**

Four fields answer it, all closed unions naming rules the engine already
resolves. There is no expression, no callback and no string to interpret; a
definition that cannot be said in this vocabulary is a shape that has not been
built, which is the honest answer and what the coverage tables are for.

| | |
|---|---|
| `roll` | `attack`, `ability-check`, `saving-throw`, `initiative`, `death-save` |
| `relation` | `roller`, or `against-holder` |
| `ability` | narrows a check or a save; absent means the whole family |
| `skill` | narrows a check; absent means the whole family |

**`relation` is the bit that was missing, and it is one bit wide.** These are
different rules about the same creature, and before this the second could only
be expressed as a grant kind of its own:

| | |
|---|---|
| `roller` | "The affected creature has Disadvantage on attack rolls." |
| `against-holder` | "Attack rolls against the affected creature have Advantage." |

**`against-holder` is legal only on an attack**, and that is a rule rather than
a simplification: an attack roll is the one D20 Test the engine records a
second participant for. A saving throw knows its DC and not who set it — the
gap this file has recorded since Countercharm — so an `against-holder` selector
on a save would match every save ever rolled. The validator refuses it.

**Two roll families exist because the SRD insists on them.** `initiative` is
not `ability-check`, because Feral Instinct grants Advantage on "Initiative
rolls" and does not help a Barbarian pick a lock. `death-save` is not
`saving-throw`, because a death save is "not tied to an ability score" and an
ability-keyed grant would either miss every one or catch every save in the
game. Beacon of Hope names both in one sentence and means two different things.

**There is deliberately no member for "D20 Tests".** Three SRD spells write the
phrase — Foresight, Resurrection, Ray of Enfeeblement — and every one is
blocked on something else: a casting time of a minute, a penalty linked to no
casting, a repeat save that ends a spell hanging no condition. A vocabulary
member no definition can use is a guess, and the phrase does not even mean "all
five of these": a death save is a D20 Test, and Initiative is one already
counted as a check.

### One vocabulary, two lifetimes

A class feature's grant and a spell's grant are the same mechanic and differ
only in how long they live, so they share the selector and the predicate:

| | Stored where | Ends how |
|---|---|---|
| A feature, or an action anybody can take | nowhere — derived from the world on every read | when its own requirement stops holding |
| A spell's grant | `CreatureState.rollModifiers`, by `roll-modifier-granted` | `releaseCasting` / `releaseOnTarget`, through the casting in its `source` |

`StandingGrant` lost four members and gained one, which is what made Dodge
expressible as a mode rather than as a mechanism. `rollModesFor` is the one
gatherer: it reads the roller's standing effects, the *target's* standing
effects, and both creatures' durable grants, deduplicates by source, and hands
the list to `combineRollModes` — which is still the only thing in the engine
that decides an outcome. No subsystem rolls its own cancellation.

**Both ends of an attack are asked, which removed a fork nothing was comparing.**
`resolveAttack` read the defender's standing effects and the spell attack
inside `resolveEffects` read nothing about the defender at all, so a **Dodging
creature was easier to hit with a Fire Bolt than with a club** — silently,
because each path was correct on its own terms. SRD Dodge says "any attack roll
made against you"; it does not say "with a weapon".

**And the two paths now share the gatherer rather than a shape.** They were
identical blocks in one file, which is how the fork happened the first time and
is worse once the command layer is a directory: the copies sit in
`commands/attacks.ts` and `commands/spell-resolution.ts`, where neither
author sees the other. `defendingModes` in `commands/rolls.ts` is the one
function both call — a mutation that empties it fails a weapon-attack test
*and* a spell-attack test, which is the evidence that it is one gatherer and
not two spelled alike.

**A durable grant's identity is the source *and the rolls it reaches*.**
`bonus-applied` and `armor-class-granted` both key on the source alone, which
is right for them and wrong here: Beacon of Hope grants "Advantage on Wisdom
saving throws **and Death Saving Throws**" — one casting, one source string,
two modifiers. Keyed by source, the second silently replaced the first and the
spell lost half its own sentence between the definition and the state.
`rollModifierKey` is that identity; re-granting the *same* rolls from the same
casting still replaces rather than stacks, which is what those two events were
protecting.

**A mode is not a bonus, and folding them together would have made Blur a
negative number.** A bonus is arithmetic that adds and stacks; a mode is
presence that cancels, so three Advantages against one Disadvantage is a
*normal* roll and no arithmetic says that. And `BonusApplies` has no relation
axis at all.

### What this deliberately does not reach

Each is a named missing piece with the spells that want it, rather than a
vague edge:

| Missing | Spells |
|---|---|
| An ability **chosen at the casting** | Hex, Enhance Ability, Bestow Curse |
| A filter on the *attacker's* creature type | Protection from Evil and Good, Dispel Evil and Good, Magic Circle |
| A sight clause read from the **attacker's** side | Faerie Fire |
| The effect's *source* as a participant — "against **you**", meaning the caster | Bestow Curse |
| A grant conditioned on proximity, or carried by an aura | Holy Aura, Conjure Animals |
| A save keyed to a named **condition** rather than an ability | Protection from Poison |
| "D20 Tests", and "Strength-based D20 Tests" | Foresight, Resurrection, Ray of Enfeeblement |

**A one-shot mode is a different mechanic, not a short-lived one.** Guiding
Bolt's "the **next** attack roll against it", Vicious Mockery's "the next
attack roll it makes" and Ray of Enfeeblement's success branch all need a
modifier that is **consumed** by the roll it changes. Nothing here consumes
anything — a durable grant applies until its casting ends — so those stay in
`unmodelled` where they were.

## Damage Is Typed Components, Not A Number

An attack produces a list of `DamageComponent`s, each with its own type and a
named source. Flame Tongue deals "an extra 2d6 Fire damage" on top of a sword's
slashing, and Resistance applies *per type* — collapsing that to one number
gives a fire-immune target completely the wrong answer, and mixed-type damage
is common play, not an edge case.

`applyDamage` sums each type before applying defences, never per component:
halving 5 and 5 separately gives 4, but halving their sum gives 5. Rounding
down repeatedly silently undercounts.

Modifiers are `Bonus` values carrying a `source`, so the log can say why a
number was what it was rather than presenting an unexplained total:

| Kind | Example |
|---|---|
| Attack only | Archery (+2 to attack rolls with Ranged weapons) |
| Damage only | Bracers of Archery, Dueling |
| Both | a +1/+2/+3 magic weapon |
| Dice, not flat | Bless (+1d4 to the attack roll) |
| Different damage type | Flame Tongue (+2d6 Fire) |

On a critical hit **every damage die doubles — including extra damage dice**
("If the attack involves other damage dice, such as from the Rogue's Sneak
Attack feature, you also roll those dice twice") — but **flat bonuses never
do**. A +1 weapon adds 1 on a crit, not 2.

## A Reaction Is A Window, Not A Trigger

Eight class features spent eleven batches saying *"needs an interrupt the
engine does not have"* while the three pieces of arithmetic they wanted —
`reduceDamage`, `interveneAfterRoll`, `rerollTest` — sat written, correct and
reachable from no command at all. That is the tenth instance in this file of a
pure function nothing calls, and the largest.

What was missing was not arithmetic and not a trigger language. **It was two
instants**: a damage roll that has been made and not applied, and a D20 Test
whose total is known and whose effects have not occurred.

**The vocabulary is five named windows and it is shared with spells.**
`ReactionWindow` in `reactions.ts` is the whole of it, and it is a table rather
than a framework because every member is a point in a resolution the engine
already performs:

| Window | Pinned before it opens | Still unresolved | Who names it |
|---|---|---|---|
| `hit-by-attack` | the attack roll hit; the Armour Class it beat | the damage roll | *Shield*; seven monsters' Parry |
| `damage-rolled` | the damage, by type | what the target takes | Uncanny Dodge, Deflect Attacks, Cutting Words |
| `damaged-by-creature` | **everything** | nothing | *Hellish Rebuke*, Retaliation |
| `test-rolled` | the total, and whether it beat the DC | the effects of that outcome | Indomitable, Dark One's Own Luck, Peerless Skill, Cutting Words |
| `casting-a-spell` | the casting, the action, the Concentration dropped | the slot, the effects | *Counterspell* |

**`damaged-by-creature` is in both columns**, and that overlap is the evidence
the vocabulary is shared rather than merely tidy: *Hellish Rebuke* and
Retaliation answer the same instant under the same rule, and `damageWindowOpen`
is the one function that decides whether it is still open. Two clients, one
reading.

Class features therefore did **not** reuse the spell machinery — a spell
Reaction is a *casting*, with a definition, a route, a slot and an action, and
a feature has none of those. Both sit on the window instead.

### The window opens only when somebody can answer it

A window that opened on every damage roll would make every swing of every
sword a two-command negotiation, and `scenario.test.ts` and the frozen
`golden-log.json` would both have had to change. With no eligible reactor the
damage is dealt in the same breath it was rolled, the same events come out, and
no caller learns a window exists.

That is not an optimisation. It is the rule `pendingMove` has followed since
Opportunity Attacks landed — **a move that provokes nobody simply happens** —
and `pendingMove.provoked` was already the offer list this batch generalised
from. Three instances of "a finite list of creatures, answered one at a time,
with the thing they hold up happening when the last one answers" is evidence;
one would have been a guess.

### An offer is a (reactor, feature) pair, not a reactor

One creature can hold two features in one window. A Rogue 5 / Monk 3 is
offered Uncanny Dodge *and* Deflect Attacks against the same blow, and a
Fighter / Fiend Warlock may reroll a failed save with Indomitable and then add
Dark One's Own Luck to the new roll — the SRD forbids neither. The reducer
first matched an answer by **reactor**, so the first answer consumed both
offers, and a settlement that recorded one pass per offer then found the
second already gone and threw. A legal build crashed `settleDamage` and wrote
a `test-settled` batch the fold refused for ever.

So an answer names its feature and settles exactly that offer; a bare pass
(no feature) lets every offer the reactor holds lapse, which is what declining
the window means. Every single-class fixture has one feature per window, which
is how the mismatch survived a whole suite — **the multiclass is the fixture
that discriminates**, the same lesson as class level against character level.

### The window and the action-economy cost are two facts

Four of the eight features here spend a Reaction and four spend none at all.
Indomitable, Dark One's Own Luck and Peerless Skill are bare permissions
limited by a pool; the SRD asks for no Reaction and never mentions one. This is
the commonest mistake about this corner of the rules, and folding the two
together would have made half the batch wrong. `costsReaction` is a per-feature
field for that reason.

### Settlement is its own command, and that is the opposite of `pendingMove`

`takeDamageReaction` answers an offer; it does not deal the damage.
`settleDamage` does, always, and records every offer still outstanding as
passed. Four things follow, and they are why the choice went the other way from
the move:

- **One place computes the number.** The damage is arithmetic the reactions
  changed, so exactly one function applies the reductions and the defences.
- **"Nobody reacts" has a command.** The engine will not wait forever for a
  decision nobody is going to make, and it will not take the decision either.
- **A departing bystander cannot wedge the fight.** Their offer stays in the
  record and the settlement records it as passed. Only a departing *target*
  closes the window, with the damage undealt — the same honest record
  `settleHoldsInvolving` already writes for a held attack.
- **The turn has one thing to refuse on.**

### Ordering among two reactors is the caller's, and the log records it

SRD writes no rule for sequencing two voluntary Reactions, and the order is
observable: halving a total and then subtracting three is not subtracting three
and then halving. So the engine does not choose — **whoever answers first is
applied first** — and each `damage-reaction-answered` carries its own
reduction, so the log shows the sequence rather than a normalised total. That
is the smallest deterministic protocol that invents no rule.

### A reduction is an adjustment, and the SRD orders it

"Modifiers to damage are applied in the following order: adjustments such as
bonuses, penalties, **or multipliers** are applied first; Resistance is applied
second." So Uncanny Dodge's halving and Deflect Attacks' 1d10 both land
*before* Resistance, and a Rogue with Resistance who dodges takes a quarter.
The order is observable and a mutation that reversed it **survived the whole
suite**, because the fixture's Rogue resisted nothing. A test for an order of
application needs a target that has both.

What the SRD never says is which damage *type* a reduction comes off when an
attack deals two, because every worked example it prints has one. Uncanny Dodge
halves "the attack's damage" — the total, which `applyDamage` cannot take as
one number because Resistance is per type. So the engine chooses, once, in
`adjustmentsFor`: **largest raw amount first, ties by type name**. A choice
rather than a rule, which is why it is stated rather than buried.

### The two windows this batch added, and what they hold

`pendingDamage` holds the typed components as rolled, who dealt it, whether an
attack roll caused it, the reductions in the order they were taken, and the
offers still outstanding. `pendingTest` holds the resolved `D20TestResult` and
its offers. Both are in `GameState`, derived from events, and the turn refuses
to advance past either — the `pendingSaves` discipline, not the pending
Concentration save that had to be torn out.

**Closing a test window changes nothing**, deliberately. A standalone check or
save is a number the engine owns and a consequence the table owns; the window
existed so the number could be pushed. Same honest answer as
`SpellCheck.onSuccess: 'none'`.

**`resolveTest` is the command a DM always needed.** `rollAbilityCheck` and
`rollSavingThrow` were complete and correct and reachable only from inside a
spell's own resolution. A DM asks for a save constantly and the engine had no
way to be asked.

### What the window is *not*, and where it stops

- **Spell damage does not open one.** A spell rolls its damage once for every
  target it caught, so holding one target's share open would mean holding the
  whole casting open per target — a different debt. Cutting Words answers a
  sword and not a *Fireball*, and that is stated rather than silently true.
- **A spell's saving throws are atomic**, so nothing can be pushed inside
  `resolveSpell`. That is what blocks Countercharm, along with the fact that
  **nothing records what a save was against**.
- **A feature carries one grant**, which is what blocks Disciplined Survivor's
  reroll: the feature already grants six save proficiencies, and its second
  sentence is Indomitable's shape exactly.
- **`reactionOpportunities` transfers no authority.** It reports what is open
  and what it would cost; taking it goes through the command that checks all of
  it again, and the query re-checks affordability rather than trusting an offer
  in state that may have gone stale.
- **No nesting.** A Reaction cannot be answered by another Reaction: there is
  one open window at a time and the reducer refuses a second. No currently
  implemented SRD mechanic needs otherwise — the nearest, Counterspell on
  Counterspell, was already refused deliberately and stays refused.
- **Two windows open on the actor's opt-in; three open on detection.**
  `damage-rolled`, `test-rolled` and `damaged-by-creature` open because the
  engine found somebody who could answer. `hit-by-attack` and
  `casting-a-spell` open only when the *attacker* holds the attack or the
  *caster* holds the casting — so whether a Rogue gets their *Shield* depends
  on the other side's command. The engine holds every fact needed to say
  "somebody could answer this" before the swing; a pre-flight query is the
  consistent shape, and auto-holding would change the atomic path.
- **"Can answer" is not "would".** Cutting Words answers any creature's
  damage roll within 60 feet, allies included, so a Lore Bard with a die left
  turns every party hit into a two-command negotiation. That is the SRD, not a
  bug; withholding the offer by side would invent a rule. The tool surface is
  where "the Bard is not cutting the Fighter" belongs.
- **Spell attacks do not open `damage-rolled` either**, and the reason given
  above covers a *Fireball* but not a *Fire Bolt*: SRD Uncanny Dodge answers
  any attack roll, and a single-target spell attack rolls per target already.
  The same seam blocks Indomitable against a save a spell forced, a
  Concentration save or a repeat save: `resolveEffects` resolves every target
  in one breath, so `test-rolled` opens only from `resolveTest`. Both are one
  missing thing — **a casting's resolution suspended per target** — and
  Indomitable is executed today only for the saves a DM calls for directly.

### The duplicate check comes first, and this batch sprang the trap a fourth time

The `damage_pending` and `test_pending` guards were added to `castOrRelease`
above the replay check, beside a `saves_pending` guard that had sat there since
turn hooks landed. None is opened by a casting's own first run, which is why it
was quieter than the three before it, and it was the same trap: a retry that
arrives after somebody else held a roll open, or after the next boundary
raised a save, was told about the world instead of that its command had
landed. `unsettledRefusal` is now the one function that names those debts,
`castOrRelease` skips it for a replayed command, and `activateSpell` reads it
too — an activation is a Magic action into the world exactly as a casting is,
and it had none of the casting's guards.
