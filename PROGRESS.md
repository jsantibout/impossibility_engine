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

## Decisions that constrain what comes next

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
- **Equipment, wounds, spent resources and ongoing effects survive advancement.**
  `advanceCharacter` plans against the creature's *live* inventory and equipped
  set, never the creation-time snapshot.

## Next actions, in order

1. **Bulk spell definitions in the shapes that already work.** Attack (16),
   save-damage (30), save-condition (43) — most of these need no new mechanism.
   Each needs its SRD quote in the docstring and is auto-checked against the
   parsed index. This is the biggest coverage move available and is pure data.
2. **Temporary Hit Points effect type** (3 spells: False Life, Aid, and the
   Armor of Agathys shape). `grantTemporaryHpTo` already exists; no effect type
   reaches it.
3. **A named bonus to later rolls** (5 spells: Bless, Guidance, Bane). Needs an
   effect that hangs a `Bonus` on a creature and a roll that reads it —
   `bonuses.ts` has the vocabulary, nothing stores them on a creature.
4. **Ongoing effects a later turn can act through** (18 spells). Spiritual
   Weapon, Call Lightning: a casting that a subsequent turn spends an action to
   use. Needs a handle on the casting that a command can name.
5. **Reaction triggers** (4 spells: Shield, Counterspell). Needs an interrupt
   that can order a cast against the event that triggered it. This is the
   hardest remaining spell mechanism and is deliberately last.
6. **Summons** (9 spells). Needs a creature created mid-fight from a stat
   block, which `adaptMonster` can already produce — the gap is an event that
   adds it and ties its life to the casting.
7. **Long casting times** (43 spells). Needs a casting-in-progress state
   machine with a per-turn obligation; the clock alone was never the blocker.
8. **Classes.** See below.

## Classes: what exists and what the seams are

`progression.ts` holds the reusable structures and `wizard.ts` proves they fit.
What is Wizard-shaped and must be generalised when a second class lands:

- Two feature ids are looked up by name in `creation.ts` — `wizard:scholar`
  (expertise) and `evoker:evocation-savant` (free spells). Both need to become
  a declared feature *kind* rather than a string match.
- Spell preparation assumes a spellbook. A Cleric prepares from the whole class
  list; a Sorcerer knows spells and never prepares. `spellbook.ts` is
  Wizard-specific and needs a sibling, not an edit.
- `hitPointsFor` and the pool declarations are already class-agnostic.
- Multiclassing is not modelled at all: no rule for combining spell slots, no
  prerequisite check, no proficiency-subset rule on the second class.

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
