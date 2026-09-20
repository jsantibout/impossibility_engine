/**
 * `@ie/content` — the SRD 5.2.1 catalogue, as engine content.
 *
 * Everything here is data written against the vocabulary `@ie/engine`
 * declares, and it reaches the engine through `createContent` — the same
 * door a homebrew catalogue goes through, running the same checks. The
 * engine holds no catalogue of its own: a campaign supplies one, and this is
 * the one the SRD supplies.
 *
 * `SRD_CONTENT` is built once, at import, and a transcription error in it is
 * a programmer error rather than a table's mistake, so it throws here rather
 * than returning a refusal a caller would have to remember to check.
 */
import { expect } from '@ie/shared';
import { createContent, type Content } from '@ie/engine';
import { MONSTERS, SPELL_INDEX } from '@ie/srd';
import { BARBARIAN, BARBARIAN_SUBCLASSES } from './classes/barbarian.js';
import { BARD, BARD_SUBCLASSES } from './classes/bard.js';
import { CLERIC, CLERIC_SUBCLASSES } from './classes/cleric.js';
import { DRUID, DRUID_SUBCLASSES } from './classes/druid.js';
import { FIGHTER, FIGHTER_SUBCLASSES } from './classes/fighter.js';
import { MONK, MONK_SUBCLASSES } from './classes/monk.js';
import { PALADIN, PALADIN_SUBCLASSES } from './classes/paladin.js';
import { RANGER, RANGER_SUBCLASSES } from './classes/ranger.js';
import { ROGUE, ROGUE_SUBCLASSES } from './classes/rogue.js';
import { SORCERER, SORCERER_SUBCLASSES } from './classes/sorcerer.js';
import { WARLOCK, WARLOCK_SUBCLASSES } from './classes/warlock.js';
import { WIZARD, WIZARD_SUBCLASSES } from './classes/wizard.js';
import { SRD_ITEMS } from './items.js';
import {
  ALIGNMENTS,
  BACKGROUNDS,
  EPIC_BOON_FEATS,
  FIGHTING_STYLE_FEATS,
  GENERAL_FEATS,
  LANGUAGES,
  ORIGIN_FEATS,
  SPECIES,
} from './origins.js';
import { SPELL_DEFINITIONS } from './spells.js';

export * from './spells.js';
export * from './origins.js';
export * from './items.js';
export * from './classes/barbarian.js';
export * from './classes/bard.js';
export * from './classes/cleric.js';
export * from './classes/druid.js';
export * from './classes/fighter.js';
export * from './classes/monk.js';
export * from './classes/paladin.js';
export * from './classes/ranger.js';
export * from './classes/rogue.js';
export * from './classes/sorcerer.js';
export * from './classes/warlock.js';
export * from './classes/wizard.js';

/** Every class the SRD publishes, in the order the book prints them. */
export const SRD_CLASSES = [
  BARBARIAN,
  BARD,
  CLERIC,
  DRUID,
  FIGHTER,
  MONK,
  PALADIN,
  RANGER,
  ROGUE,
  SORCERER,
  WARLOCK,
  WIZARD,
] as const;

/** Every subclass the SRD publishes — one per class. */
export const SRD_SUBCLASSES = [
  ...BARBARIAN_SUBCLASSES,
  ...BARD_SUBCLASSES,
  ...CLERIC_SUBCLASSES,
  ...DRUID_SUBCLASSES,
  ...FIGHTER_SUBCLASSES,
  ...MONK_SUBCLASSES,
  ...PALADIN_SUBCLASSES,
  ...RANGER_SUBCLASSES,
  ...ROGUE_SUBCLASSES,
  ...SORCERER_SUBCLASSES,
  ...WARLOCK_SUBCLASSES,
  ...WIZARD_SUBCLASSES,
] as const;

/** The whole SRD catalogue as the engine's input, before validation. Exported so a test can prove it round-trips as JSON. */
export const SRD_CONTENT_INPUT = {
  spells: SPELL_DEFINITIONS,
  spellEntries: SPELL_INDEX,
  classes: SRD_CLASSES,
  subclasses: SRD_SUBCLASSES,
  species: SPECIES,
  backgrounds: BACKGROUNDS,
  feats: [...ORIGIN_FEATS, ...GENERAL_FEATS, ...FIGHTING_STYLE_FEATS, ...EPIC_BOON_FEATS],
  items: SRD_ITEMS,
  languages: LANGUAGES,
  alignments: ALIGNMENTS,
  monsters: MONSTERS,
} as const;

/** The SRD 5.2.1 catalogue, validated. */
export const SRD_CONTENT: Content = expect(createContent(SRD_CONTENT_INPUT), 'the SRD catalogue');
