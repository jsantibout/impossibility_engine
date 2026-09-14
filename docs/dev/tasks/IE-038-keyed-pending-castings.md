# IE-038 — `pendingCastings`, keyed by casting id

state: APPROVED_FOR_IMPLEMENTATION
lane: mechanism
tranche: 6
parallel-safe: NO — `events.ts`, `commands/spell-resolution.ts`, `commands/casting.ts`; the whole casting primitive
depends-on: none
worker: none
approved: 2026-09-14 — "APPROVE TRANCHE 6."
merge-approved: none

## Brief

### Objective

Replace the single global `pendingCasting` slot with a record keyed by casting
id, so that two castings may be open at once and every reader addresses **a**
casting rather than **the** casting.

### Why now

The engine refuses **every other creature's** casting and activation for the
whole of a ten-minute rite. IE-034 recorded that as a structural accident of a
one-instant user surfacing as a rules refusal, and four tests pin it as known
debt. SRD lets the cleric cast Cure Wounds while the wizard performs a Ritual.

**And it refuses the rite's own caster a Reaction spell, which is the sharper
case**, because it needs no second creature and no unbuilt mechanic. Verified
against SRD 5.2.1, sentence by sentence:

- *Longer Casting Times* (`spells.md:175`): "you must take the Magic action on
  **each of your turns**, and you must maintain Concentration while you do so.
  If your Concentration is broken, the spell fails, but **you don't expend a
  spell slot**." The obligation is on the caster's **own** turns, and no slot
  has been spent.
- *Concentration* (`rules-glossary.md:455`): "You lose Concentration on an
  effect the moment you start casting a spell **that requires
  Concentration**." Shield and Counterspell require none, so the rite survives.
- *Reaction* (`rules-glossary.md:1197`): "You can take a Reaction on **another
  creature's turn**."
- *One slot a turn* (`spells.md:167`): "On a turn, you can expend only one
  spell slot." On another creature's turn the rite has expended nothing, so
  there is no conflict — and this is the rule that makes the ordinary
  same-turn Fireball → Counterspell → Counterspell sequence a **bad** proof
  case rather than a good one.

So a wizard mid-rite may legally cast Shield as a Reaction when attacked. The
engine refuses it today at `spell-resolution.ts:358`, purely because a record
exists. That refusal corresponds to no rule at all.

Three later tasks build on this record (IE-041's in-combat obligation, IE-036's
fixtures, the Counterspell-on-Counterspell lift), and nothing else in tranche 6
may land on the slot.

### Current relevant architecture

Verified against `main` at `7f503c2`: **26 references in 9 runtime files**.

- `events.ts:962` — `GameState.pendingCasting: PendingCasting | null`;
  `:1052` `initialState`; `:1583` `spell-declared` carries the whole record as
  `event.casting`; `:2451` `releaseCasting` clears on id match; `:4422`
  `spell-declared` throws if any casting is pending; `:4535`
  `spell-interrupted`; `:4572` `spell-cast`'s settling branch already matches
  on id.
- `commands/spell-resolution.ts:172` the `settle-cast` idempotency kind,
  `:177` `resolveDeclaredCast` (takes **no** casting id), `:358`
  `castOrRelease`'s `casting_pending` refusal, `:2393`
  `resolveInterruptCastingEffect`.
- `commands/activation.ts:133` the same global refusal, with no exemption.
- `commands/casting.ts:168` `triggerRefusal`'s `casting-a-spell` window.
- `commands/turns.ts:740` `resolveTurn`'s refusal.
- `commands/reactions.ts:892` `reactionOpportunities`.
- `commands/holds.ts:59` `settleHoldsInvolving`, `:219` `pendingCastingOf`.
- `commands.ts` the barrel; `spell-definitions.ts:177` prose.

### Required behaviour

1. `GameState.pendingCastings: Readonly<Record<string, PendingCasting>>`,
   iterated in **casting-number order** wherever order is observable — the
   ordering `castingsEnded` already uses, so serialisation is byte-identical
   whatever order two castings were declared in. `PendingCasting`'s own shape
   does **not** change.
2. The **global refusal is deleted** from `castOrRelease`
   (`spell-resolution.ts:358`) and from `activation.ts:133`, and **nothing
   per-caster replaces it**. What stops a caster beginning a second casting is
   the real rule primitive in every case — see "The rules that actually refuse"
   below. Another creature's casting is simply legal; so is the same caster's,
   when the primitives permit it.
3. The reducer's invariant is **purely id-based**: `spell-declared` throws only
   if that **casting id** is already pending. The sequential-id check stays and
   is what makes a duplicate id impossible in practice. There is no per-caster
   throw — the reducer is the corrupt-log backstop for *identity*, and caster
   uniqueness is not an identity fact.
4. `resolveDeclaredCast` takes a `castingId` and refuses `no_casting_pending`
   naming it. Its idempotency kind becomes `settle-cast:<castingId>` with the
   id in the fingerprinted inputs; the replayed answer still recovers the
   casting id through `commandOutcome`. **Public API change** — say so in the
   digest.
5. `resolveInterruptCastingEffect` and `triggerRefusal`'s `casting-a-spell`
   window address the casting **by its id**. The trigger check's own comment
   says "there is only one casting open", which is the uniqueness assumption
   this task removes, and with several pending castings a lookup by caster is
   ambiguous:
   - `no_trigger` when nothing is pending — unchanged, and still "wait";
   - `forced_target` when the named creature is casting nothing — unchanged,
     and still "re-send";
   - the request may name the **casting id** it answers. Where the named caster
     has exactly one pending casting the id may be omitted, because there is
     nothing to choose between; where they have several, omitting it is a new
     refusal naming the candidates, so the caller re-sends. The engine never
     picks one — the same rule `eligibleTargets` obeys for targeting.
6. `reactionOpportunities` yields offers for **every** pending casting, to
   every creature other than that casting's own caster.
7. `settleHoldsInvolving` interrupts **every** pending casting by a departing
   caster — genuinely plural now, not "at most one by invariant", and
   `holds.ts:59` currently reads the slot and stops at the first.
   `pendingCastingOf` becomes `pendingCastingsOf(state)` (sorted by casting
   number) and `pendingCastingsBy(state, caster)` — **a list, not an
   optional** — and the barrel and `index.ts` follow.
8. `resolveTurn` **keeps** a global refusal, now reading the record's size,
   and its reason names the casting(s). In combat every pending casting is
   still an instant window; IE-041 makes it per-casting.
9. The two clauses of the **nesting** guard (`spell-resolution.ts:375-381`)
   stay, restated as what they actually are — rules about the *answering
   relationship*, not about uniqueness — each under its own code:
   - a casting whose trigger is `casting-a-spell` may not itself be **held
     open** (an answer is not a window);
   - such a casting may not answer a casting that is **itself an answer**.
   Both are engine limits standing in for the settle-order rule the engine does
   not have, **not** SRD rules: SRD Counterspell triggers on "a creature within
   60 feet of yourself casting a spell with Verbal, Somatic, or Material
   components", and a creature casting Counterspell is doing exactly that.
   Their refusal reasons must say so, rather than saying "one casting is open
   at a time", which stops being true here. `casting_pending` is left carrying
   **no** rule and is retired or narrowed accordingly.
10. The `nothing_to_interrupt` exemption in `refusal-sweep.test.ts:127`
    argues its unreachability *from the slot* — "`pendingCasting` still
    stands". Rewrite it to argue from the keyed record: the resolver re-reads
    the **same casting id** the trigger check accepted, so the two agree by
    construction rather than by the window being unique. If under the new
    addressing the code becomes genuinely reachable, **make it a value and
    assert it** rather than rewriting the exemption — that is the better
    outcome, not a failure.

### The rules that actually refuse

Deleting uniqueness deletes no rule, and the brief must leave each of these
enforced by its own primitive. The builder confirms each with a test or names
it in the digest as already covered:

| The real rule | Its primitive |
|---|---|
| One Action, one Bonus Action, one Reaction a turn | `spendAction` / `spendBonusAction` / `spendReaction`. A caster mid-rite has already spent that turn's Magic action at declaration, so a second Action casting is refused **there** |
| "On a turn, you can expend only one spell slot" | `spellSlotSpentOnTurn`, whose marker rides on the settling `spell-cast` — a pending casting has spent no slot, which is the SRD's own reading |
| One Concentration | `releaseCasting`, the single door: a second Concentration casting breaks the first at declaration. This is what keeps *at most one* Concentration-bearing casting per caster without any uniqueness rule |
| The rite's per-turn Magic action | IE-041's derived failure; out of scope here and unaffected |
| An answer may not open its own window | requirement 9, restated as a relationship rule |

### Architecture constraints

Settled by Fable (IE-034) and by the owner; a deviation from any of these is
`ARCHITECTURE_BLOCKED`:

- `pendingCastings` is keyed by **casting id**; several castings may be pending
  concurrently;
- **several pending castings may belong to the same caster** where the rules
  permit it; every pending casting retains its caster identity, and **casting
  identity, not caster identity, uniquely identifies the record**;
- settlement, interruption, cancellation and retry all address a **specific
  casting id**;
- there is **no** global "a pending casting exists, so another cannot begin"
  rule and **no** per-caster equivalent. A rule that really prevents a casting
  is enforced by its own primitive;
- the four tests that pin the global refusal are **debt markers to invert**,
  not semantics to preserve;
- **neither frozen log is regenerated.** `spell-declared` already carries the
  record as `event.casting`, so both fold into the keyed record unchanged.

### Acceptance criteria

1. Two creatures hold two castings open at once; each settles by its own id;
   neither refuses the other. A fixture drives Counterspell *against* one of
   them while the other stands.
1a. **The invariant test: two pending castings belonging to one caster.** The
   wizard declares a casting of a minute or more (pending, concentrating on
   it), is attacked, and casts **Shield** as a Reaction held open — a second
   pending record, same caster, no nesting and no unbuilt mechanic. Assert
   both records coexist keyed by their own ids, that each settles
   independently by id, that the rite's Concentration is untouched (Shield
   requires none), and that neither the rite's slot nor the turn's slot marker
   is disturbed. Outside combat, because the rite in combat is IE-041's; the
   in-combat version is IE-041's to add, and its brief should say so.
1b. A caster mid-rite **is still refused** a second Magic-action casting on
   their own turn — and the refusal comes from the **action economy**, asserted
   by its own code, not from anything about pending state.
2. A caster with an open casting is refused a second Magic-action casting, and
   **permitted** a Bonus Action casting and a Reaction.
3. These four tests are **inverted** and say so in their prose:
   `long-casting.test.ts:815`, `:848`, `counterspell.test.ts:641`,
   `ongoing-spells.test.ts:1235`. `long-casting.test.ts:404` and
   `counterspell.test.ts:215` are **kept** (the turn refusal), with the reason
   string naming the casting.
4. `counterspell.test.ts:668` and `:726` (the nesting limit) still refuse,
   under the new distinct code, which is asserted by name.
5. Both frozen logs fold to the same state with no fixture edit;
   `persistence-2.test.ts:174`'s end-state assertion becomes "the record is
   empty"; `scenario.test.ts`'s re-run determinism is untouched.
6. A retried `resolveDeclaredCast` under one command id is a no-op; the same
   id re-used for a **different** casting id is refused, as everywhere else.
7. `refusal-sweep.test.ts`'s exemption reason no longer mentions the slot, and
   every new or changed refusal code is asserted by name.
8. `long-casting.test.ts:318`'s assertion that cannot fail is tidied (same
   file, one line — IE-034's recorded leftover).

### Tests and conformance

The gauntlet, plus both frozen logs and `scenario.test.ts` run explicitly.
CLAUDE.md: rewrite "A Casting Can Be Interrupted"'s "one pending casting, no
stack" and the whole "A casting in process is one engine-wide" paragraph — the
limit it describes is what this removes. The sentence "the reducer branches on
the id, not on 'is anything pending'" was already right and stays.

### Dependencies

None. It is wave 1, and everything else in the casting primitive waits on it.

### Out of scope

The in-combat long casting (IE-041). The Counterspell-on-Counterspell **lift**
— it needs a settle-order rule over the keyed record and is a semantic change;
keep the refusal. Any change to `PendingCasting`'s fields.

### The audit's own enumeration, re-classified

Fable's §2.2 table classified sixteen sites as "global refusal", "reads *the*
casting", "reducer invariant", "idempotency" and "prose". That classification
stands; **what changes is the disposition of two rows** — the reducer's throw
becomes id-based rather than per-caster, and the Counterspell lookup becomes
id-based rather than by-caster. Work from the table, and for every remaining
site answer the one question: *does this assume uniqueness, and does a rule say
so?* Any site assuming uniqueness with no rule behind it is corrected, and the
digest lists all sixteen with their disposition.

### Known risks

Sixteen sites, six command modules and the reducer in one diff. The reducer
sites are already id-shaped or one line from it; the command sites hold the
behaviour that is changing. The guard against a silent miss is the fold: a
site left reading "the" casting fails the two-castings fixture.
