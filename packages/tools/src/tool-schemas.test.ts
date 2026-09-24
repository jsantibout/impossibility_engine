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
    expect(toolSchemas(player())).toHaveLength(85);
    expect(toolSchemas(dm())).toHaveLength(107);
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
    expect(toolSchemas(player())).toHaveLength(85);
    expect(toolSchemas(dm())).toHaveLength(107);
    expect(JSON.stringify(toolSchemas(player())).length).toBe(128636);
    expect(JSON.stringify(toolSchemas(dm())).length).toBe(164146);
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
