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
    expect(toolSchemas(player())).toHaveLength(78);
    expect(toolSchemas(dm())).toHaveLength(95);
    expect(JSON.stringify(toolSchemas(player())).length).toBe(106941);
    expect(JSON.stringify(toolSchemas(dm())).length).toBe(127863);
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
