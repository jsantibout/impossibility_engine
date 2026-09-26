import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { createCampaign, createDmSurface, createSurface } from '@ie/tools';
import { toolSchemas } from '../tool-schemas.js';

/**
 * The door that sets off a glyph.
 *
 * SRD Glyph of Warding: "You decide what triggers the glyph when you cast the
 * spell." The trigger is fiction the caster invented — a footfall, a book
 * opened, a word spoken — and the engine holds nothing it could read it from,
 * so whether it occurred is a decision the rules leave open, which is the
 * DM's door's whole criterion. Everything after the decision is the engine's:
 * `trigger_glyph` names the casting and nothing else, and the Sphere, the
 * saves, the dice and the ending are all the record's.
 */
describe('trigger_glyph', () => {
  const campaign = () => createCampaign({ content: SRD_CONTENT, seed: 'the-vault' });

  it('is on the DM’s door and not on the model’s', () => {
    const dm = createDmSurface(campaign());
    const player = createSurface(campaign());
    expect(toolSchemas(dm).some((tool) => tool.name === 'trigger_glyph')).toBe(true);
    expect(toolSchemas(player).some((tool) => tool.name === 'trigger_glyph')).toBe(false);
  });

  it('refuses a casting that is not running, and states no number', () => {
    const dm = createDmSurface(campaign());
    const out = dm.call({ tool: 'trigger_glyph', input: { castingId: 'cast:9' }, commandId: 'toolu_1' });
    expect(out.status).not.toBe('ok');
    expect(JSON.stringify(out)).toContain('not_ongoing');
  });
});
