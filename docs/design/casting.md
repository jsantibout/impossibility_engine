# Casting

Read before changing `commands/casting.ts`, `commands/spell-resolution.ts`,
the `commands/spell-effect-*.ts` resolvers, `commands/activation.ts`,
`commands/ongoing.ts`, `spells.ts`, or `fold/casting.ts` / `fold/ongoing.ts`.

## The shape

- **A slot is a pool** (`resources.ts`): spell slots, Pact Magic slots, Ki and
  charges are the same mechanism, declared by creation, spent and restored by
  commands. Pact slots are a separate pool that recovers on a Short Rest.
- **A casting is a thing with an identity.** Every casting gets an id
  (`cast:N`, sequential), and every effect it creates carries that id in its
  source, so breaking *this* Hold Person ends exactly one paralysis.
- **Resolution is one pipeline**: `resolveSpell` validates (caster, route,
  slot, action economy, targets, range, sight, creature type, area) before
  anything is spent or rolled; then a per-kind resolver runs for each
  `SpellEffect` over one `EffectContext`; then the record is written.
  `castSpell` is the declaration half; `resolveCast` / `resolveDeclaredCast`
  settle it.
- **Casting numbers are pinned at the cast.** DC, attack modifier, slot level
  and the caster's level live on the record, so a Web keeps the DC it was
  conjured at.
- **A definition is read at resolution, never in the fold.** Commands fetch
  it from `supply.content.spell(id)`; the record stores what the fold needs
  (area, trigger clauses, end triggers, `aimed`) so replay never opens a
  catalogue.

## Interruption and long castings

`pendingCastings` (keyed by casting id) holds every declared casting open
between declaration and effect. A Reaction spell names the casting it
answers; Counterspell interrupts one. A casting of a minute or more
completes on the clock, concentrating on itself until it does, and in combat
demands the Magic action each turn (`continueCasting`). A Ritual is the same
mechanism ten minutes longer and spends no slot.

## Concentration and what a casting leaves behind

One casting per creature; starting another ends the first. Damage raises a
Concentration save the engine rolls (`resolveDamage` takes the `Supply` so
the save cannot be forgotten). Incapacitation and death end it in the fold's
derived pass, with no event, because nobody decides that.

`state.ongoing[castingId]` is the durable record of a running casting: level,
numbers, area, trigger clauses, end triggers, origin point, and `aimed` (the
targets the world cannot say). Dispel Magic reads it; a later activation
(Spiritual Weapon's swing, Moonbeam's move) acts through it; `spell-ended`
releases every grant that carries the casting's source. A record's `version`
says which shape it was written in; `ongoing-compatibility.ts` upgrades an
older one and needs legacy content only for a record that never wrote its
area down.

A casting may host a repeat save of its own (SRD Searing Smite: the target
"takes 1d6 Fire damage and then makes a Constitution saving throw" at the
start of each of its turns): the casting's timer carries the `RepeatSave`, the
boundary raises it with the casting's own mark as the source, `beforeTheSave`
is paid through the damage funnel before the die is thrown, and a success ends
the casting. A smite cast on a hit keeps its record and timer when the spell
prints a duration (`castOnHit`), which is how Shining Smite's minute and
Concentration are enforced; Divine Smite is Instantaneous and leaves none.

## A summons and its one lifetime

A casting that leaves a record holds its creature there and takes it away
when the record ends. An Instantaneous casting binds nothing — unless the
spell prints that the caster *keeps* the creature (`kept` on the `summon`
effect: SRD Find Familiar, Find Steed), in which case the bond is to the
summoner: the creature is owed a departure at 0 Hit Points, or when the
summoner dies where the spell says so, and a second casting of the same spell
replaces it. Either way `strandedSummons` finds the debt and
`dismissStrandedSummons` performs it; the fold refuses a bond naming both a
casting and a summoner, or neither. The form is stated at the casting
(`CastSpellRequest.form`, out of the printed list or any block a type-and-
rating clause admits) and so is the creature type (`choiceStated` of
`creature-type`); a Speed the spell prints over the block is gated on the
slot; a creature that shares its caster's Initiative is seated immediately
after them (`Combatant.after`), never by an invented tiebreak. A feature the
casting comes through may add to both the choice and the bond: SRD Wild
Companion's Find Familiar is Fey whatever the caster says (`fixesChoice` on the
granted route; another answer is `choice_fixed`) and is owed a departure when
the Druid completes a Long Rest later than the binding (`untilSummonerLongRests`
and `since` on `KeptBond`) — the third lifetime a kept summons can have, and
still one bond per creature.

**A Ritual from the book.** `CastSpellRequest.ritual` makes a casting a long
one, ten minutes longer than printed and slotless (`slotless: 'ritual'`), and
is refused for a spell without the tag. Where no route supplies the spell,
`chooseRoute` asks the caster's sheet for a licence — SRD Ritual Adept's
`ritual-from-book` standing grant — and a class whose `book` holds the spell
casts it as its own, unprepared. The book being in hand is the table's.

## The effect vocabulary

The `SpellEffect` kinds (`EFFECT_KINDS` in `spell-schema.ts`), each with one
resolver; three rider kinds hang on a settled outcome (a condition, a
modifier, a delayed hit). A rider is a leaf: it rolls nothing and targets
nobody of its own. A spell that needs a new kind is engine work; a spell that
fits an existing one is content.

## Casting from an item

The SRD settles this in one sentence, so the engine does not have to have an
opinion: "The spell uses its normal casting time, range, and duration, and
**the user of the item must concentrate if the spell requires
Concentration**. Many items, such as Potions, **bypass the casting of a
spell** and confer the spell's effects with its usual duration." Two shapes,
named in one line, and which is which.

**A wand casting Fireball is a casting.** It goes through `castOrRelease`,
gets a casting id, a `spell-cast` event, Concentration when the definition
says so, and an ongoing record Dispel Magic can find. `SlotlessReason` has
carried `'magic-item'` since it was written, with nothing emitting it; this
is what it was for. The item's charge pool stands where a feat's
`freeCastPool` already stands.

**The numbers are the item's, then the wielder's.** A printed DC or attack
bonus is a field on the grant; the fallback is a rule in the resolver,
because the item cannot print a rule the SRD prints once — a wielder's own
ability where the item says to use it, the wielder's choice when they have
two, and +0 with Proficiency when they have none. They reach the log pinned,
through the writes a class casting already uses.

**The charge is spent inside the casting's own batch**, after every
validation and before the first die — the line the free-casting already
writes. Two commands would be two ids, and the first would land while the
second refused.

**A potion is not a casting**, by the same sentence. An effect list an item
confers without casting anything is a second grant kind and a second
population, and it needs a source that `releaseCasting` can address or
deliberately cannot. One kind with two behaviours would report itself read
when only half of it was.

Left open, and worth knowing before somebody meets it: **Counterspell
triggers on components, an item's spell requires none, and a
`SpellDefinition` holds no components at all** — so today's reaction window
would open on a wand. Whether the window reads components or the item route
refuses it is a rules decision nobody has taken.

A feature's pool use is the third host of an effect list. It confers without
casting exactly as a potion does — no casting id, no ongoing record, filed
under `feature:<id>` — and differs from an item in one thing: the numbers are
the holder's. An item prints its DC and a feature says "your spell save DC",
so the ability is the granting class's, resolved at creation, and the DC is
derived from the sheet at the moment of use.
