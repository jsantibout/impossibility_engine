# Claude integration (M2+)

The orchestration layer above the engine. Verified against the bundled `claude-api` skill; re-check that skill before changing any of it.

## The API

- Model `claude-opus-5`, `thinking: {type: "adaptive"}`, streamed via
  `client.beta.messages.toolRunner({ ..., stream: true })`
- Check `stop_reason === "pause_turn"` each iteration and `pushMessages` to
  resume — **the runner does not auto-resume**, it silently returns a truncated
  turn
- Enable refusal fallbacks (`betas: ["server-side-fallback-2026-07-01"]`,
  `fallbacks: "default"`) and check `stop_reason === "refusal"` before reading
  content. Dark-fantasy narration is exactly the traffic that trips a classifier,
  and a DM that hard-fails mid-combat is a broken product
- **Caching is architecture, not tuning.** The system prefix (persona + DM
  directives) is frozen and carries an explicit `cache_control` breakpoint;
  tools are serialised in stable sorted order. Per-turn game state goes in as a
  `{role: "system"}` message appended to `messages[]` — never by editing
  top-level `system`, which would reprocess the whole campaign uncached every
  turn. An integration test asserts `cache_read_input_tokens > 0` on turn 2+,
  because that failure is silent and expensive
- Never interpolate date, session id, or player name into the system prompt

## The session boundary (`@ie/tools`)

Decided from the probe in `tools/llm-probe`, which already drives a live model
against the engine end to end. `@ie/tools` is above the purity line and may use
Zod, a clock and id generation; the engine below it may not.

**One `Campaign` per content and log.** It owns the seed, the validated
`Content` and the event log, and nothing else. `GameState` is a derived cache
stepped by `applyEvent` — stepping and refolding are the same function
(`fold/apply.ts:206`, `:458`), which `persistence-2.test.ts:367` already
relies on, and a test holds the cache equal to `fold(seed, log)` after every
call. No live `Rng` or `RollIssuer` is held: both are rebuilt per call from
`state.rng` and `state.rollsIssued` and thrown away, as `scenario.test.ts:207`
and the probe's `session.ts:45` do. That is what makes a refusal free — the
generator it never used is discarded. The only non-determinism is the seed,
drawn once when the campaign is created. The command id is the transport's
`tool_use.id`, never a field the model fills.

**Four outcomes on the wire, not three.** `ok` carries the events the call
wrote, its resolution, and any `unverified` clauses the engine could not
check; `refused` carries `code` and `reason`; `needs-context` carries `code`,
`reason` and `establish[]`; `invalid` is Zod rejecting the model's arguments
before any engine call, and is never a rules refusal. The probe's `settle()`
(`surface.ts:321`) is the shape.

**Nobody holds a partial command.** A `needs-context` spent nothing and threw
no die; the model establishes the fact through the named tool and re-sends its
original call, which is what `needsContext` was written to mean
(`result.ts:122`) and what the `route` kind requires by construction. Every
`ContextRequest.kind` must map to a tool that declares it — a kind with no
door is the failure to test for. A session that resumed the held call would
make a decision the transcript does not show, and transcript re-dispatch is
the determinism criterion.

The same holds one step wider. A tool that declares it establishes a kind must
have the field that carries it; a fact the engine can be told must have a tool
that tells it; and a refusal that names what the caller has not supplied must
be answerable through the field it names. `packages/tools/src/doors.test.ts`
derives all four sets from the engine's own source rather than a list, because
a list stops guarding the day somebody adds to it and does not think to come
here. Four doors were found shut by accident before it existed, and six more
the day it did.

**The pools that were left shut are opening one room at a time.** A pool a
caller can spend for no effect is worse than one it cannot spend — so Channel
Divinity stayed shut while nothing executed what a use bought, and opened the
week a feature's pool use became the third host of an effect list. Cleric's is
a door now (`use_pool_option`, with the menu on `sheet`, and `among` carrying
the division a spendable pool makes — a list of `{ target, hitPoints }` the
engine validates and never trusts, which is not the number rule bending because
no die is thrown and the budget is read off the sheet); Paladin's, which
prints no options the engine executes, is not. **Bardic Inspiration opened
the same way** — not as a pool a caller spends for nothing, but once the die
had somewhere to go: the Bard's pool is spent on the Bard and the ally holds a
sourced grant consumed when a test it was given for fails, so `confer_reaction`
hands over a thing that exists. **Action Surge was never shut for that
reason**, and the sentence here that said so was wrong for a week:
`useBudgetPurchase` had been executing what a use buys the whole time and no
tool reached it, which is the opposite defect — a door nobody built, rather
than a pool waiting on its mechanism. `use_budget_purchase` is that door, and
the Monk's Focus opened with it. Four pools are still shut for the original
reason — Druid's Wild Shape, Paladin's Channel Divinity, Font of Magic and
Arcane Recovery — each counting and refilling its uses truthfully and buying
nothing, and each named in `reachability.test.ts`'s `NOTHING_TO_BUY` with the
sentence that keeps it shut. That table is checked in both directions, so a
pool that opens deletes its line in the same commit.

**A window a caller can see and cannot answer is worse than one it is never
shown.** `options` has reported every open Reaction since `reactionOpportunities`
landed, and three of the six windows had no door on either surface.
`attack.hold` opens the held hit SRD *Shield* needs and `settle_attack` closes
it; `take_damage_reaction` / `decline_damage_reaction` / `settle_damage` answer
a damage roll that has not landed; `take_test_reaction` /
`decline_test_reaction` push a D20 Test, whose settlement stays on the DM's
door beside the check that opened it, because only a DC opens one. **Every
window that holds something has a door that closes it**, because a window
nothing closes wedges the fight it was opened in.

**A hold needs its release, and one field is never enough.** `cast_spell.hold`
makes a casting a process so Counterspell has something to interrupt, `answers`
names which of a caster's open castings, and `resolve_declared_cast` is what
finishes one nobody stopped — a declaration with no settlement is a slot nobody
spends, held open for the rest of the campaign.

**Time out of combat is narration and is therefore a door.** In a fight the
clock is derived; outside one, how long the party walked is the same kind of
fact as how wide the room is, and the engine has always taken it as declared.
`advance_time` states it in rounds, minutes and hours. It is what makes
`begin_rest` / `end_rest` mean anything, and a Short Rest is what makes a
Warlock and a Fighter work across two fights rather than one. What a rest gives
back is never stated: the benefit is read off the clock and off the
interruptions the engine recorded for itself, and the only choice is which of
your own Hit Dice to spend. **What nothing refuses today is advancing the clock
*during* a fight**, where the clock is derived — the engine is permissive there
and this surface inherits it, which is a rule the engine owes rather than one a
layer holding no rules may invent.

**`award_items` is the DM's, `use_item` is the model's**, for the reason
`create_character` already refuses a model a non-empty `dmGrants`: handing out
what a party found is the DM's, and what a character does with what it holds is
the character's.

**A guard over a hand-picked party guards that party.** The sweep that proves
every spendable feature names a tool now builds one character of every class in
the book, and derives both sides of the claim.

**A monster is a door now, and it arrives able to fight.** `add_creature`
takes a stat block's id and nothing else about it, which is `addCreature`'s own
argument one layer up: an entry point that accepts a stat block is the door a
model-authored Armour Class walks through, and a tool over it taking
`{ armorClass: 15 }` would reopen it here. So the whole of the call is what to
call the creature and which block it is, and `unknown_monster` is answerable at
`monsterId`. It runs two commands, because one is not enough to put a creature
in a fight: `resolveAttack` refuses a weapon its wielder does not own, so a
Goblin Warrior added and not armed cannot make the Scimitar attack its own
block prints. The arrival is composed with `awardItems` under a derived command
id, exactly as `roll_initiative` composes its two, and appended once.

**And it swings with its own printed lines.** `attack` takes `action` — a name,
never a line, which is `add_creature`'s own rule one layer up — so a model may
elect the Bite a block prints instead of leaving every monster punching.
`unknown_action` answers a name the block does not print, and `two_attacks` a
call that names both a weapon and an action. A monster provoked into an
opportunity attack needs no election at all: the engine reaches for the
highest-damage printed melee attack that does not recharge, and a caller may
still name a different one. **Turning
`Javelins (6)` into six `javelin` is this package's job and not the engine's** —
the engine holds no catalogue and reads no name — and what the catalogue cannot
find is reported through `unverified` rather than refusing the creature, which
is `addCreature`'s reading of a qualified defence applied one layer up. One
consequence is that the surface stopped asking for a size: `creature-added`
pins it, so `move` and `cast_spell.teleportTo` carry none at all, and
`place_creature` keeps one only for the creature whose record pins nothing —
which today is every character, because `createCharacter` writes no size and
SRD's Gnome and Halfling are Small.

**What a character holds is a third read, beside `look` and `options`.** The
three answer different questions: `look` is the table — everybody in the room,
where they stand, what the engine is owed; `options` is the instant — a debt in
a creature's way, a Reaction window open to it, a check an effect offers;
`sheet` is the character — its slots by level with Pact Magic kept as the
separate resource it is, its pools and what refills them, what it can cast and
by which route, and its features. It exists because a model could not see its
own spell slots, and because a model cannot elect a feature it has not been
told it holds. It states no verdict: whether a feature may be used right now is
the command's answer, and asking twice is how two answers drift. What it adds
beyond the record it adds for one reason — that a fact a caller is told and can
find no door for is half a door: `spentBy` names the tool that spends each
feature, `takenBy` the one that answers a Reaction somebody was given, and
`grantedReactions`, `coins`, `carrying`, `equipped` and `attuned` say what a
character is holding at all, as `look` now says whether a dying creature is
stable. The doors themselves are one tool per engine command. **A pool the
engine holds with nothing behind it still gets none** — that rule closed
Channel Divinity and the Bard's die only when what a use bought was built, and
what it still refuses is Wild Shape, Paladin's Channel Divinity, Font of Magic
and Arcane Recovery. **A door the engine has and nobody builds is the other
half of the same failure**, and it is now a test rather than a promise:
`reachability.test.ts` builds one level 5 character of every path in the book
and fails unless each feature it holds is passive, made at creation, a
Reaction with a window that answers it, or spendable through a tool the
surface really publishes.

Out of scope until decided: persisting the log (a `Content` holds closures, so
what is stored is the `ContentInput`), and multiple scenes. Two things a later
batch owes: an engine command that rolls Initiative *and* begins combat, so
the tools layer stops hand-writing the one `rolls-issued` a caller assembles
(`commands/initiative.ts:41`); and whether `satisfyWith` becomes a tool name
rather than prose, now that a second consumer reads it.
