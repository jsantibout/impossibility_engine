/**
 * Every tool on a surface, as JSON Schema an API will accept.
 *
 * `ToolDefinition.schema` has always said it was "for a caller that wants to
 * publish it as JSON Schema", and until now every caller that wanted to did
 * the conversion itself — the probe's OpenAI driver writes its `parameters` by
 * hand. This is that conversion, done once, so the app copies nothing.
 *
 * What is asserted here is not "the schemas look right", which a reader can
 * see. It is that **the conversion cannot silently stop covering a surface**:
 * every tool converts, in the order the prompt cache depends on, and the whole
 * serialisation is pinned by length so a tool added, renamed or re-shaped shows
 * up as a diff somebody has to look at.
 */

import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import {
  createCampaign,
  createDmSurface,
  createSurface,
  openAiTools,
  toolSchemas,
} from '@ie/tools';

const campaign = () => createCampaign({ content: SRD_CONTENT, seed: 'tool-schemas' });
const player = () => createSurface(campaign());
const dm = () => createDmSurface(campaign());

/** Every value anywhere in a JSON tree, so a sweep can look at all of them. */
function* walk(value: unknown): Generator<[string, unknown]> {
  if (Array.isArray(value)) {
    for (const item of value) yield* walk(item);
    return;
  }
  if (value === null || typeof value !== 'object') return;
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    yield [key, inner];
    yield* walk(inner);
  }
}

describe('toolSchemas', () => {
  it('converts every tool on both surfaces without throwing', () => {
    expect(() => toolSchemas(player())).not.toThrow();
    expect(() => toolSchemas(dm())).not.toThrow();
    expect(toolSchemas(player()).length).toBeGreaterThan(0);
  });

  it('keeps the surface’s own order, which is what the prompt cache rests on', () => {
    for (const surface of [player(), dm()]) {
      expect(toolSchemas(surface).map((one) => one.name)).toEqual(
        surface.tools.map((one) => one.name),
      );
    }
  });

  it('gives every tool an object schema and its own description', () => {
    for (const surface of [player(), dm()]) {
      for (const schema of toolSchemas(surface)) {
        expect(schema.parameters['type']).toBe('object');
        expect(typeof schema.description).toBe('string');
        expect(schema.description.length).toBeGreaterThan(0);
      }
      const byName = new Map(surface.tools.map((one) => [one.name, one.description]));
      for (const schema of toolSchemas(surface)) {
        expect(schema.description).toBe(byName.get(schema.name));
      }
    }
  });

  it('strips what an API would reject or be confused by', () => {
    for (const surface of [player(), dm()]) {
      const json = JSON.stringify(toolSchemas(surface));
      // `$schema` is a dialect declaration, not a parameter description.
      expect(json).not.toContain('$schema');
      // `.int()` bounds every integer by `Number.MAX_SAFE_INTEGER`, which is
      // noise in a prompt and a rejection in some APIs.
      expect(json).not.toContain('9007199254740991');
      for (const [key, value] of walk(toolSchemas(surface))) {
        if (key === 'maximum' || key === 'minimum') {
          expect(Math.abs(value as number)).toBeLessThan(Number.MAX_SAFE_INTEGER);
        }
      }
    }
  });

  it('is byte-stable across two calls, because a prompt cache is', () => {
    expect(JSON.stringify(toolSchemas(player()))).toBe(JSON.stringify(toolSchemas(player())));
    expect(JSON.stringify(toolSchemas(dm()))).toBe(JSON.stringify(toolSchemas(dm())));
  });

  /**
   * The pin.
   *
   * A count and a length, per surface. Neither is a fact about the rules — it
   * is a tripwire: a tool added, a field renamed, a `z.number()` becoming a
   * `z.enum()` all move it, and moving it is a line in a diff rather than a
   * silent change to what a model is shown. Update it deliberately and say
   * what moved.
   */
  it('publishes exactly the surface it publishes, pinned', () => {
    // Re-pinned 2026-09-22: `cast_spell.form` widened both surfaces, and the DM
    // surface gained `take_tested_action` (the batch's ninety-second tool).
    // Re-pinned again the same day: `assume_shape` and `revert_shape` on both
    // surfaces, `create_character.choices.knownForms`, `add_creature`'s
    // sentence about a stat block that casts, and the rests track's
    // `end_rest` re-choices.
    // Re-pinned 2026-09-23: `resolve_fall` on the DM surface, the small
    // features track's one new door. Re-pinned again the same day: the
    // feature vocabulary track's sentence on `extend_feature` about a printed
    // span, on both surfaces; and once more for `cast_spell.ritual`, the
    // casting-cost track's one published field. Re-pinned once more for
    // `take_action.using_feature` and `take_action.also_taking`, the two
    // fields the standing-kinds track published so a caller can say which of
    // a creature's allowances is paying and what one spend buys. Re-pinned
    // once more for `attack.cantrip`, the one field the True Strike track
    // published: the spell a swing is cast with, and the damage type its offer
    // takes. It is on **both** surfaces because the field is on the shared
    // request — no stat block in the bestiary casts a spell this way, and one
    // that printed such a line would reach it through the same door.
    // Re-pinned once more for the area-filters track, which published no new
    // field at all: `cast_spell`'s own description and its `targets` now say
    // that an area printing "each creature of your choice" takes the subset in
    // the list a casting already has. A sentence rather than a door, and the
    // pin moves for a sentence exactly as it does for a door. The attach track
    // then added `attack.holdInsteadOfDamage` — the hold a printed line offers
    // in place of its damage — and the Blinded track gave `eligible_targets`
    // the `at` / `towards` a self-origin area needs to be placed, all on the
    // same night; the three pins sum.
    // Re-pinned 2026-09-24 for the sleeper's door: `wake_creature` is a tool
    // of its own on **both** surfaces — one creature spending an Action to end
    // an effect on another is the one thing in the book shaped that way, and
    // it sits beside `take_action` rather than inside it because every kind
    // there names only the creature taking it. The DM surface also gained
    // `force_printed_save.willing`, the half of SRD Vampire Spawn's targeting
    // clause no state can answer. The same night added the three doors a
    // thing a feature makes needs — `create_device`, `dismantle_device` and
    // `activate_device`, the whole of SRD Gnomish Lineage's clockwork device
    // above the engine — and the pins sum.
    // Re-pinned 2026-09-24 for Metamagic's other six: `cast_spell` gained
    // `usingOptions`, `unaffected` and `saveModes` — which of the caster's own
    // priced options a casting buys, the creatures it leaves alone, and how a
    // named creature rolls the saves it forces. The tool count does not move
    // (three fields on one tool), and both lengths move by the same 1,963
    // bytes, because `cast_spell` is published on both doors.
    // clause no state can answer. Two pins, and they sum with whatever the
    // other tracks of this batch moved.
    // Re-pinned 2026-09-24 for the moments track, which opened two doors.
    // `settle_saves` is on **both** surfaces: it rolls the saves the world
    // already owes, which `end_turn` was the only way to reach — and a Death
    // Burst raised in the middle of somebody's turn put them out of reach
    // entirely, because the turn then refuses to end while the debt stands.
    // `declare_damage_type` is on the DM's alone, for `declare_heads`' reason:
    // SRD Half-Dragon's Draconic Origin ends "(GM's choice)", and a model
    // choosing which damage its own monster deals would be writing the
    // encounter. Two pins on the DM surface and one on the player's, and they
    // sum with whatever the other tracks of this batch moved.
    // Re-pinned 2026-09-24 for the imbued-weapon track, which published one
    // field and one longer sentence: `activate_feature` gained `weapon` — the
    // object a use is aimed at, SRD Sacred Weapon's "one Melee weapon that you
    // are holding" — and its description says what the engine refuses and what
    // ends the imbuing. No tool count moves, and both lengths move by the same
    // 574 bytes, because `activate_feature` is published on both doors.
    // Seven tracks moved these pins on one night; each move is recorded above
    // and the pins are the sum of them all.
    // Seven tracks moved these pins on one night; each move is recorded above
    // and the pins are the sum of them all.
    // And four more on each for the second-place track, plus two on the DM's
    // alone — see the pin below.
    // And one more on the DM's alone for the compulsions track, `trigger_glyph`.
    // And one on each for the standing-up track, `stand_up`.
    // And one more on the DM's alone for the moves-a-line-makes track (W7-B9),
    // `move_printed_line`; `teleport_printed_line` and `move` grew fields.
    // And one on each for the ground-move-and-bond track, `command_summons`
    // — SRD Unseen Servant's Bonus Action, a placement and never a number.
    // And two on each for the insides-and-holds track (W7-B10),
    // `escape_from_inside` and `pull_out_of_creature`; and one on each for
    // W7-S21, `borrow_senses` — SRD Find Familiar's Bonus Action, the third
    // door on the kept bond.
    // And one more on the DM's alone for I-E9, `printed_line_catch`.
    // And three more on the DM's alone for W7-B12: `take_rest_form`,
    // `settle_block_deadlines` and `split_printed_line`.
    // And one on each for W9-S1, `move_cast_light` — where the thing a cast
    // light is on went, and whether it is covered. And two on each for W9-S2:
    // `declare_wind` and `declare_ending`, the room's weather and the table's
    // word that a printed cause happened. And one on each for W9-S3,
    // `draw_rope`, and one more on the DM's alone, `declare_portal_height`.
    // And one on the DM's alone for E-L3, `declare_bones`.
    // And one on each for E-L2, `expose_to_fire`.
    // And one on the DM's alone for E-L2's owner rulings, `declare_plants`.
    // And one on the DM's alone for E-L1, `declare_contact`.
    expect(toolSchemas(player())).toHaveLength(101);
    expect(toolSchemas(dm())).toHaveLength(137);
    // Re-pinned 2026-09-24 for the printed-lines track, which opened one door
    // on the DM's surface alone: `teleport_printed_line` takes the teleport a
    // stat block prints, at the distance the block prints, to a space the DM
    // names — which is the same decision `force_printed_save`'s head count is,
    // and the reason neither is on a model's surface. One pin on the DM
    // surface and none on the player's; the lengths sum with whatever the
    // other tracks of this batch moved.
    // Eight tracks moved these pins on one night; each move is recorded above
    // and the pins are the sum of them all.
    // Re-pinned again for the bookkeeping spells track: `cast_spell.object` (the
    // eighth stated fact — Remove Curse's attunement, Heat Metal's object) and
    // the Command word's slot grew both surfaces by the same amount.
    // And again for the branch track: `cast_spell.option` (the tenth stated
    // fact — SRD Command's five words, Thaumaturgy's six wonders,
    // Enlarge/Reduce's two halves) is one field on one tool, so both surfaces
    // grew by the same amount and neither gained a tool.
    // Re-pinned again for the bestiary traits track: `end_turn.burns` — the
    // creatures a Fire Aura's holder chooses to burn, `fought`'s twin, on the
    // one tool both surfaces publish — grew both by the same amount.
    // And again for the consent track, twice. First `cast_spell.willing`, the
    // ninth stated fact, on both surfaces and by the same 719 characters; then
    // the two a **later action** states — `activate_spell.altitude` and the
    // three spellings of `towards` — by the same 1,611. The tool count is
    // unmoved by either: both are fields on calls that already existed.
    // Re-pinned again for the stat-block Reactions track, which opened one
    // door on **both** surfaces: `take_attack_reaction` answers a hit whose
    // damage is unrolled — SRD Parry, at the instant *Shield* answers — and it
    // is on both for the reason `take_damage_reaction` is, because the
    // creature answering is whoever was hit. One pin each and the same 802
    // bytes on both, which is the tool being published once.
    // Re-pinned again for the cast-line track, which opened one more door on
    // the DM's surface alone: `cast_printed_line` casts one of the spells a
    // stat block prints on a line, at the heading's price and through the
    // block's own numbers — and *which* spell off a menu of four is the same
    // decision `teleport_printed_line`'s destination is, which is why neither
    // is on a model's surface. One more pin on the DM surface and none on the
    // player's; the lengths sum with whatever the other tracks moved.
    // Re-pinned for the two Pacts: `order_summons_attack` is a new door on
    // both surfaces — SRD Pact of the Chain's "forgo one of your own attacks
    // to allow your familiar to make one attack of its own", which is the only
    // way a familiar attacks at all — and two descriptions grew: the weapon
    // `activate_feature` may now **conjure** rather than find, and the third
    // span `extend_feature` refuses. One tool on each surface; the lengths sum
    // with whatever the other tracks of this batch moved.
    // And again for the elected-reroll track: `attack.reroll` and
    // `attack.reroll_damage` on the player's surface, `ability_check.reroll`
    // and `saving_throw.reroll` on the DM's. Four fields on three tools that
    // already existed, so neither count moves — the player's grew by 3,883 and
    // the DM's by 8,058, because `attack` is published on both doors and the
    // two checks are the DM's alone.
    // And again for the curses track: one sentence on `activate_spell`'s
    // description, because two spells (Hex, Hunter's Mark) now offer a later
    // Bonus Action through it and nothing told a model so — the same 181
    // bytes on both surfaces, no tool added.
    // Re-pinned again for the area-standing track: `cast_spell.chosen`, the
    // eleventh stated fact — SRD Pass without Trace’s “you and each creature
    // you choose”, which is the designation with its polarity turned over — is
    // one field on one tool, so both surfaces grew by the same 482 characters
    // and neither gained a tool; `ready.response.chosen` is the same field on
    // the door that holds a spell rather than casts one, and grew both by the
    // same 95, because a readied casting states the facts a cast one does.
    // And again for the forms track: `shape_shift_printed_line` and the Roper's
    // reel door are two more pins on the DM's surface alone — the form a block
    // prints and which creatures are reeled are the DM's decisions — for 3,358
    // bytes; the player's surface is untouched.
    // And again for the odds-and-ends spells track: `cast_spell.endsAfterTrigger`
    // (Magic Mouth's stated ending) and a new `end_spell_on_self` door on both
    // surfaces (Gaseous Form's target ending its own cloud at the price the
    // book charges) — one tool and 1,504 bytes on each.
    // And again for the webs-and-wounds track: `extinguish_fire` on both
    // surfaces — a creature's own action against its own fire, no number in
    // it — one tool and 596 bytes on each.
    // And again for the barriers-and-wards track: `cast_spell.types`, the
    // creature types a casting states where a spell prints "choose one or
    // more" — SRD Magic Circle's — is one field on one tool published on both
    // doors, so both surfaces grew by the same 488 characters and neither
    // gained a tool.
    // Re-pinned 2026-09-25 for the saves-and-a-Strength-drained track, on the
    // DM's surface alone: `force_printed_save.object` (the worn or held thing
    // SRD Rust Monster's Antennae is aimed at — a creature may be wearing mail
    // and holding a sword, and which the antennae touch is the table's) and
    // one new door, `take_legendary_action` (whom a Charging Horn strikes or
    // a Shimmering Shield covers, at a moment nobody else can act in). One
    // tool and 1,792 bytes on the DM's; the player's is untouched, because
    // both decisions are the table's the way a Cone's head count is.
    // Re-pinned for the second-place track, which opened four doors on the
    // model's surface and so on both: `return_from_elsewhere` (a creature
    // brought back to a space the caller names, once its way back is open),
    // `climb_into_space` (SRD Rope Trick's rope), and `dismiss_familiar` /
    // `recall_familiar` (SRD Find Familiar's pocket dimension, both the
    // summoner's Magic action) — and one field on a tool both already
    // publish: `end_turn.returns`, where a Blink caster stands when their
    // turn begins. No number in any of them: every one is a placement on the
    // lattice or a creature named. Four pins on each surface, and the lengths
    // move by the same amount on both because every tool is published once.
    // And two more on the DM's surface alone, for the bestiary's two roads
    // into the same place: `swallow_printed_line` (whom a frog swallows out
    // of the creatures it holds is the frog's decision) and
    // `shift_plane_printed_line` (the Phase Spider's jaunt, the Nightmare's
    // stride, the Ghost's Etherealness, out and back by one line).
    // And again for the compulsions track: `cast_spell.optionByTarget`, the
    // branch per creature SRD Calm Emotions' "(choose for each creature)"
    // asks for — one field on a tool both doors publish, so both lengths move
    // by the same 769 bytes and no tool count moves.
    // And one door on the DM's surface alone: `trigger_glyph`, the decision
    // that a glyph's invented trigger has occurred — a caster does not decide
    // whether the thief stepped on their own rune, so a model playing holds
    // no such door. One tool on one surface; the model's pins do not move.
    // And `activate_spell.option`, the word a re-choosing Magic action speaks —
    // SRD Alter Self — on a tool both doors publish: 340 bytes each.
    // Re-pinned 2026-09-25 for the standing-up track, on both doors at once:
    // `stand_up` is a creature's own movement and carries no number, so it is
    // the player's door and therefore the DM's too. One tool and the same
    // bytes on each.
    // And `cast_spell.bonesAt` for the bond track — SRD Animate Dead's piles of
    // bones as stated placements, one field on a tool both doors publish, so
    // both lengths move by the same bytes and no tool count moves.
    // Re-pinned for the moves-a-line-makes track: `move_printed_line` on the
    // DM's alone (a move through other creatures' spaces with a save per
    // space entered — whose route is the monster's decision), `viaFrom` /
    // `viaTo` on `teleport_printed_line`, and `using_line` on `move` for both.
    // Re-pinned 2026-09-26 for the ground-move-and-bond track (W7-S19), on
    // both doors at once: `command_summons` — SRD Unseen Servant's Bonus
    // Action, a placement and at most the caller's words for an object, so the
    // player's door and therefore the DM's — plus two fields on tools both
    // already publish: `move.alongSurface` (SRD Levitate's surface within
    // reach, a fact about the room) and `cast_spell.otherPlane` (SRD Sending's
    // recipient elsewhere, a fact and never a number). One tool and the same
    // bytes on each; the lengths sum with whatever the other tracks of this
    // wave moved.
    // Re-pinned for the activations track (W7-S18), on both doors at once and
    // with no new tool: `activate_spell.at` (a template drawn again at a
    // stated point — SRD Call Lightning), `cast_spell.inAStorm` (the first
    // stated fact about the world), `cast_spell.deliveredBy` (SRD Find
    // Familiar's touch) and `move.also_moves` (SRD Conjure Animals' pack).
    // Re-pinned for the economy track (W7-S20): `ability_check.findingCreature`
    // — the creature a Perception or Survival check is made to find, SRD
    // Hunter's Mark's purpose — on the DM's door alone; the player's is
    // untouched.
    // Re-pinned for the insides-and-holds track — W7-B10: `escape_from_inside`
    // and `pull_out_of_creature` on both surfaces (a creature's own way out of
    // the creature holding it inside, and a neighbour's), and `landings` on
    // the DM's `move_printed_line` for a line whose success steps clear;
    // `move.carrying` on both (SRD Grappled's "drag or carry you", whom and
    // to which space beside the grappler); and `target` on the DM's
    // `pull_printed_line` for the Ettercap's one webbed creature.
    // And for W7-S21 part 4: `attempt_effect_check.skill` (SRD Spike
    // Growth's "Perception or Survival" — the attempter's pick) on both doors;
    // part 2: `cast_spell.stores` (SRD Glyph of Warding's spell glyph, with the
    // stored spell's own `slotKind`) on both doors, and `trigger_glyph.by` —
    // who set it off — on the DM's; part 3: `borrow_senses` (SRD Find
    // Familiar's Bonus Action, the third door on the kept bond) on both.
    // And for the honesty pass — W7-B13: no schema grew and no tool was
    // added; six DM descriptions were reworded because what they promised
    // stopped being true. `take_printed_action` no longer hands over a line
    // whose save the engine reads (it refuses `line_has_its_own_door`), so it
    // and `take_printed_bonus_action` say so, the four printed-line doors that
    // pointed at them as "the other door for this line" stop doing so, and
    // `force_printed_save` says it measures a one-creature reach (and the sight
    // the line needs) and marks what a line files for the table. The DM's door
    // alone; +943 bytes.
    // Re-pinned for the wand door (treasure T-C1): `cast_spell.item` and
    // `cast_spell.charges` — the magic item a spell is cast from and how many
    // of its charges go, which `CastSpellRequest` has carried since the
    // casting route landed and no tool declared — and `use_item`'s description
    // and target, which now say an item may reach further than five feet. Two
    // fields and two descriptions on tools both doors publish: 1,696 bytes on
    // each, and no tool added.
    // Re-pinned for W8-T2: `take_opportunity_attack` gains `action` (a line
    // the reactor's own stat block prints, which `OpportunityCommand` has
    // carried since the owner's 2026-09-20 ruling and no tool declared),
    // `weapon` accepts null for an Unarmed Strike asked for on purpose, and
    // the description says what omitting both does — a monster's best printed
    // melee attack, a character's Unarmed Strike. One tool both doors
    // publish: 751 bytes on each, and no tool added.
    // And for I-E9, the DM's door alone: `printed_line_catch` added (who
    // a printed line would catch, aimed so — free and read-only), and
    // `force_printed_save` gains the same five aim fields and a description
    // saying a caller gives the aim or the head count, never both. 123 → 124
    // tools; +3,774 bytes. The player's surface is unchanged.
    // Re-pinned for W8-T3: `take_damage_response` takes W8-T2's three asks —
    // `action` (a line the stat block the reactor wears prints, which
    // `DamageResponseCommand` has carried since the 2026-09-20 ruling and no
    // tool declared), `weapon` accepting null for an Unarmed Strike on
    // purpose, and a description that no longer says omitting the weapon is
    // an Unarmed Strike, which was false for a creature wearing a block. One
    // tool both doors publish: 600 bytes on each, and no tool added.
    // And for W7-B12, the DM's door alone: `take_rest_form` (the form a block
    // offers at a Long Rest's end), `settle_block_deadlines` (the die a
    // block's own day owes) and `split_printed_line` (the ooze's Split) added,
    // and `cast_printed_line`'s description names the trait a coven casts
    // through. 124 → 127 tools; +3,750 bytes. The player's surface is
    // unchanged.
    // And for W9-S1, both doors: `move_cast_light` added after
    // `declare_light` (a cast light moved with its object or covered, the
    // casting's identity kept). 96 → 97 and 127 → 128 tools; +1,622 bytes on
    // each.
    // And for W9-R, `borrow_senses`' description: a familiar's senses are
    // used from where the familiar is and are not the caster's own (the
    // owner's option B). One tool both doors publish: 124 bytes on each, and
    // no tool added.
    // And for W9-S2, on both doors: `declare_wind` and `declare_ending` added
    // after `end_ongoing_spell`, and `activate_spell` gains `errand` — SRD
    // Detect Thoughts' Sense Thoughts and Read Thoughts. 96 → 98 and 127 →
    // 129 tools; +2,459 bytes on each.
    // And for W9-S3: `draw_rope` added on both doors (a creature inside SRD
    // Rope Trick's space pulls the rope up or lets it down), and
    // `climb_into_space` and `return_from_elsewhere` say what now gates them —
    // the portal at the rope's top and its drawn rope, and Magic Circle's save
    // on a return from the Ethereal Plane. 96 → 97 tools on the player's door;
    // +1,563 bytes on each. And the DM's alone: `declare_portal_height` (how
    // high the rope rose, a fact about the room the §10 falling ruling keeps
    // off a model's door), 127 → 129 tools; +2,373 bytes in all.
    // And for W9-T, `placementSchema.feet` says it is the distance from the
    // anchor where the creature ends up and not the distance moved — a model
    // read it as the walk. Fifty-one bytes wherever a placement is published:
    // +867 on the player's door and +1,173 on the DM's, no tool added.
    // And for E-STABLE: `move.forced` taken off the player's door (a forced
    // move is imposed by somebody else, so a creature could call its own walk
    // one) and given to the DM as `force_move`; `move.using_grant` and
    // `stabilise_creature` say what changed — the first that a forced move is
    // somebody else's (naming no tool the player's door lacks), the second the
    // 1d4-hour wake the engine now throws. 132 → 133 tools on
    // the DM's door; +10 bytes on the player's and +1,872 on the DM's.
    // And for E-AIM: `cast_spell.at` takes a placement beside the raw point —
    // an `anyOf` of the strict point and `spellPointPlacementSchema`, whose
    // bearing is asked for rather than swept — on both doors, +929 bytes each;
    // `eligible_targets` takes the same `at` and the same three directions, so
    // the catch can be read before the cast with the arguments the cast will
    // carry, +1,253 each; and `ability_check.tool` on the DM's alone, +509. No
    // tool added: +2,182 on the player's door and +2,691 on the DM's.
    // And for E-L3, the last level-5 spells' creatures and lasting magic. On
    // both doors: `cast_spell.rider` (SRD Phantom Steed's chosen rider) and
    // `cast_spell.hitDice` (SRD Prayer of Healing's Short Rest), with
    // `bonesAt` and `types` saying what now reads them, +1,590;
    // `command_summons.also` and `.order` (SRD Animate Dead's order, one
    // Bonus Action for every creature given it), +871; and
    // `settle_area_effects.spare` (SRD Conjure Animals' "you can force"), +824.
    // On the DM's alone: `declare_bones` (a pile of bones in the room, a new
    // door), +1,291 and its separator, and `trigger_glyph` saying who sets off
    // a refined glyph, +326. 133 → 134 tools on the DM's door; +3,285 bytes on
    // the player's and +4,903 on the DM's.
    // And for E-L1: `cast_spell.choiceByTarget` (SRD Enhance Ability's "a
    // different ability for each target") and a sentence on `cast_spell.choice`
    // pointing at it, on both doors, +988 each. And `cast_spell.object` says
    // Remove Curse takes it or not, and only a cursed item (SRD Remove Curse's
    // object form), +173 each. And `cast_spell.magicalEffect` (SRD Dispel
    // Magic's "or magical effect", a running casting by its id), +501 each.
    // Both together: +4,947 on the player's door and +6,565 on the DM's.
    // And for E-L1's second part: `attack.ifWarded` and `cast_spell.ifWarded`
    // (SRD Sanctuary's fallback, owner's ruling of 2026-10-03), +1,358 on each
    // door. And for SRD Heat Metal (owner's answers of 2026-10-03):
    // `cast_spell.object` says a thing that is not metal is refused and that
    // a declared object may be the target, +185 on each door; and on the DM's
    // alone `declare_contact` (who is touching a declared object, a new
    // door), +979 with its separator. 134 → 135 tools on the DM's door;
    // +185 bytes on the player's and +1,164 on the DM's. And Sanctuary's
    // fallback on every other door that aims a swing or a spell at a creature
    // the caller picks: `order_summons_attack.ifWarded` and
    // `release_ready.ifWarded` on both doors, +1,220; `cast_printed_line` and
    // `take_legendary_action` on the DM's alone, +1,220. No tool added.
    // And for E-L2: `cast_spell.alsoAt` (SRD Dancing Lights' lights 2 to 4,
    // placed where the caster names) and `activate_spell.alsoTo` (the Bonus
    // Action moving them by number) on both doors. No tool added: +1,532 bytes
    // on each. And `expose_to_fire` on both doors — the table's word that a
    // Cube of SRD Web met fire, which the engine then burns for the round the
    // spell prints. One more tool on each door (100 → 101 on the player's, and
    // 134 → 135 on the DM's after E-L3); +1,187 bytes on each.
    // And E-L2's owner rulings (2026-10-03), on both doors: `declare_light.flame`
    // (a torch or a lantern, which SRD Gust of Wind and Sleet Storm put out),
    // `cast_spell.exclude` (SRD Plant Growth's areas the caster leaves out) and
    // `settle_area_effects` naming the lantern's throw it settles, +1,346 bytes
    // on each. On the DM's alone: `declare_plants` (where normal plants grow,
    // a new door), 135 → 136 tools and +1,363 more bytes.
    // E-L1 and E-L2 merged (2026-10-03): the deltas sum, E-L1 having added
    // +4,425 bytes on the player's door and +6,624 on the DM's since E-L3.
    expect(toolSchemas(player())).toHaveLength(101);
    expect(toolSchemas(dm())).toHaveLength(137);
    expect(JSON.stringify(toolSchemas(player())).length).toBe(179328);
    expect(JSON.stringify(toolSchemas(dm())).length).toBe(244213);
  });
});

describe('openAiTools', () => {
  it('wraps each schema in the function-calling envelope and nothing else', () => {
    const wrapped = openAiTools(player());
    const bare = toolSchemas(player());
    expect(wrapped).toHaveLength(bare.length);
    for (const [index, one] of wrapped.entries()) {
      expect(one.type).toBe('function');
      expect(one.function.name).toBe(bare[index]!.name);
      expect(one.function.description).toBe(bare[index]!.description);
      expect(JSON.stringify(one.function.parameters)).toBe(JSON.stringify(bare[index]!.parameters));
      expect(Object.keys(one).sort()).toEqual(['function', 'type']);
      expect(Object.keys(one.function).sort()).toEqual(['description', 'name', 'parameters']);
    }
  });

  it('wraps the DM’s surface the same way', () => {
    expect(openAiTools(dm()).map((one) => one.function.name)).toEqual(
      dm().tools.map((one) => one.name),
    );
  });
});
