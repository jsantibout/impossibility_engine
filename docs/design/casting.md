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
