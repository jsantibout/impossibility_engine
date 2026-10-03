import type { RangedLine } from '@ie/engine';

/**
 * The projectile table: what each SRD stat block's printed ranged line looses,
 * where the line is named after no catalogue weapon. (E-L2, the owner's ruling
 * of 2026-10-03: "a content table, decided once")
 *
 * SRD Wind Wall: "Arrows, bolts, and other ordinary projectiles launched at
 * targets behind the wall are deflected upward and miss automatically.
 * Boulders hurled by Giants or siege engines, and similar projectiles, are
 * unaffected."
 *
 * A line named after a catalogue weapon that is fired or thrown — a Scout's
 * Longbow, an Ogre's Javelin — looses that weapon and needs no row here. Every
 * other printed ranged line is decided once below, by the name it prints, with
 * the reading that decided it. The rule the rows follow:
 *
 * - **Ordinary**: an arrow, however it is described (a Gnoll's Bone Bow, a
 *   Wight's Necrotic Bow); a spike, a harpoon or a spear thrown by hand (a
 *   Manticore's Tail Spike, a Merrow's Harpoon); a dagger, however dark. A
 *   magic rider on the hit — fire, cold, necrotic, a charm — does not change
 *   what crossed the air, and a spear that "magically returns" was still a
 *   thrown spear on the way out.
 * - **Not ordinary**: what a Giant or something its size hurls (a Boulder, a
 *   Hammer Throw, a Trash Lob, an Earth Elemental's Rock Launch, all of which
 *   knock a creature down or hit like one), the book's "boulders … and similar
 *   projectiles"; and every line that is fire, light, force or energy rather
 *   than a thing (Hurl Flame, Radiant Flame, a Ray, a Bolt, a Burst), which is
 *   not a projectile at all.
 *
 * **Left out, and reported at the table instead**: a Frost Giant's Great Bow
 * (an arrow, from a bow a Giant draws — the book's carve-out is for what a
 * Giant hurls, and whether a Giant's arrow is "ordinary" is not a call the
 * text makes), a Solar's Flying Sword (a blade that flies by magic), and a
 * Treant's Hail of Bark (shards of a tree, neither an arrow nor a boulder).
 * None is CR 5 or lower. `ranged-lines.test.ts` holds this list against the
 * bestiary, so a new block's line is decided here or named there.
 */
export const SRD_RANGED_LINES: readonly RangedLine[] = [
  // — ordinary projectiles ——————————————————————————————————————————————————
  // Gnoll Warrior (CR 1/2): a bow; its arrows are arrows.
  { id: 'bone-bow', name: 'Bone Bow', ordinaryProjectile: true },
  // Sprite (CR 1/4): a tiny bow whose arrow charms on a hit.
  { id: 'enchanting-bow', name: 'Enchanting Bow', ordinaryProjectile: true },
  // Wight (CR 3): a longbow-range bow whose arrow carries necrotic damage.
  { id: 'necrotic-bow', name: 'Necrotic Bow', ordinaryProjectile: true },
  // Manticore (CR 3): "Tail Spike", piercing at 100/200 ft. — a flung spike,
  // the shape of a dart or a bolt.
  { id: 'tail-spike', name: 'Tail Spike', ordinaryProjectile: true },
  // Merrow (CR 2): a thrown harpoon, 20/60 ft. — a Spear's range.
  { id: 'harpoon', name: 'Harpoon', ordinaryProjectile: true },
  // Merfolk Skirmisher (CR 1/8): a thrown spear, 20/60 ft.
  { id: 'ocean-spear', name: 'Ocean Spear', ordinaryProjectile: true },
  // Salamander (CR 5): a thrown spear, 20/60 ft., that "magically returns".
  { id: 'flame-spear', name: 'Flame Spear', ordinaryProjectile: true },
  // Ice Devil (CR 14): a thrown spear, 30/120 ft.
  { id: 'ice-spear', name: 'Ice Spear', ordinaryProjectile: true },
  // Vampire Familiar (CR 3): a thrown dagger, 20/60 ft. — a Dagger's range.
  { id: 'umbral-dagger', name: 'Umbral Dagger', ordinaryProjectile: true },
  // Ape (CR 1/2): a hand-thrown rock, 25/50 ft. — a stone, not a boulder; the
  // book's carve-out is for what Giants and siege engines hurl.
  { id: 'rock', name: 'Rock', ordinaryProjectile: true },

  // — boulders and what a Giant hurls ————————————————————————————————————————
  // Stone Giant (CR 7): the book's own example.
  { id: 'boulder', name: 'Boulder', ordinaryProjectile: false },
  // Hill Giant (CR 5): what a Giant lobs.
  { id: 'trash-lob', name: 'Trash Lob', ordinaryProjectile: false },
  // Fire Giant (CR 9): a Giant's hurled hammer, which pushes its target 15 feet.
  { id: 'hammer-throw', name: 'Hammer Throw', ordinaryProjectile: false },
  // Earth Elemental (CR 5): rock launched hard enough to knock a Large
  // creature Prone — a boulder's work.
  { id: 'rock-launch', name: 'Rock Launch', ordinaryProjectile: false },

  // — fire, light, force and energy, which is no projectile ——————————————————
  // Barbed Devil (CR 5), Horned Devil, Efreeti.
  { id: 'hurl-flame', name: 'Hurl Flame', ordinaryProjectile: false },
  // Priest Acolyte (CR 1/4), Priest (CR 2).
  { id: 'radiant-flame', name: 'Radiant Flame', ordinaryProjectile: false },
  // Druid (CR 2): radiant damage, a wisp of light.
  { id: 'verdant-wisp', name: 'Verdant Wisp', ordinaryProjectile: false },
  // Dryad (CR 1): a burst of thorns the dryad's magic flings, made with its
  // spellcasting ability rather than a throw.
  { id: 'thorn-burst', name: 'Thorn Burst', ordinaryProjectile: false },
  // Mage, Archmage.
  { id: 'arcane-burst', name: 'Arcane Burst', ordinaryProjectile: false },
  // Lich.
  { id: 'eldritch-burst', name: 'Eldritch Burst', ordinaryProjectile: false },
  // Mummy Lord.
  { id: 'channel-negative-energy', name: 'Channel Negative Energy', ordinaryProjectile: false },
  // Iron Golem.
  { id: 'fiery-bolt', name: 'Fiery Bolt', ordinaryProjectile: false },
  // Stone Golem.
  { id: 'force-bolt', name: 'Force Bolt', ordinaryProjectile: false },
  // Spirit Naga.
  { id: 'necrotic-ray', name: 'Necrotic Ray', ordinaryProjectile: false },
  // Oni.
  { id: 'nightmare-ray', name: 'Nightmare Ray', ordinaryProjectile: false },
  // Drider.
  { id: 'poison-burst', name: 'Poison Burst', ordinaryProjectile: false },
  // Medusa.
  { id: 'poison-ray', name: 'Poison Ray', ordinaryProjectile: false },
  // Djinni.
  { id: 'storm-bolt', name: 'Storm Bolt', ordinaryProjectile: false },
  // Storm Giant.
  { id: 'thunderbolt', name: 'Thunderbolt', ordinaryProjectile: false },
  // Cloud Giant.
  { id: 'thundercloud', name: 'Thundercloud', ordinaryProjectile: false },
];
