import { describe, expect, it } from 'vitest';
import { WEAPONS } from '@ie/srd';
import { checkContent, extendContent } from '@ie/engine';
import { SRD_CONTENT } from './index.js';

/**
 * What every SRD launcher fires — the link SRD Corrosive Form reads when "Nonmagical
 * ammunition is destroyed immediately after hitting the pudding" (M-MATTER).
 *
 * The reading is `FIRES` in `items.ts`: the Weapons table's word turned into
 * the Ammunition table's row. This file holds that every row printing the
 * property was read, and that "Bullet" — the one word naming two rows — was
 * read by the names.
 */
describe('the ammunition a launcher fires', () => {
  it('is stated on every row that prints the Ammunition property, and on no other', () => {
    for (const row of WEAPONS) {
      const fires = SRD_CONTENT.item(row.id)?.firesAmmunition;
      if (row.ammunitionType === null) {
        expect([row.id, fires]).toEqual([row.id, undefined]);
      } else {
        expect([row.id, typeof fires]).toEqual([row.id, 'string']);
        expect([row.id, SRD_CONTENT.item(fires!)?.kind]).toEqual([row.id, 'ammunition']);
      }
    }
  });

  it('reads each word as the row it names, and "Bullet" by the weapon', () => {
    const fires = (id: string) => SRD_CONTENT.item(id)?.firesAmmunition;
    expect(fires('longbow')).toBe('arrows');
    expect(fires('shortbow')).toBe('arrows');
    expect(fires('light-crossbow')).toBe('bolts');
    expect(fires('blowgun')).toBe('needles');
    expect(fires('sling')).toBe('bullets-sling');
    expect(fires('musket')).toBe('bullets-firearm');
    expect(fires('pistol')).toBe('bullets-firearm');
  });

  it('carries a magic launcher’s link from the row it is built on', () => {
    for (const item of SRD_CONTENT.items) {
      const row = item.weapon?.id;
      if (row === undefined || item.id === row) continue;
      expect([item.id, item.firesAmmunition]).toEqual([item.id, SRD_CONTENT.item(row)?.firesAmmunition]);
    }
  });

  it('refuses a link that reaches nothing, or reaches something that is not ammunition', () => {
    const bow = SRD_CONTENT.item('longbow')!;
    const codes = (firesAmmunition: unknown) =>
      checkContent({
        items: [
          ...SRD_CONTENT.items.filter((item) => item.id !== 'longbow'),
          { ...bow, firesAmmunition } as typeof bow,
        ],
      })
        .filter((problem) => problem.field === 'items[longbow].firesAmmunition')
        .map((problem) => problem.code);
    expect(codes('moonbeams')).toEqual(['unknown_item']);
    expect(codes('longsword')).toEqual(['not_ammunition']);
    expect(codes(7)).toEqual(['malformed_field']);
    expect(codes('arrows')).toEqual([]);
  });

  it('comes through the door homebrew uses', () => {
    const homebrew = extendContent(SRD_CONTENT, {
      items: [
        { ...SRD_CONTENT.item('longbow')!, id: 'thornbow', name: 'Thornbow', firesAmmunition: 'arrows' },
      ],
    });
    expect(homebrew.ok && homebrew.value.item('thornbow')?.firesAmmunition).toBe('arrows');
  });
});
