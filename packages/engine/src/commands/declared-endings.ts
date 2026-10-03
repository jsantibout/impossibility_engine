/**
 * The table's word that something the room holds has happened, and the
 * ending the engine owes once it is said. (W9-S2)
 *
 * Two doors, one idea. The engine holds no weather, no rope strung between
 * two trees and no errand, so whether a strong wind blows, whether a web is
 * anchored, whether a Charmed ogre has fetched the key and whether a chest
 * with a glyph on it was carried off are facts only the table has. What
 * follows from each is printed, and is the engine's:
 *
 * | Declared | SRD | What the engine does |
 * |---|---|---|
 * | {@link declareWind} | Fog Cloud, Stinking Cloud: "until a strong wind … disperses it" | the fold ends every cloud the wind reaches (`fold/endings.ts`) |
 * | {@link declareEnding} | Web, Suggestion, Glyph of Warding | the casting ends, on one target or whole, now or at the moment the spell defers it to |
 *
 * **Neither takes a number the engine did not already accept.** A wind's
 * region is a place on the lattice — the same kind of fact a declared patch of
 * light or fog is — and the table's word is a phrase the spell's own record
 * prints, so a caller cannot end a casting the book never said ends that way.
 */
import { type CharacterId, err, ok, type Result } from '@ie/shared';
import { type CommandIdentity, once } from '../idempotency.js';
import { type Content } from '../content.js';
import { type GameEvent, type GameState, isOn } from '../events.js';
import { type Point, snapToSpace, spaceInRegion, type TerrainRegion } from '../positioning.js';
import { regionOfCastingArea } from '../spells.js';
import { forSeconds, resolveDuration, timeView } from '../time.js';
import { timerKey } from '../timers.js';
import { creatureOf, unknownCreature } from './command.js';
import { schedule } from './conditions.js';

export interface WindCommand extends CommandIdentity {
  /** Where it blows; absent is the whole scene. */
  readonly region?: TerrainRegion;
}

/**
 * The table says a strong wind blows.
 *
 * SRD Fog Cloud: "It lasts for the duration or until a strong wind (such as
 * one created by _Gust of Wind_) disperses it." Gust of Wind is the book's
 * example; a gale through a broken window is a strong wind too, and the engine
 * derives no weather. So the wind is declared and the dispersal is derived:
 * `wind-declared` is the fact, and `fold/endings.ts` ends every running
 * casting that prints `dispersed-by-wind` whose area the region reaches.
 *
 * A region needs a scene to lie in; the whole scene does not, because a
 * cloud nobody has placed is still a cloud the gale disperses.
 */
export function declareWind(state: GameState, command: WindCommand = {}): Result<GameEvent[]> {
  return once(state, 'declare-wind', command, () => [], (stamp) => {
    if (command.region !== undefined && state.scene === null) {
      return err('no_scene', 'a wind over a region blows somewhere in a scene, and there is none');
    }
    return ok([
      {
        type: 'wind-declared',
        ...(command.region === undefined ? {} : { region: command.region }),
        ...(stamp === null ? {} : { command: stamp }),
      },
    ]);
  });
}

/**
 * The table's word that a Cube of a running casting's area met fire — SRD
 * Web: "The webs are flammable. Any 5-foot Cube of webs exposed to fire burns
 * away in 1 round, dealing 2d4 Fire damage to any creature that starts its turn
 * in the fire." (E-L2)
 *
 * **Whether it met fire is the room's**: a torch dropped, a Fire Bolt through
 * the strands, a burning goblin blundering in — none of which the engine could
 * tell apart from fire that missed. What follows is the engine's, read off the
 * definition's `flammable` and pinned on the event: the Cube burns for the
 * round the book prints, a creature that starts its turn in it takes the dice
 * (`burningCubesDue`), and the fold burns it away when the round is out
 * (`burnAwayCubes`).
 *
 * Refused for a casting that is not running (`not_ongoing`), one whose spell
 * prints no such sentence (`not_flammable`), a space its area does not fill or
 * no longer fills (`outside_area`), and a Cube already burning
 * (`already_burning`).
 */
export function exposeToFire(
  state: GameState,
  content: Content,
  castingId: string,
  at: Point,
  command: CommandIdentity = {},
): Result<GameEvent[]> {
  const space = snapToSpace(at);
  return once(
    state,
    `expose-to-fire:${castingId}:${space.x},${space.y},${space.z}`,
    command,
    () => [],
    (stamp) => {
      const record = state.ongoing[castingId];
      if (record === undefined) {
        return err('not_ongoing', `${castingId} is not a spell that is still running`);
      }
      const flammable = content.spell(record.spellId)?.flammable;
      if (flammable === undefined) {
        return err('not_flammable', `${record.spell} prints nothing that burns`);
      }
      const scene = state.scene;
      const region = regionOfCastingArea(record);
      if (scene === null || region === null || !spaceInRegion(scene, region, space)) {
        return err(
          'outside_area',
          `${record.spell} does not fill (${space.x}, ${space.y}, ${space.z}), so nothing of it is there to burn`,
        );
      }
      const same = (p: Point): boolean => p.x === space.x && p.y === space.y && p.z === space.z;
      if ((record.burning ?? []).some((cube) => same(cube.space))) {
        return err('already_burning', `${record.spell} is already burning at (${space.x}, ${space.y}, ${space.z})`);
      }
      const until = resolveDuration(timeView(state), forSeconds(flammable.burnsSeconds));
      if (!until.ok) return until;
      return ok([
        {
          type: 'casting-area-burning',
          castingId,
          space,
          until: until.value,
          dice: flammable.dice,
          damageType: flammable.damageType,
          ...(stamp === null ? {} : { command: stamp }),
        },
      ]);
    },
  );
}

export interface DeclaredEnding {
  /** The phrase the spell prints for the cause — see `CastingEndTrigger.what`. */
  readonly what: string;
  /** The creature it ends on, for an ending the book prints for one target. */
  readonly on?: CharacterId;
}

/**
 * The table says a cause the spell prints has happened.
 *
 * > SRD Web: "If the webs aren't anchored … the web collapses on itself, and
 * > the spell ends at the start of your next turn."
 * > SRD Suggestion: "the spell ends for the target upon completing it."
 * > SRD Glyph of Warding: "If the surface or object is moved more than 10
 * > feet from where you cast this spell, the glyph is broken, and the spell
 * > ends without being triggered."
 *
 * **The phrase is matched against the casting's pinned `endsEarly`**, never
 * the book: a casting made last year ends by last year's sentence, and a
 * phrase the record does not print is `not_its_cause`. The scope is the
 * trigger's: `ends: 'target'` needs the creature it ends on, one the casting
 * is on; `ends: 'casting'` refuses one, because there is nobody to choose.
 *
 * **Now, or where the spell defers it.** Without `at` the ending is a
 * `spell-ended` — the event the caster's dismissal writes, written here
 * rather than through `endOngoingSpell` because the word is not the caster's:
 * that door refuses anybody else, an Incapacitated caster, and a casting that
 * lasts until dispelled, and Glyph of Warding is all three kinds of
 * answer to it. The reason is `spent` — the printed condition of the spell's
 * lasting is used up, which is what the book's three sentences say — rather
 * than `dismissed`, which is a caster letting go, or `triggered`, which Glyph's
 * own sentence rules out. With `at`, the casting's deadline is moved through
 * `schedule`, the one door every deadline goes through, and the ordinary
 * expiry does the rest: every sentence the web prints stands until the moment
 * the book names. Outside a fight "the start of your next turn" is a moment
 * with no turn order to be one in, and `schedule` asks for one.
 */
export function declareEnding(
  state: GameState,
  castingId: string,
  ending: DeclaredEnding,
  command: CommandIdentity = {},
): Result<GameEvent[]> {
  return once(
    state,
    `declare-ending:${castingId}`,
    { ...command, what: ending.what, ...(ending.on === undefined ? {} : { on: ending.on }) },
    () => [],
    (stamp) => {
      const record = state.ongoing[castingId];
      if (record === undefined) {
        return err('not_ongoing', `${castingId} is not a spell that is still running`);
      }

      const printed = (record.endsEarly ?? []).flatMap((trigger) =>
        trigger.on === 'the-table-declares' && trigger.what !== undefined ? [trigger.what] : [],
      );
      const trigger = (record.endsEarly ?? []).find(
        (one) => one.on === 'the-table-declares' && one.what === ending.what,
      );
      if (trigger === undefined) {
        return err(
          'not_its_cause',
          printed.length === 0
            ? `${record.spell} prints no ending the table declares`
            : `${record.spell} ends on ${printed.map((phrase) => `"${phrase}"`).join(', ')}, not "${ending.what}"`,
        );
      }

      let on: CharacterId | null = null;
      if (trigger.ends === 'target') {
        if (ending.on === undefined) {
          return err(
            'ending_names_a_creature',
            `${record.spell} ends on "${ending.what}" for the one creature it happened to; name which`,
          );
        }
        if (creatureOf(state, ending.on) === null) return unknownCreature(ending.on);
        if (!isOn(state, record, ending.on)) {
          return err('no_effect_there', `${record.spell} is not on ${ending.on}, so it cannot end there`);
        }
        on = ending.on;
      } else if (ending.on !== undefined) {
        return err(
          'ending_names_no_creature',
          `${record.spell} ends whole on "${ending.what}", so there is no creature to name`,
        );
      }

      if (trigger.at === 'start-of-casters-next-turn') {
        // The casting's own deadline, moved — what the timer already carries
        // rides with it, so a check or a repeat save hung on the casting is
        // not lost to the move.
        const target = { kind: 'casting', castingId } as const;
        const held = state.timers[timerKey(target)];
        const moved = schedule(
          state,
          target,
          { kind: 'start-of-next-turn', of: record.caster as CharacterId },
          held?.repeatSave,
          held?.check,
          held?.endsEarly,
        );
        if (!moved.ok) return moved;
        const scheduled = moved.value;
        return ok([
          scheduled.type === 'effect-scheduled' && stamp !== null
            ? { ...scheduled, command: stamp }
            : scheduled,
        ]);
      }

      return ok([
        {
          type: 'spell-ended',
          castingId,
          on,
          reason: 'spent',
          ...(stamp === null ? {} : { command: stamp }),
        },
      ]);
    },
  );
}
