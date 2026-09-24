/**
 * Putting a breakable thing in the room.
 *
 * One command, and it is a door in the sense `addCreature` is: every number it
 * writes is read out of content and pinned into the arrival, so the fold opens
 * nothing and a log replayed next year raises the same door.
 *
 * **The declaration is the creation.** There is no registry of objects a scene
 * had to be set up with, and that absence is the design rather than a
 * shortcut: a door exists because somebody described it and swung at it. What
 * a caller states is what the thing *is* — a name, a substance, a size,
 * whether it is flimsy — and every one of those is fiction. What the engine
 * states is what follows: the Armour Class, the hit points, the immunities and
 * the fact that it is destroyed rather than dying. That split is the same one
 * `addCreature` keeps when it takes a stat block's **id** rather than the
 * block, and it is why this tool can sit on a surface a model holds.
 *
 * See `objects.ts` for why an object is a stated sheet rather than a second
 * kind of target, and for the line between the tables (content) and the rule
 * beside them (the engine's).
 */

import { asCharacterId, type CharacterId, err, ok, type Result } from '@ie/shared';
import type { CreatureSize } from '@ie/srd/schemas';
import type { DamageDefenses } from '../attack.js';
import type { Content } from '../content.js';
import type { GameEvent, GameState } from '../events.js';
import { type CommandIdentity, once } from '../idempotency.js';
import {
  objectDefenses,
  objectSheet,
  OBJECT_CONDITION_IMMUNITIES,
  OBJECT_CREATURE_TYPE,
  OBJECT_DAMAGE_IMMUNITIES,
  type ObjectBuild,
} from '../objects.js';
import { creatureOf } from './command.js';

/**
 * A thing somebody has described, in the words the SRD's two tables are keyed
 * by.
 *
 * Nothing here is a mechanical number except {@link damageThreshold}, and that
 * one is a decision the rules leave open rather than an answer they give —
 * see its own note.
 */
export interface ObjectDeclaration {
  /** What to call it: "the oak door", "the sealed chest". Narration. */
  readonly name: string;
  /** Which substance, by its id in content: `wood`, `stone`, `iron`. */
  readonly material: string;
  /** How big, which is what the Object Hit Points table is keyed by. */
  readonly size: CreatureSize;
  /**
   * Which column of that table. SRD prints two numbers per size and no way to
   * tell which applies — a bottle and a lock are both Tiny — so the person
   * describing the thing is the one who says.
   */
  readonly build: ObjectBuild;
  /**
   * SRD "Breaking Objects": "Big objects, such as castle walls, often have
   * extra resilience represented by a damage threshold."
   *
   * **The book prints no table for it**, which is exactly what makes it the
   * DM's to state and not a number the engine owes. It is a DC-shaped fact:
   * the rules say such a thing exists and decline to say what it is. Absent is
   * every ordinary door, and absent means no threshold rather than one of
   * zero.
   */
  readonly damageThreshold?: number;
}

/**
 * Declare an object into the scene, with the numbers the book suggests.
 *
 * Three refusals, all of them wrong facts rather than missing ones — nothing a
 * caller could go and find out would make an absent table row present, which
 * is the same reading `addCreature` gives `unknown_monster`.
 *
 * Placing it is a separate command, exactly as it is for a monster. A declared
 * object that nobody has put on the map is in the game and out of every area,
 * which is what `creaturesInArea` already says about an unplaced creature.
 */
export function declareObject(
  state: GameState,
  content: Content,
  id: CharacterId,
  object: ObjectDeclaration,
  command: CommandIdentity = {},
): Result<GameEvent[]> {
  return once(state, `declare-object:${id}`, { ...command, object }, () => [], (stamp) => {
    if (creatureOf(state, id) !== null) {
      return err('already_present', `${id} is already in this game`);
    }

    const material = content.objectMaterial(object.material);
    if (material === null) {
      return err(
        'unknown_material',
        `${object.material} is not a substance this world holds, so there is no Armour Class to give ${id}`,
      );
    }

    const row = content.objectSize(object.size);
    if (row === null) {
      // SRD: "To track Hit Points for a Huge or Gargantuan object, divide it
      // into Large or smaller sections, and track each section's Hit Points
      // separately." Dividing is the GM's; inventing a number for the whole
      // castle wall here would be the engine doing it for them.
      return err(
        'unknown_object_size',
        `this world's Object Hit Points table has no row for a ${object.size} object — the book stops at Large and asks a bigger thing be broken into sections, each declared on its own`,
      );
    }

    if (
      object.damageThreshold !== undefined &&
      (!Number.isInteger(object.damageThreshold) || object.damageThreshold < 1)
    ) {
      return err(
        'bad_damage_threshold',
        `a damage threshold is a whole number of at least 1, not ${object.damageThreshold}`,
      );
    }

    const maxHp = object.build === 'fragile' ? row.fragile : row.resilient;

    return ok([
      {
        type: 'creature-added',
        id,
        name: object.name,
        sheet: objectSheet(material.armorClass, object.damageThreshold),
        maxHp,
        // SRD: "An object is destroyed when it has 0 Hit Points." No dying, no
        // death saves, no Unconscious — which is the field a monster already
        // arrives with and the reason nothing else here is new.
        diesAtZero: true,
        creatureType: OBJECT_CREATURE_TYPE,
        defenses: objectDefenses(material),
        conditionImmunities: OBJECT_CONDITION_IMMUNITIES,
        // Pinned so that placing it is not a second reading of what the caller
        // already said, exactly as a stat block's size is.
        size: object.size,
        ...(stamp === null ? {} : { command: stamp }),
      },
    ]);
  });
}

/**
 * What the engine calls a thing a **printed line** made.
 *
 * SRD Giant Spider's Web: the web is a thing in the room with its own Armour
 * Class and Hit Points, and somebody has to be able to name it to burn it.
 *
 * **Derived rather than minted**, which is the rule the engine already keeps
 * for the two other ids it issues: a summoned creature's is its casting's and
 * its stat block's (`summonedId`), and an item copy's is the count at the gain
 * (`itemInstanceFor`). There is no randomness here and no clock — a replay
 * raises the same web under the same name, and a retry of one command raises
 * no second one.
 *
 * The noun is the **line's own word**, so nothing here names a catalogue and a
 * homebrew line printing "cocoon" gets a cocoon. The spinner and the creature
 * caught are both in it because the sentence is about the pair: two spiders
 * webbing one victim leave two webs, and one spider webbing two victims leaves
 * two more. The count is the use, which is what tells this web from the one
 * the same spider spun last round.
 */
export const printedObjectId = (
  noun: string,
  by: CharacterId,
  target: CharacterId,
  use: number,
): CharacterId => asCharacterId(`${noun.replace(/\s+/g, '-')}:${by}:${target}:${use}`);

/**
 * A thing a **printed line** brings into being, with the numbers the line
 * prints.
 *
 * SRD Giant Spider's Web: "The target has the Restrained condition until the
 * web is destroyed (AC 10; HP 5; Vulnerability to Fire damage; Immunity to
 * Poison and Psychic damage)." SRD Ettercap's Web Strand is the same sentence
 * with Bludgeoning in the run.
 *
 * **{@link declareObject}'s sibling, and the split is where the numbers come
 * from.** A declared object is a substance and a size, and the engine answers
 * the Armour Class and the Hit Points off the SRD's two tables; a printed one
 * is a thing the book has already given numbers to, and reading a table for it
 * would be the engine overruling the page. So this takes them and pins them,
 * which is rule 5 pointed the same way as everywhere else: what a command read
 * out of content goes into the event, and the fold opens nothing.
 *
 * **The caller is the engine rather than a DM**, which is the whole of what is
 * new here. Every other object in the game exists because somebody described
 * it; this one exists because a creature spun it, and its id is derived from
 * the use that made it — see {@link printedObjectId}.
 *
 * **No size, deliberately.** The book prints none for a web, and a size
 * invented here would be a fact about the room nobody stated; a table that
 * wants to say how far the strands reach says it by placing the thing.
 */
export function raisePrintedObject(
  state: GameState,
  id: CharacterId,
  printed: {
    /** What to call it — the line's own noun, and whose it is. */
    readonly name: string;
    readonly armorClass: number;
    readonly hitPoints: number;
    readonly vulnerabilities?: readonly string[];
    readonly resistances?: readonly string[];
    readonly immunities?: readonly string[];
  },
): Result<GameEvent[]> {
  if (creatureOf(state, id) !== null) {
    return err('already_present', `${id} is already in this game`);
  }

  const defenses: Record<string, DamageDefenses> = {};
  for (const type of printed.vulnerabilities ?? []) defenses[type] = { vulnerable: true };
  for (const type of printed.resistances ?? []) defenses[type] = { resistant: true };
  // Immunity last, because it is the strongest of the three and the book never
  // prints one type under two headings — a line that did would be saying one
  // thing twice, and the stronger answer is the safe one to take.
  for (const type of printed.immunities ?? []) defenses[type] = { immune: true };
  // And the rule beneath the line, which every object has whatever its own
  // sentence says: SRD "Damage Types and Objects". The web prints both of them
  // itself; a homebrew line that printed neither still gets them.
  for (const type of OBJECT_DAMAGE_IMMUNITIES) defenses[type] = { immune: true };

  return ok([
    {
      type: 'creature-added',
      id,
      name: printed.name,
      sheet: objectSheet(printed.armorClass),
      maxHp: printed.hitPoints,
      diesAtZero: true,
      creatureType: OBJECT_CREATURE_TYPE,
      defenses,
      conditionImmunities: OBJECT_CONDITION_IMMUNITIES,
    },
  ]);
}
