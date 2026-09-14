# IE-040 — A monster enters through a command, with its printed condition immunities

state: OWNER_APPROVAL_REQUIRED
lane: mechanism
tranche: 6
parallel-safe: CONDITIONAL — `commands/creatures.ts`, `commands/conditions.ts`, `monster.ts`, `fold/creatures`; not beside IE-042
depends-on: IE-039
worker: none
approved: none
merge-approved: none

## Brief

### Objective

Add the command that puts a monster into a game, and make a stat block's
**printed condition immunities** reach state and be honoured.

### Why now

Two halves of one correctness gap, and the second is a shipped wrong number
with no symptom.

`adaptMonster` produces `defenses.conditionImmunities` and
`conditionApplicability` answers three ways — and **nothing outside
`monster.ts` calls either**. Verified on `main`: every caller is a test file.
`creature-added` carries `sheet`, `maxHp`, `creatureType`, `defenses` (damage
types only) and `side`, and `applyConditionTo` consults an `immuneTo` list its
caller supplies. So **a Zombie is Poisoned by Ray of Sickness like anybody**,
and M2's tool surface has no way to add a monster without folding an event
itself — the one thing the layer above the engine must never do. This is the
fourteenth recorded instance of a pure function nothing calls, and the largest
since the scene commands.

It is also the storage a **granted** condition immunity joins as the seventh
sourced family (IE-042), and the first half of summons. Printed first, granted
second, not the reverse.

### Current relevant architecture

- `monster.ts:31` `conditionImmunities` on the adapted defences; `:186`
  `adaptMonster` fills them; `:270` `conditionApplicability` reads them and
  answers `allowed` / `immune` / `needs-adjudication` with the qualification
  attached.
- `events.ts:1065` (after IE-039, `state.ts` / the union) — `creature-added`.
- `commands/conditions.ts:34` — `applyConditionTo`, whose `immuneTo` comes
  from its caller.
- `commands/creatures.ts` — where the command belongs.
- `commands/facts.ts` — `unknownCreature`'s written exemption, which says in
  its own words that it names an event because **adding a creature has no
  command**. This task ends it.

### Required behaviour

1. `addCreature` — a barrel command, through `once`, emitting `creature-added`
   (and `spellcasting-declared` where the stat block casts), wrapping
   `adaptMonster`. It refuses a creature already in the game and refuses an
   unknown stat block; it spends nothing and is therefore **not** guarded by
   `mayAct` — record it in `DECLARED_NOT_ACTED` with the sentence that exempts
   it, exactly as the scene commands are.
2. `creature-added` gains an **optional** `conditionImmunities`. Absent means
   none, so both frozen logs fold unchanged and no fixture is regenerated.
3. `CreatureState.conditionImmunities`, written from the event.
4. `conditionImmunitiesOf(state, who)` is the **one gatherer** — the
   `defensesOf` shape — and `applyConditionTo` reads it, so a caller's
   `immuneTo` argument becomes unnecessary. Removing that parameter is
   preferred; if a caller genuinely still needs to add one, the gatherer
   unions rather than the caller overriding.
5. **Qualified entries stay out of the automatic table.** "Charmed (except
   from its vampire master)" is `needs-adjudication` and comes back in
   `unverified`; it must not become an unconditional immunity, which is the
   documented wrong answer.
6. The `unknownCreature` context-request exemption in `invariants.test.ts`
   falls: the request now names `addCreature`, and the exemption is deleted
   rather than reworded.

### Architecture constraints

Settled; a deviation is `ARCHITECTURE_BLOCKED`:

- `addCreature` wraps `adaptMonster`; it does not reimplement any of it;
- one gatherer, read at `applyConditionTo`, not a second table;
- three-valued applicability preserved — an immunity the engine cannot
  evaluate is withheld and reported, never applied;
- the event field is optional, so no log is regenerated.

### Acceptance criteria

1. A Zombie added through `addCreature` **cannot be made Poisoned** by a spell
   that would otherwise impose it, and the refusal or no-op is asserted through
   the public resolution path rather than against the gatherer.
2. A Vampire Spawn's qualified Charmed immunity leaves the condition
   `allowed` and returns an `unverified` line naming the qualification.
3. `addCreature` is idempotent under one command id, and refuses a duplicate
   creature.
4. A scenario adds a monster, places it, rolls Initiative and fights it, with
   **no hand-written event anywhere in the test** — read off the test's own
   source, the way `scene-commands.test.ts` reads its own.
5. Both frozen logs fold unchanged.
6. The `unknownCreature` exemption is gone and `invariants.test.ts`'s
   `satisfyWith` sweep passes without it.

### Tests and conformance

The gauntlet. CLAUDE.md: the "Monsters State Their Numbers" section gains the
command and the immunity path; "Known Pending Work"'s claim that every declared
event type is emitted by a command keeps its derived sweep green.

### Dependencies

After IE-039 (it touches the state types and the union, which IE-039 moves).
IE-042 depends on this.

### Out of scope

Summons and a creature whose presence a casting ends. Granted condition
immunity (IE-042). Anything about `monsterCanReceive` beyond calling it.

### Known risks

Low. The one judgement call is whether `applyConditionTo` loses its `immuneTo`
parameter; if a caller is found that legitimately needs to add an immunity the
state does not hold, union rather than replace and say so in the digest.
