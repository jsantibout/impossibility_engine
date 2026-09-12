/**
 * Corrections for defects in the vendored markdown transcription.
 *
 * `packages/srd/raw/` is a third-party conversion of the SRD, and three of its
 * ability-score tables have collapsed cell boundaries — values merged into one
 * cell (`+10 +10`, `CON 29`) or dropped entirely. The parser refuses to guess
 * at a mangled table, because a silently wrong ability modifier is the worst
 * possible failure for a rules engine: it looks like a rules bug forever after.
 *
 * So the parser keeps failing loudly, and these overrides supply the correct
 * values. Every number below was read from the authority — the official
 * `SRD_CC_v5.2.1.pdf` (fetch with `npm run srd:fetch-reference`) — not
 * reconstructed from the damaged markdown.
 *
 * Per `raw/PROVENANCE.md`, corrections live here rather than as hand-edits to
 * the vendored files, so re-vendoring a newer upstream commit cannot quietly
 * reintroduce a defect.
 *
 * If upstream fixes one of these, its test in `monsters.test.ts` will say so.
 */

export interface AbilityBlock {
  readonly score: number;
  readonly modifier: number;
  readonly save: number;
}

export type AbilityOverride = Readonly<Record<string, AbilityBlock>>;

const block = (score: number, modifier: number, save: number): AbilityBlock => ({
  score,
  modifier,
  save,
});

export const ABILITY_OVERRIDES: Readonly<Record<string, AbilityOverride>> = {
  // SRD 5.2.1 p.341. Markdown drops the Str score cell and inserts a stray
  // "DEX" text cell in its place.
  "will-o-wisp": {
    str: block(1, -5, -5),
    dex: block(28, 9, 9),
    con: block(10, 0, 0),
    int: block(13, 1, 1),
    wis: block(14, 2, 2),
    cha: block(11, 0, 0),
  },

  // SRD 5.2.1, Ancient Red Dragon (CR 24, PB +7). Markdown merges MOD and SAVE
  // into single cells ("+10 +10") and leaks the next ability label into a value
  // cell ("CON 29").
  "ancient-red-dragon": {
    str: block(30, 10, 10),
    dex: block(10, 0, 7),
    con: block(29, 9, 9),
    int: block(18, 4, 4),
    wis: block(15, 2, 9),
    cha: block(27, 8, 8),
  },

  // SRD 5.2.1, Remorhaz (CR 11, PB +4). Same collapsed-cell defect.
  remorhaz: {
    str: block(24, 7, 7),
    dex: block(13, 1, 1),
    con: block(21, 5, 5),
    int: block(4, -3, -3),
    wis: block(10, 0, 0),
    cha: block(5, -3, -3),
  },
};
