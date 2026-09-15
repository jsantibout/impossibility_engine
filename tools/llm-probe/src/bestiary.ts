/**
 * The SRD bestiary, as authoritative content the surface can consult.
 *
 * The engine is pure and may not read a file, so `adaptMonster` takes a
 * `Monster` its caller supplies and there is no `MONSTER_INDEX` to mirror
 * `SPELL_INDEX`. That purity is the right boundary and this is where it is
 * legitimately crossed: a tool surface is not the engine, and reading the
 * vendored markdown once at startup is exactly what `monster.test.ts` already
 * does.
 *
 * **Why this file exists at all.** The live experiment found the engine asking
 * a language model what a Goblin Warrior is. The fact was never missing — the
 * parser had it — but nothing between the parser and the creature record
 * carried it. Content is authoritative; a creature built from a stat block
 * must be built from *this*, not from whatever the model believes.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseMonsters, type Monster } from '@ie/srd';
import { SRD_CONTENT } from '@ie/content';

const RAW = fileURLToPath(new URL('../../../packages/srd/raw/monsters-A-Z.md', import.meta.url));

let cache: readonly Monster[] | null = null;

/** Every stat block the SRD prints, parsed once. */
export function bestiary(): readonly Monster[] {
  cache ??= parseMonsters(readFileSync(RAW, 'utf8'), 'monsters-A-Z.md').items;
  return cache;
}

/** A stat block by its slug — `goblin-warrior`, `ogre`. */
export function monsterFor(id: string): Monster | null {
  return bestiary().find((m) => m.id === id) ?? null;
}

/**
 * A stat block by the name a creature record carries.
 *
 * Used to recover facts about a creature that was spawned from content but
 * whose record does not store which stat block it came from — its size, for
 * instance, which lives on a `Placement` rather than on the creature. Names
 * are unique in the SRD bestiary, which is what makes this safe; it returns
 * null rather than guessing when nothing matches.
 */
export function monsterNamed(name: string): Monster | null {
  return bestiary().find((m) => m.name === name) ?? null;
}

/**
 * The catalogue weapons a stat block's actions name.
 *
 * A Goblin Warrior prints `Scimitar` and `Shortbow`, and `resolveAttack`
 * refuses a weapon the attacker does not own — so a goblin spawned without
 * them fights with its fists, which is what the live experiment recorded for
 * an entire four-round fight.
 *
 * Matching is an exact slug match against the equipment catalogue and nothing
 * cleverer. An action the catalogue does not know (`Nimble Escape`, a breath
 * weapon, a spellcasting block) is simply not a weapon and is skipped; the
 * action names are surfaced to the DM separately so a ruling can still be made
 * about them. Guessing here would arm creatures with things the SRD never gave
 * them, which is the failure this whole pass is about, pointed the other way.
 */
export function weaponsOf(monster: Monster): readonly string[] {
  const slugs = monster.actions.map((action) =>
    action.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, ''),
  );
  return slugs.filter((slug) => {
    const item = SRD_CONTENT.item(slug);
    return item !== null && item.weapon !== null && item.weapon !== undefined;
  });
}

/** What a stat block can do, for a DM deciding how to run it. */
export function actionNamesOf(monster: Monster): readonly string[] {
  return monster.actions.map((a) => a.name);
}
