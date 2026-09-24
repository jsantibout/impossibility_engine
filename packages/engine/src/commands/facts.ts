/**
 * Declaring a fact the engine could not see, so a refused command can be sent
 * again.
 *
 * A `ContextRequest` names the command that satisfies it; this is where those
 * commands live. Creature type is the durable one — declared once, and a
 * contradicting declaration is refused rather than absorbed.
 *
 * The three differ in how long what they say lasts, and each says which: a
 * creature's type is permanent, a patch of Difficult Terrain stands until the
 * ground changes, and a fall is **momentary** — one instant, closed by the
 * turn or the clock, with nothing to take back.
 */

import { type CharacterId, DAMAGE_TYPES, err, ok, type Result } from '@ie/shared';
import { type GameEvent, type GameState } from '../events.js';
import { type CommandIdentity, once } from '../idempotency.js';
import {
  DIFFICULT_TERRAIN,
  declareDifficultPatch,
  declareLightPatch,
  declareObscuringPatch,
  lightDispelledBy,
  type LightLevel,
  type ObscurementDegree,
  type TerrainRegion,
} from '../positioning.js';
import { creatureOf, sceneFor, unknownCreature } from './command.js';

/**
 * Establish a creature's type, once.
 *
 * The authoritative path for a fact `resolveSpell` has been asking for by
 * name: Hold Person wants "a Humanoid", the request said which event would
 * settle it, and nothing produced that event — so the layer above wrote one
 * into the log by hand. That is narration writing directly to truth, which is
 * the first thing docs/IMPOSSIBILITY_ENGINE_DOCTRINE.md forbids.
 *
 * Two rules, both from the doctrine's sixth invariant. **Fiction may supply
 * a fact**: a creature nobody has typed takes the type it is given. **Fiction
 * may not overwrite established truth**: a creature already typed — by its
 * stat block, its species, or an earlier declaration — refuses a different
 * one, because a spell may already have been cast on the strength of it.
 * Declaring the same type again emits nothing; completing the record adds a
 * fact, it never restates the world.
 *
 * The refusal is a verdict rather than homework: the fact is *known*, and the
 * caller is contradicting it. A DM who genuinely misspoke has no path here to
 * take it back, deliberately — a retcon facility would need its own event
 * and its own audit trail, and inventing one for a case nobody has hit yet is
 * the kind of abstraction the doctrine says to wait for.
 */
export function declareCreatureType(
  state: GameState,
  id: CharacterId,
  creatureType: string,
  command: CommandIdentity = {},
): Result<GameEvent[]> {
  return once(state, `declare-type:${id}`, { ...command, creatureType }, () => [], (stamp) => {
    const creature = creatureOf(state, id);
    if (creature === null) return unknownCreature(id);

    if (creature.creatureType === creatureType) return ok([]);
    if (creature.creatureType !== null) {
      return err(
        'type_established',
        `${id} is already established as ${creature.creatureType}; a declaration cannot make them ${creatureType}`,
      );
    }

    return ok([
      { type: 'creature-type-declared', id, creatureType, ...(stamp === null ? {} : { command: stamp }) },
    ]);
  });
}

/**
 * Say which damage type a stat block left to the table.
 *
 * SRD Half-Dragon's Draconic Origin: "The half-dragon is related to a type of
 * dragon associated with one of the following damage types **(GM's choice)**:
 * Acid, Cold, Fire, Lightning, or Poison. This choice affects other aspects of
 * the stat block." Two of those aspects are lines with dice on them — the
 * Claw's second component and the Dragon's Breath — and the parser reads both
 * with `declared` where a type would be, because a type nobody has stated is
 * not a type.
 *
 * **A ruling the engine records, not a number it takes.** This is the same
 * shape `declareCreatureType` is and the opposite of a caller supplying a die
 * face: the amount is the book's, the dice are `rolls.ts`'s, and what is left
 * is a word the block declined to print. `declare_heads` is the precedent the
 * DM's door already carries, and the owner's line about it holds here word for
 * word — a fact the *table* states is a fact.
 *
 * **Bounds-checked exactly once**, on the word being a damage type at all. The
 * five the Half-Dragon offers are its own prose and nothing parsed them, so a
 * list here would be this command holding a catalogue; what it may not do is
 * let "sunshine" through into a damage component nothing downstream knows.
 *
 * **Re-declarable**, which is `declareDifficultTerrain`'s rule rather than
 * `declareCreatureType`'s. A creature's type is what it *is* and refusing a
 * contradiction protects a spell already cast on the strength of it; this is a
 * choice about a block that printed five types and chose none, and a DM who
 * reuses an id for the next half-dragon is describing a different dragon
 * rather than rewriting a fact.
 */
export function declareDamageType(
  state: GameState,
  id: CharacterId,
  damageType: string,
  command: CommandIdentity = {},
): Result<GameEvent[]> {
  return once(state, `declare-damage-type:${id}`, { ...command, damageType }, () => [], (stamp) => {
    const creature = creatureOf(state, id);
    if (creature === null) return unknownCreature(id);

    const word = damageType.toLowerCase();
    if (!DAMAGE_TYPES.some((known) => known === word)) {
      return err(
        'not_a_damage_type',
        `${damageType} is not one of the game's damage types, so no line could ever deal it`,
      );
    }

    if (creature.declaredDamageType === word) return ok([]);
    return ok([
      { type: 'damage-type-declared', id, damageType: word, ...(stamp === null ? {} : { command: stamp }) },
    ]);
  });
}

/**
 * Say that a creature is falling, now.
 *
 * The fact SRD *Feather Fall* and the Monk's Slow Fall both answer, and the
 * one the engine had no way to hold: nothing in it drops a creature off
 * anything, nothing holds a height, and so the Reaction window those two name
 * could never open. It is the third fact of this shape — cover, sight, a
 * creature's type — and it arrives through the same door, which is the whole
 * of why this is a command rather than a flag a spell could set for itself.
 *
 * **What it does not say is as load-bearing as what it does.** There is no
 * height, no rate of descent and no landing: the SRD gives the rate only as
 * "60 feet per round" and gives the distance to the DM, so an engine that
 * recorded either would be inventing the number it exists not to invent. The
 * moment is worth exactly one window, and {@link fallWindowOpen} closes it on
 * the turn and the clock — the rule `lastDamage` already lives by.
 *
 * **Re-declaring is a new fall, not a contradiction**, which is
 * `declareDifficultTerrain`'s rule rather than `declareCreatureType`'s and for
 * a sharper reason than either: a creature's type is what it *is*, and a fall
 * is something that is happening to it. Somebody who is pushed off a second
 * ledge a minute later is falling again, and refusing that would be the engine
 * holding a momentary fact as though it were a permanent one. A caller that
 * genuinely means "again" and a caller retrying are told apart by the command
 * id, as everywhere else.
 *
 * There is no `declareLanded` twin, deliberately. Landing ends the window the
 * moment the turn or the clock moves, with no event and no machinery, and an
 * ending nobody has to remember is one nobody can forget.
 */
export function declareFalling(
  state: GameState,
  id: CharacterId,
  command: CommandIdentity = {},
): Result<GameEvent[]> {
  return once(state, `declare-falling:${id}`, { ...command }, () => [], (stamp) => {
    const creature = creatureOf(state, id);
    if (creature === null) return unknownCreature(id);

    return ok([{ type: 'fall-declared', id, ...(stamp === null ? {} : { command: stamp }) }]);
  });
}

export interface DifficultTerrainCommand extends CommandIdentity {
  /** Where the expensive ground is, in the vocabulary an area of effect uses. */
  readonly region: TerrainRegion;
  /**
   * Feet of movement per foot of ground. Defaults to the SRD glossary's rate.
   *
   * A number rather than a flag because the book prints two: Difficult
   * Terrain costs two feet per foot, and Plant Growth and Wall of Thorns each
   * cost four. A flag would have had to be widened into this the first time
   * either was transcribed.
   */
  readonly costPerFoot?: number;
  /** The casting that made this ground expensive, if one did. */
  readonly source?: string;
}

/**
 * Declare a patch of ground Difficult Terrain.
 *
 * The table's half of a rule the engine finishes. SRD gives six examples of
 * Difficult Terrain and five of them — rubble, undergrowth, furniture, a
 * slope, a narrow opening — are fiction no engine holds a record of; the
 * sixth, another creature's space, `isDifficultTerrain` has answered since
 * positioning landed. So the *fact* is declared, exactly as cover and sight
 * are, and everything downstream of it is computed: which spaces the patch
 * covers, what a move through them costs, what happens when two overlap, and
 * whether the patch is still there.
 *
 * A patch may name the casting that made it. That casting's record is the
 * patch's lifetime — when the webs are dispelled, expire or lose their
 * Concentration, the ground stops costing double at the same instant and
 * through no machinery of its own. Naming a casting nobody is running is
 * refused rather than absorbed, because a patch hung on nothing would never
 * charge and the table would never be told why.
 *
 * Re-declaring the same patch replaces it, which is `declareCover`'s rule and
 * not `declareCreatureType`'s: a creature's type is a fact about what it *is*
 * and cannot be contradicted, while ground genuinely changes — a mire freezes
 * over, a rockfall doubles the rubble.
 */
export function declareDifficultTerrain(
  state: GameState,
  patch: string,
  command: DifficultTerrainCommand,
): Result<GameEvent[]> {
  const { region, costPerFoot = DIFFICULT_TERRAIN, source } = command;

  return once(state, `declare-terrain:${patch}`, { ...command }, () => [], (stamp) => {
    // Homework rather than a verdict: a patch of ground needs a lattice to
    // lie on, and `setScene` is what settles that.
    const scene = sceneFor(state, patch, `the ground under ${patch} to be`);
    if (!scene.ok) return scene;

    if (source !== undefined && state.ongoing[source] === undefined) {
      return err(
        'unknown_casting',
        `no casting ${source} is running, so there is nothing for ${patch} to last as long as`,
      );
    }

    // The refusal is the pure function's — the rate is its rule, and a second
    // spelling here would be a second chance to disagree with the fold.
    const declared = declareDifficultPatch(scene.value, patch, region, costPerFoot, source);
    if (!declared.ok) return declared;

    return ok([
      {
        type: 'difficult-terrain-declared',
        patch,
        region,
        costPerFoot,
        ...(source === undefined ? {} : { source }),
        ...(stamp === null ? {} : { command: stamp }),
      },
    ]);
  });
}

export interface LightCommand extends CommandIdentity {
  /** Where the light is, in the vocabulary an area of effect uses. */
  readonly region: TerrainRegion;
  /** Bright, dim or darkness — the glossary's three words and no fourth. */
  readonly level: LightLevel;
  /**
   * The level of the spell that made it, where a spell did.
   *
   * Present exactly when the light is magical, which is the distinction the
   * SRD attaches its one rule to: nonmagical light does not lift magical
   * darkness, and two magical patches of opposite kind put each other out.
   */
  readonly magical?: { readonly spellLevel: number };
  /** SRD sunlight: Bright Light with the flag four stat blocks read. */
  readonly sunlight?: boolean;
  /** The casting that made this light, if one did. */
  readonly source?: string;
}

/**
 * Declare how bright a patch of the room is.
 *
 * The table's half of the model `docs/design/light-and-sight.md` designs and
 * the owner ruled on: **light is declared on the lattice**, exactly as
 * Difficult Terrain is, because deriving it needs walls and light sources and
 * that is where a rules engine becomes a VTT. What the engine computes is
 * everything downstream — which spaces the patch covers, which of two
 * overlapping patches governs, what a creature's senses make of it, and
 * whether the patch is still there.
 *
 * **There is no default ambient and this command does not create one.** A
 * space nobody has spoken about stays unspoken about, which is the ruling
 * that keeps every sight answer this engine has ever given exactly as it was.
 *
 * A patch may name the casting that made it, on the same terms the ground
 * does: that casting's record is the patch's lifetime, and naming a casting
 * nobody is running is refused rather than absorbed.
 *
 * **And the one thing that is not merely a declaration**: SRD Darkness and
 * SRD Daylight put each other out where they overlap, so a magical patch
 * arriving over a magical patch of the opposite kind ends the loser's casting
 * in the same batch. See `lightDispelledBy` for the sentence and the
 * threshold.
 */
export function declareLight(
  state: GameState,
  patch: string,
  command: LightCommand,
): Result<GameEvent[]> {
  const { region, level, magical, sunlight, source } = command;

  return once(state, `declare-light:${patch}`, { ...command }, () => [], (stamp) => {
    const scene = sceneFor(state, patch, `the light on ${patch} to be`);
    if (!scene.ok) return scene;

    if (source !== undefined && state.ongoing[source] === undefined) {
      return err(
        'unknown_casting',
        `no casting ${source} is running, so there is nothing for ${patch} to last as long as`,
      );
    }

    // The refusal is the pure function's — a second spelling here would be a
    // second chance to disagree with the fold.
    const declared = declareLightPatch(scene.value, patch, region, level, {
      ...(source === undefined ? {} : { source }),
      ...(magical === undefined ? {} : { magical }),
      ...(sunlight === undefined ? {} : { sunlight }),
    });
    if (!declared.ok) return declared;

    return ok([
      {
        type: 'light-declared',
        patch,
        region,
        level,
        ...(magical === undefined ? {} : { magical }),
        ...(sunlight === undefined ? {} : { sunlight }),
        ...(source === undefined ? {} : { source }),
        ...(stamp === null ? {} : { command: stamp }),
      },
      ...(magical === undefined
        ? []
        : lightDispelledBy(state, region, level, magical.spellLevel).map(
            (castingId): GameEvent => ({
              type: 'spell-ended',
              castingId,
              on: null,
              reason: 'dispelled',
            }),
          )),
    ]);
  });
}

export interface ObscurementCommand extends CommandIdentity {
  readonly region: TerrainRegion;
  /** Lightly or heavily — the glossary's two degrees and no third. */
  readonly degree: ObscurementDegree;
  /** The casting that made it, if one did. */
  readonly source?: string;
}

/**
 * Declare a patch of the room obscured by something that is not the light.
 *
 * Fog, foliage, smoke — and SRD Fog Cloud, which is why this is a record of
 * its own beside the light rather than a degree derived from a level: the
 * spell makes its Sphere Heavily Obscured and says nothing whatever about how
 * bright it is. What the light *does* imply is added at read time, in
 * `obscurementAt`, so the two never have to be kept in step by anybody.
 */
export function declareObscurement(
  state: GameState,
  patch: string,
  command: ObscurementCommand,
): Result<GameEvent[]> {
  const { region, degree, source } = command;

  return once(state, `declare-obscurement:${patch}`, { ...command }, () => [], (stamp) => {
    const scene = sceneFor(state, patch, `the air over ${patch} to be`);
    if (!scene.ok) return scene;

    if (source !== undefined && state.ongoing[source] === undefined) {
      return err(
        'unknown_casting',
        `no casting ${source} is running, so there is nothing for ${patch} to last as long as`,
      );
    }

    const declared = declareObscuringPatch(scene.value, patch, region, degree, source);
    if (!declared.ok) return declared;

    return ok([
      {
        type: 'obscurement-declared',
        patch,
        region,
        degree,
        ...(source === undefined ? {} : { source }),
        ...(stamp === null ? {} : { command: stamp }),
      },
    ]);
  });
}
