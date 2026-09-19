import { writeFileSync } from 'node:fs';
import { describe, it } from 'vitest';
import { MECHANICAL_MARKERS, printedUnitsOf, sentencesOf } from '../scripts/missing-shapes.js';

const WANT = (process.env['SCRATCH_SPELLS'] ?? '').split(',').filter((s) => s.length > 0);

describe('scratch', () => {
  it('prints', () => {
    const out: string[] = [];
    for (const id of WANT) {
      out.push('\n===== ' + id);
      for (const unit of printedUnitsOf(id)) {
        const m = MECHANICAL_MARKERS.filter(([, p]) => p.test(unit)).map(([k]) => k);
        out.push(`  [${m.join(',') || '-'}] ${unit}`);
      }
      out.push('  sentences: ' + sentencesOf(id).length);
    }
    writeFileSync(process.env['SCRATCH_OUT'] ?? 'scratch.txt', out.join('\n'), 'utf8');
  });
});
