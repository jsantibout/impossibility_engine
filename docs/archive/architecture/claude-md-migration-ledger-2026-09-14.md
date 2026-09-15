# Citation migration ledger — CLAUDE.md to its successor documents

Every citation that named `CLAUDE.md` and quoted a run of eight characters or
more, with the document that now contains that run. Produced mechanically from
the pre-migration file; the guard in `blocked-on.test.ts` is what proves the
result.

| # | shape | quoted run | successor document | section it came from |
|---|---|---|---|---|
| 1 | `` | "Transitions Are Engine-Owned Batches" | `docs/design/event-log.md` | Transitions Are Engine-Owned Batches |
| 2 | `` | "Durations Are Two Different Things" | `docs/design/time-and-turns.md` | Durations Are Two Different Things |
| 3 | `` | "Raising is derived; rolling is commanded ... `turn-advanced` *raises* the saves the bounda" | `docs/design/time-and-turns.md` | Turn Boundaries Collect What They Are Owed |
| 4 | `` | "Lifecycle, and the one place it ends" | `docs/design/casting.md` | A Casting Is History; What It Left Behind Is State |
| 5 | `` | "nothing records what a save was against" | `docs/design/rolls-and-damage.md` | A Reaction Is A Window, Not A Trigger |
| 6 | `` | "covers attacks, saves and ability checks — all rolls" | `docs/design/rolls-and-damage.md` | Modifiers Are Named, On Every D20 Test |
| 7 | `` | "A filter on the *attacker’s* creature type | Protection from Evil and Good, Dispel Evil an" | `docs/design/rolls-and-damage.md` | Advantage Is A Property Of A Roll, Not Of A Creature |
| 8 | `` | "Designating creatures unaffected is a choice, and never allegiance ... it is **explicit**," | `docs/design/space-and-areas.md` | An Area Can Be Carried, And Then Its Origin Is Not A Point |
| 9 | `` | "A stat block prints damage types and conditions in one run ... one damage type and two con" | `docs/design/characters-and-equipment.md` | Monsters State Their Numbers; Characters Derive Them |
| 10 | `` | "the same storage and the same sentence shape" | `docs/design/spell-definitions.md` | Spells The Engine Executes |
| 11 | `` | "**A creature’s defences are state, and damage reads them**" | `docs/design/spell-definitions.md` | Spells The Engine Executes |
| 12 | `` | "**Reduced ability scores and a reduced hit point maximum are not restored**, because neith" | `docs/design/time-and-turns.md` | Rests And The Clock |
| 13 | `` | "Which spells this reaches" | `docs/design/casting.md` | A Casting Can Hold A Point |
| 14 | `` | "A stat block created mid-fight | Unseen Servant, Arcane Hand, Phantom Steed, Summon Dragon" | `docs/design/casting.md` | A Casting Can Hold A Point |
| 15 | `` | "the four Conjures" | `docs/design/casting.md` | A Casting Can Hold A Point; Spells The Engine Executes |
| 16 | `` | "**Movement modes are refused outright.** Fly, Climb and Swim have no reader — no rule in t" | `docs/design/spell-definitions.md` | Spells The Engine Executes |
| 17 | `` | "Halving is presence rather than count — the reading Resistance and Advantage already take." | `docs/design/spell-definitions.md` | Spells The Engine Executes |
| 18 | `` | "A standing effect derived from where a creature is standing | Spirit Guardians’ halved Spe" | `docs/design/casting.md` | A Casting Can Hold A Point |
| 19 | `` | "**Exhaustion is a flat -2 per level, not Disadvantage**" | `docs/rules/srd-policy.md` | Rules That Are Easy To Get Wrong |
| 20 | `` | "hit points alone will not raise the dead — `healCreature` refuses a corpse, and the refusa" | `docs/design/spell-definitions.md` | Spells The Engine Executes |
| 21 | `` | "a Temporary Hit Point payout that repeats each turn (Heroism)" | `PROGRESS.md` | Known Pending Work |
| 22 | `` | "Cloudkill and Incendiary Cloud, blocked on automatic turn-start drift" | `docs/design/casting.md` | A Casting Can Hold A Point |
| 23 | `` | "A one-shot mode is a different mechanic, not a short-lived one." | `docs/design/rolls-and-damage.md` | Advantage Is A Property Of A Roll, Not Of A Creature |
| 24 | `` | "the **next** attack roll against it" | `docs/design/rolls-and-damage.md` | Advantage Is A Property Of A Roll, Not Of A Creature |
| 25 | `` | "the next attack roll it makes" | `docs/design/rolls-and-damage.md` | Advantage Is A Property Of A Roll, Not Of A Creature |
| 26 | `` | "**There is deliberately no member for “D20 Tests”.** Three SRD spells write the phrase — F" | `docs/design/rolls-and-damage.md` | Advantage Is A Property Of A Roll, Not Of A Creature |
| 27 | `` | "Substitute a value | Great Weapon Fighting: 1 or 2 counts as 3 | `treatLowRollsAs`" | `docs/design/rolls-and-damage.md` | Dice Are Individually Addressable |
| 28 | `` | "Dice Are Individually Addressable" | `docs/design/rolls-and-damage.md` | Dice Are Individually Addressable |
| 29 | `` | "`reduceDamage` takes its amount off the **total**, never off a component" | `docs/design/rolls-and-damage.md` | Modifiers Are Named, On Every D20 Test |
| 30 | `` | "`BonusApplies` covers attacks, saves and ability checks — all rolls — and now `ac`" | `docs/design/rolls-and-damage.md` | Modifiers Are Named, On Every D20 Test |
| 31 | `` | "**In combat the clock is derived.** A round ends when the Initiative order wraps, and six " | `docs/design/time-and-turns.md` | Rests And The Clock |
| 32 | `` | "An ability **chosen at the casting** | Hex, Enhance Ability, Bestow Curse" | `docs/design/rolls-and-damage.md` | Advantage Is A Property Of A Roll, Not Of A Creature |
| 33 | `` | "Extra attacks inside the Attack action. The economy counts one Attack action, not the atta" | `docs/design/characters-and-equipment.md` | Progression, Creation And Execution Are Three Jobs |
| 34 | `` | "**A spell has one effect list applied to every target**, so nothing yet expresses “each cr" | `docs/design/spell-definitions.md` | Spells The Engine Executes |
| 35 | `` | "a rider on every weapon attack (Divine Favor, Hex, Hunter’s Mark)" | `PROGRESS.md` | Known Pending Work |
| 36 | `` | "**Cantrips scale by caster level and levelled spells by slot**, and they are separate fiel" | `docs/design/spell-definitions.md` | Spells The Engine Executes |
| 37 | `` | "`duration.ts` has two types" | `docs/design/time-and-turns.md` | Durations Are Two Different Things |
| 38 | `` | "A span of time" | `docs/design/time-and-turns.md` | Durations Are Two Different Things |
| 39 | `` | "A moment in the turn order" | `docs/design/time-and-turns.md` | Durations Are Two Different Things |
| 40 | `` | "**Expiry is derived, like Concentration breaking** ... The log records the effect being sc" | `docs/design/time-and-turns.md` | Durations Are Two Different Things |
| 41 | `` | "In combat the obligation is a state machine on the caster’s own turns, and it is built." | `docs/design/casting.md` | A Casting Of A Minute Or More Runs On The Clock |
| 42 | `` | "A sight clause read from the **attacker’s** side | Faerie Fire" | `docs/design/rolls-and-damage.md` | Advantage Is A Property Of A Roll, Not Of A Creature |
| 43 | `` | "Nothing checks that two hands are free, either." | `docs/design/characters-and-equipment.md` | Owning Is Not Wearing |
| 44 | `` | "The range then belongs to the point rather than to each target" | `docs/design/spell-definitions.md` | Spells The Engine Executes |
| 45 | `` | "while in the webs" | `docs/design/space-and-areas.md` | A Persistent Area Catches You At A Moment The Spell Names |
| 46 | `` | "a condition that ends when its holder walks out of an area has no shape here at all" | `docs/design/space-and-areas.md` | A Persistent Area Catches You At A Moment The Spell Names |
| 47 | `` | "**No wall or multi-area spells.** All six SRD shapes are castable, but a spell whose area " | `docs/design/spell-definitions.md` | Spells The Engine Executes |
| 48 | `` | "Walls and barriers as obstacles | Arcane Eye, Passwall, Wall of Stone, Prismatic Wall" | `docs/design/casting.md` | A Casting Can Hold A Point |
| 49 | `` | "Cover and line of sight stay declared, not ray-cast ... that is where a rules engine becom" | `docs/design/space-and-areas.md` | Positioning: Coordinates, Authored But Never Defaulted |
| 50 | `` | "It is not a general interruption framework — there is **no stack**, and a Counterspell ans" | `docs/design/casting.md` | A Casting Can Be Interrupted |
| 51 | `` | "Two windows open on the actor’s opt-in ... `hit-by-attack` and `casting-a-spell` open only" | `docs/design/rolls-and-damage.md` | A Reaction Is A Window, Not A Trigger |
| 52 | `` | "Transitions Are Engine-Owned Batches" | `docs/design/event-log.md` | Transitions Are Engine-Owned Batches |
| 53 | `` | "Dropping to 0 hit points makes a character Unconscious ... The command layer produces thes" | `docs/design/event-log.md` | Transitions Are Engine-Owned Batches |
| 54 | `` | "Death Ward, because the engine drops creatures to 0 itself" | `docs/design/spell-definitions.md` | Spells The Engine Executes |
| 55 | `` | "A destination *outside* the scene is different in kind ... there is one scene, so Plane Sh" | `docs/design/spell-definitions.md` | Spells The Engine Executes |
| 56 | `` | "the real fix is the doctrine’s multiple-scenes seam" | `docs/design/casting.md` | A Casting Can Hold A Point |
| 57 | `` | "Feather Fall | a creature falling | **falling, which is not modelled at all**" | `docs/design/casting.md` | Spell Slots Are Pools; A Casting Is A Thing With An Identity |
| 58 | `` | "forced movement passes `forced: true`" | `docs/design/space-and-areas.md` | Positioning: Coordinates, Authored But Never Defaulted |
| 59 | `` | "An activation that resolves an area at a point chosen now | Call Lightning, Storm of Venge" | `docs/design/casting.md` | A Casting Can Hold A Point |
| 60 | `` | "Pinned at the casting | ... **the caster — nobody else may act through it**" | `docs/design/casting.md` | A Casting Is History; What It Left Behind Is State |
| 61 | `` | "every one of those three prints an exception to it" | `docs/design/casting.md` | A Casting Is History; What It Left Behind Is State |
| 62 | `` | "Until dispelled" | `docs/design/casting.md` | A Casting Is History; What It Left Behind Is State; Spells The Engine Executes |
| 63 | `` | "A save keyed to a named **condition** rather than an ability | Protection from Poison" | `docs/design/rolls-and-damage.md` | Advantage Is A Property Of A Roll, Not Of A Creature |
| 64 | `` | "**A rest is a span, not a button**" | `docs/design/time-and-turns.md` | Rests And The Clock |
| 65 | `` | "Barkskin is deliberately *not* included: “an Armor Class of 17 if its AC is lower than tha" | `docs/design/spell-definitions.md` | A Definition Is Validated Data, And The SRD Is Its Oracle |
| 66 | `` | "The effect’s *source* as a participant — “against **you**”, meaning the caster | Bestow Cu" | `docs/design/rolls-and-damage.md` | Advantage Is A Property Of A Roll, Not Of A Creature |
| 67 | `` | "an outcome-scoped child effect (Ice Knife’s explosion, Hideous Laughter’s two conditions, " | `PROGRESS.md` | Known Pending Work |
| 68 | `` | "**Who may attempt it is derived from what the timer sits on** — an effect on a creature is" | `docs/design/spell-definitions.md` | Spells The Engine Executes |
| 69 | `` | "Ending a turn within 5 feet of a point, and a point rolled into a creature’s space | Flami" | `docs/design/casting.md` | A Casting Can Hold A Point |
| 70 | `` | "**Every one of the event types the union declares is now emitted by a command**" | `PROGRESS.md` | Known Pending Work |
| 71 | `` | "**The path.** Movement records where a move started and where it ended and nothing in betw" | `docs/design/space-and-areas.md` | A Persistent Area Catches You At A Moment The Spell Names |
| 72 | `` | "Distance travelled inside an area, which no move records | Spike Growth" | `docs/design/casting.md` | A Casting Can Hold A Point |
