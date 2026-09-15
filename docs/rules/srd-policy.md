# SRD interpretation policy, and parsing the book

The 2024 rules this engine gets right on purpose because they are easy to get wrong, and the discipline for parsing a third-party transcription of the book. **Read this before adjudicating a rule or touching `packages/srd/`.**

## Rules That Are Easy To Get Wrong

Checked against the SRD text, not recalled. Each has a test pinning it.

- **A Goblin Warrior is Fey, not Humanoid.** SRD 5.2.1: "Small Fey
  (Goblinoid)". Goblinoid is a subtype tag; the *type* changed in 2024, and it
  means Hold Person — "Choose a Humanoid" — cannot touch one. The scripted
  scenario cast it at goblins for three commits before the engine carried a
  creature type and could say so. Every 2014 instinct about who is a Humanoid
  is worth re-reading.
- **Advantage is presence, not arithmetic.** "A roll can't be affected by more
  than one Advantage, and Advantage and Disadvantage on the same roll cancel
  each other." Three advantages against one disadvantage is a *normal* roll.
  Counting sources and taking the difference silently favours whoever has more
  effects running.
- **Natural 20 and natural 1 are attack-roll rules.** They do not auto-succeed
  or auto-fail ability checks or saving throws — those are decided purely by
  total against DC. Death saves are their own separate exception.
- **2024 has no contests.** Opposed checks are gone; a grapple escape is a
  check against the grapple's escape DC. Do not port 2014 assumptions.
- **Armour replaces the base AC calculation**, it does not add to 10 + Dex.
- **Score, not modifier.** Two separate rules read an ability *score* against a
  threshold, and both are easy to implement against the modifier by mistake:
  the armour Strength requirement (Str 14 vs 15 share a +2) and the Heavy
  weapon property (Str/Dex 12 vs 13 share a +1).
- **A flat addend printed beside the dice is part of the damage.** Finger of
  Death is "7d8 + 30" and Disintegrate is "10d6 + 40". `DiceScaling` carried
  the number from the start and nothing on the damage path read it — the one
  caller of `scaledFlatFor` was Temporary Hit Points — so Finger of Death dealt
  7d8 for as long as it had existed, silently. A **minimum** is what catches
  this: 7d8 + 30 cannot come to less than 37, and it was dealing 32. The
  addend does not double on a critical, for the same reason no flat bonus does.
- **Critical hits double the dice, not the modifier.** "Roll the attack's
  damage dice twice, add them together, and add any relevant modifiers as
  normal."
- **Death saves are not tied to an ability score.** No modifier, no
  proficiency — the die stands alone. Natural 1 costs two failures; natural 20
  restores 1 hit point outright.
- **Massive Damage measures the remainder after temporary hit points.** The
  SRD's example: hit point maximum 12, currently 6, takes 18 — drops to 0 with
  12 remaining, which equals the maximum, so the character dies.
- **Initiative is an ability check**, so the Alert feat's Proficiency Bonus and
  a magic item's bonus apply. **Jack of All Trades does not**: 2024 requires
  "an ability check ... that **uses a skill proficiency you lack**", and
  Initiative uses no skill at all. Earlier guidance here said otherwise and had
  a test enshrining it; both were wrong, and 2014 is where the confusion comes
  from.
- **A monster's printed Initiative is authoritative** and often differs from
  its Dexterity — an Adult Red Dragon prints +12 against a +0 modifier. It
  lives in `stated.initiative`, so no caller constructs a compensating bonus.
- **Death saves are unmodifiable by ability, not unmodifiable full stop.**
  Beacon of Hope grants advantage on them explicitly, so `rollDeathSave` takes
  the same modes and bonuses as any other D20 Test and simply starts from zero.
  The natural 1 and 20 results read the *die*; an ordinary success reads the
  *total*.
- **Surprise is Disadvantage on the Initiative roll**, not a condition. The
  Surprised condition is 2014.
- **A Reaction refreshes at the start of your next turn**, not at the end of
  the round — a creature that spent one on an Opportunity Attack has none until
  its own turn comes round.
- **Prone is asymmetric.** "An attack roll against you has Advantage if the
  attacker is within 5 feet of you. **Otherwise, that attack roll has
  Disadvantage.**" A prone target is *harder* to hit at range — the second half
  is the half that gets dropped.
- **Automatic criticals are Paralyzed and Unconscious only.** Petrified and
  Stunned grant Advantage but not crits, which is an easy over-generalisation
  from "helpless target".
- **Exhaustion is a flat -2 per level, not Disadvantage** — so it stacks with
  advantage instead of being cancelled by it.
- **Boots of Elvenkind grant flat Advantage on Dexterity (Stealth) checks** in
  2024 — no condition about sound or movement. That qualifier is 2014.
- **Great Weapon Fighting substitutes, it does not reroll.** 2024: "treat any
  1 or 2 on a damage die as a 3." The reroll version is 2014. No extra dice are
  rolled, and the generator is not advanced.
- **One spell slot per turn, whatever the casting time.** 2024: "On a turn,
  you can expend only one spell slot to cast a spell." This replaced the 2014
  rule about Bonus Action spells limiting you to cantrips, and the two are not
  the same restriction — porting the old one forbids legal turns and permits
  illegal ones. Note *a* turn, not *your* turn: a Reaction spell cast on
  someone else's turn is a different turn from the one you cast Fireball on.
- **Concentration breaks the moment you start casting the next one.** "You
  lose Concentration on an effect the moment you start casting a spell that
  requires Concentration." The old spell is gone even if the new casting goes
  on to accomplish nothing — every target saves, the spell is Counterspelled.
  Ending the old one only on success would hand back a spell the rules already
  took away.
- **The Concentration save reads damage taken, not hit points lost.**
  Temporary Hit Points absorb damage; they do not stop it being taken. A
  Warlock behind *Armor of Agathys* who soaks 30 still rolls against DC 15.
  And each instance of damage is its own save. Two hits of 10 are two DC 10
  saves — and so is a single hit of 20, because the floor of 10 swallows both.
  The difference shows higher up: two hits of 30 are two DC 15 saves, where one
  hit of 60 would be a single DC 30. Summing a round's damage and saving once
  is a harder save, not an equivalent one.
- **Temporary Hit Points do not survive a Long Rest.** "Temporary Hit Points
  last until they're depleted or you finish a Long Rest." They are not hit
  points, so healing to full does not touch them and the rest has to clear
  them itself — which is exactly the sort of thing that gets forgotten,
  because every other line of the rest is about giving things back.
- **An interrupted Long Rest pays out on the time rested *before* the
  interruption**, not on the time elapsed when somebody gets round to ending
  it. "If you rested at least 1 hour before the interruption..." Ten minutes
  of sleep and an hour of standing about is ten minutes of rest.
- **A Long Rest restores *all* spent Hit Point Dice.** 2014 gave back half,
  minimum one, and that is the version most tables still have in their heads.
  2024: "You regain all lost Hit Points and all spent Hit Point Dice."
- **An interrupted Short Rest is worth nothing; an interrupted Long Rest often
  is not.** "An interrupted Short Rest confers no benefits", but for a Long
  Rest, "If you rested at least 1 hour before the interruption, you gain the
  benefits of a Short Rest." Treating both interruptions the same way robs the
  party of a rest they earned.
- **Damage order of application is adjustments, then Resistance, then
  Vulnerability** — and the order changes the answer. The SRD's worked example
  (28 fire, -5 aura, resistant and vulnerable) gives 22; doubling before
  halving gives 23. Resistance and Vulnerability are booleans, not counts,
  because multiple instances of either count as one.

## Parsing the SRD

`packages/srd/raw/` is a third-party transcription, and it is uneven. Two rules
follow from that, both learned the hard way:

- **Never hand-edit `raw/`.** Corrections go in `parse/overrides.ts`, sourced
  from the official PDF, so re-vendoring upstream cannot reintroduce a defect.
- **Assert counts, not just "no problems".** A parser that silently skips
  everything reports zero problems. `animals.md` yielded 0 creatures for exactly
  this reason — it shifts its heading hierarchy up a level, which is why the
  parser now detects the entry level instead of assuming it.

Defects found so far, all covered by regression tests:

| Defect | Where |
|---|---|
| 12 spells use singular `**Component:**` | normalised in `parse/spells.ts` |
| 498 modifier cells use U+2212, not a hyphen (`parseInt` → `NaN`) | `parseSignedNumber` |
| 3 stat blocks have collapsed table cells (`+10 +10`, `CON 29`) | `parse/overrides.ts` |
| Succubus puts Initiative on its own line | searched block-wide |
| `animals.md` shifts heading levels | `detectEntryLevel` |
| Equipment rows drop `</tr>`; one `<tr>` is doubled | cells grouped in sixes, not by row |
| Weapon properties contain commas inside parentheses | `splitTopLevel` |
| Legendary CR lines carry a lair value (`XP 5,900, or 7,200 in lair`) | `CR_LINE`, no defaults |
| The master Adventuring Gear table is filed under `#### Ammunition`, not under its own heading | tables located by bold caption in `parse/gear.ts` |
| The Entertainer's Pack weighs `58½ lb.` — a vulgar fraction, not `58.5` | `parseGearWeight` |
| The Waterskin's weight carries a note, `5 lb. (full)` | `parseGearWeight` |
| One `#### Spell Scroll` heading prices two table rows | prefix match in `parse/gear.ts` |
| Gear rows invert their names to alphabetise: `Lantern, Bullseye` | kept as printed; the craft-list test un-inverts to match |
| A tool's Craft list mixes items with categories carrying parenthesised exceptions | split at the top level, as weapon properties are |

**A pack's contents are asserted item by item, not phrase by phrase.**
Checking only that every phrase *resolves* passes on three different wrong
answers — a plural that lost its count, an inversion that landed on a
neighbouring row, a phrase dropped entirely — because all three resolve to
something. All seven packs are transcribed from `equipment.md` as exact
`[id, quantity]` lists and compared whole.

**A craft list is a list of other rows, so check it against them.** Every item
a tool can make is asserted to resolve to something the SRD actually lists — or
to a category phrase like "Any Melee weapon (except Club, Greatclub,
Quarterstaff, and Whip)", whose commas sit inside parentheses and are exactly
the trap that bit the weapon parser. `Spell Scroll` is the single exception:
it is a magic item, and the catalogue that test resolves against is built from
`equipment.md`'s parsers alone. `magic-items.md` is parsed now, so the
exception is a seam between two parsers rather than a gap in the data, and
whoever closes it should make the test resolve across both.

**A default is how a format change becomes a wrong number.** An optional
capture group defaulting the proficiency bonus to +2 gave 32 legendary
creatures — every dragon with a lair — the proficiency of a goblin, silently,
for weeks. Parse strictly and report a problem; never fall back to a plausible
value.

Where a field is derivable from another, **assert the relationship** rather
than only the presence: every monster's proficiency bonus must match what its
challenge rating implies. That test is what catches the next variant.

For table-driven content, assert the **per-section** counts, not just the
total. A missed section heading leaves the total correct while silently filing
every row under the wrong category.

The parser stays strict on a mangled ability table rather than guessing. A
silently wrong modifier is the worst failure this codebase has — it looks like
a rules bug forever after.

**An empty cell is not one state.** The gear table prints `—` and `Varies` in
the same column, and they are opposites: a Bell weighs nothing worth carrying,
while Ammunition's weight is simply stated elsewhere, on the variant you
actually bought. Weapons and armour have only the first case, so they use
`weightLb: number | null`; gear has three states and uses a union, because
collapsing `Varies` into null makes a Musical Instrument weightless and an
encumbrance total quietly wrong. Anything the parser cannot read at all stays
null and is reported — it never becomes either.
