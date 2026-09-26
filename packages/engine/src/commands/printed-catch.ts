/**
 * Who a printed line catches, measured — I-E9.
 *
 * SRD Winter Wolf, Cold Breath: "_Constitution Saving Throw:_ DC 12, each
 * creature in a 15-foot Cone." The engine has rolled that save, the dice and
 * the half since W6; who was in the Cone was the caller's head count. That was
 * right while a person held the DM's door, and it is wrong for a monster app
 * code plays: code cannot choose who a Cone caught without doing geometry, and
 * the engine exists so that nobody else does geometry.
 *
 * **One function measures, and both doors call it.** {@link printedLineCatch}
 * is the free, read-only question — who would this line catch, aimed so — and
 * `forcePrintedSave` asks the very same function when it is given an aim, so a
 * shortlist the query offered is the list the door rolls for. Two lists of
 * refusal codes are how a query and a door come to disagree, which is why the
 * line lookup is here too ({@link printedSaveLineOf}) and the door calls it.
 *
 * **The templates are the spells'.** A Cone, a Line, an Emanation and a Sphere
 * the parser read (`MonsterSave.catches`) are laid by `areaCatch` — the
 * placement, the range check, the six templates, the dead and Total Cover —
 * exactly as SRD Burning Hands' Cone is. What a line adds on top is its own
 * targeting clause: the types it reaches or spares, whether the target must
 * see the source, the largest size, a day's grace and "isn't currently
 * affected". Sides play no part: a breath catches the source's allies, and a
 * caller aims knowing that.
 *
 * **It asks nothing about the economy.** A recharge, the day's uses, the slot
 * and whose turn it is are `look`'s to report and the door's to refuse; a
 * planner asks who a breath *would* catch before deciding whether to spend it.
 *
 * **It spends nothing, throws nothing and emits nothing.** No `Supply`, no
 * events; a caller holding it holds no power it did not have.
 */

import {
  type CharacterId,
  type ContextRequest,
  type Err,
  err,
  ok,
  type Result,
} from '@ie/shared';
import type { CreatureSize, MonsterSave } from '@ie/srd';
import type { CharacterSheet, StatedAction, StatedBonusAction } from '../character.js';
import { hasCondition } from '../conditions.js';
import type { GameState } from '../events.js';
import {
  affectedByPrintedLine,
  printedLineSource,
  printedSaveOf,
  statedActionOf,
  statedBonusActionOf,
} from '../monster.js';
import { crossingsAlong, type Placement, type Point, positionOf, sizeAtMost } from '../positioning.js';
import { effectiveSizeOf } from '../size.js';
import type { SpellArea } from '../spell-definitions.js';
import { canSee } from '../standing.js';
import { creatureOf, reachedBy, unknownCreature } from './command.js';
import { leapLanding } from './printed-move.js';
import { type AreaRejection, areaCatch } from './targeting.js';
import { grapplesOn } from './unarmed.js';

/**
 * Where a line is aimed.
 *
 * The engine takes **points** — a Cone's `towards`, a Sphere's `at` — and the
 * tools resolve a creature or a landmark into one, as they do for a spell.
 * `creature` is the one fact a point cannot carry: which creature a line that
 * reaches one creature, or a leap, is aimed at. A point beside it is that
 * creature's space and is read only by an area.
 */
export interface PrintedAim {
  readonly towards?: Point;
  readonly at?: Point;
  readonly creature?: CharacterId;
}

/** What {@link printedLineCatch} answers. */
export interface PrintedLineCatch {
  /** Whom the door would roll for with this aim, in id order. */
  readonly caught: readonly CharacterId[];
  /** Creatures covered or offered and not caught, each with the door's own sentence. */
  readonly excluded: readonly AreaRejection[];
  /** What must be established first — an aim, a scene, a position, a route. */
  readonly needs: readonly ContextRequest[];
  /** Creatures caught on a fact nobody settled, said rather than guessed. */
  readonly unverified: readonly string[];
  /** Where a leap lands, for the door that leaps. */
  readonly landing?: Placement;
}

/** A printed line that forces a save, found where the door finds it. */
export interface PrintedSaveLine {
  readonly line: StatedAction | StatedBonusAction;
  /** Found under **Actions**; false for a Bonus Action. The heading says what it costs. */
  readonly action: boolean;
  readonly save: MonsterSave;
}

/**
 * The line a caller names, off the sheet `creature-added` pinned, and the save
 * it forces — or the door's refusal.
 *
 * **Actions first, then Bonus Actions**, because the book writes the template
 * under both and a heading says what a line costs (SRD Gorgon's Trample is a
 * Bonus Action). A trait's heading is looked up before the refusal is written,
 * so a caller who names a Death Burst is told *why*.
 *
 * `gate` is what the door asks between finding the line and reading its save —
 * the heading's printed requirement (W7-B11) — in the order the door has always
 * asked it. The query passes none: whether a creature may take the line is the
 * door's to say, and who it would catch is a question about the room.
 */
export function printedSaveLineOf(
  sheet: CharacterSheet,
  name: string,
  gate?: (line: StatedAction | StatedBonusAction) => Err | null,
): Result<PrintedSaveLine> {
  const action = statedActionOf(sheet, name);
  const bonus = action === null ? statedBonusActionOf(sheet, name) : null;
  const line: StatedAction | StatedBonusAction | null = action ?? bonus;
  if (line === null) {
    if (printedSaveOf(sheet, name) !== null) {
      return err(
        'save_is_triggered',
        `${name} is forced by a moment rather than by a use — the engine raises it when that moment comes and rolls it with the saves a boundary owes; nobody spends it`,
      );
    }
    return err(
      'no_such_line',
      `no line called ${name} is printed under this creature's Actions or Bonus Actions with nothing the engine could read beneath it; a heading the parser did read as an attack, and a heading printed under another section, are each taken by the command that owns them`,
    );
  }
  const refused = gate?.(line) ?? null;
  if (refused !== null) return refused;
  const save = line.save;
  if (save === undefined) {
    return err(
      'line_states_no_save',
      `${line.name} states no saving throw this engine could read; take it with the door that hands the sentence over, and a DM applies what it says`,
    );
  }
  // **A line whose save a *moment* forces is not a line a creature takes.**
  // SRD Magmin's Death Burst goes off when the magmin dies; the fold raises
  // it and `resolvePendingSaves` rolls it.
  if (save.trigger !== undefined) {
    return err(
      'save_is_triggered',
      `${line.name} is forced by a moment rather than by a use — the engine raises it when that moment comes and rolls it with the saves a boundary owes; nobody spends it`,
    );
  }
  return ok({ line, action: action !== null, save });
}

/**
 * What a line reaches before a day's grace and "isn't currently affected" have
 * had their say — which is the list the door is handed, because the door
 * already drops and names those two in its own words.
 *
 * `measured` is whether the engine measured anything at all: an area laid, a
 * space or a hold read, a ruler held against a scene. The door says "measured
 * no area" only where it is false.
 */
export interface PrintedLineReached {
  readonly reached: readonly CharacterId[];
  readonly excluded: readonly AreaRejection[];
  readonly needs: readonly ContextRequest[];
  readonly unverified: readonly string[];
  readonly landing?: Placement;
  readonly measured: boolean;
}

/** Whether a line's catch is "each" with no aim to take — measured where it stands. */
export function catchesWithoutAim(save: MonsterSave): boolean {
  const catches = save.catches;
  if (catches === undefined || save.movesThen !== undefined) return false;
  return (
    catches.kind === 'emanation' ||
    ((catches.kind === 'own-space' || catches.kind === 'held') && catches.count === undefined)
  );
}

/** Whether a line's catch is a template somebody must aim — a Cone, a Line, a Sphere. */
export function catchesByAim(save: MonsterSave): boolean {
  const kind = save.catches?.kind;
  return kind === 'cone' || kind === 'line' || kind === 'sphere';
}

/** The words of the fields that would place this line's template. */
function howToAim(save: MonsterSave): string {
  return save.catches?.kind === 'sphere'
    ? '`at` — a point within ' + `${save.catches.within} feet — placing the Sphere`
    : `\`towards\` pointing the ${save.catches?.kind ?? 'area'}`;
}

/** The request for the aim a Cone, a Line or a Sphere is laid by. */
function aimRequest(who: CharacterId, lineName: string, save: MonsterSave): ContextRequest {
  return {
    kind: 'route',
    subject: who,
    need: `where ${lineName} is aimed — ${howToAim(save)}`,
    because: `${lineName} catches whoever stands in its ${save.catches?.kind ?? 'area'}, and which way it points is the caller's to say`,
    satisfyWith: `printedLineCatch or forcePrintedSave again with ${howToAim(save)}`,
  };
}

/** The request today's head count answers, for a line the engine measures nothing of. */
function headCountRequest(who: CharacterId, lineName: string, save: MonsterSave): ContextRequest {
  return {
    kind: 'creature',
    subject: who,
    need: `the creatures ${lineName} caught — the line reads "${save.targets}"`,
    because: 'the engine reads no template or ruler out of this targeting clause; the saving throws are its own',
    satisfyWith: 'forcePrintedSave with its targets filled in',
  };
}

/** A line's own `SpellArea`, in the spells' words — the parser read the same names. */
function areaOf(save: MonsterSave): SpellArea | null {
  const catches = save.catches;
  switch (catches?.kind) {
    case 'cone':
      return { kind: 'cone', length: catches.length, origin: 'self' };
    case 'line':
      return { kind: 'line', length: catches.length, width: catches.width, origin: 'self' };
    case 'emanation':
      return { kind: 'emanation', distance: catches.distance, origin: 'self' };
    case 'sphere':
      return { kind: 'sphere', radius: catches.radius, origin: 'point' };
    default:
      return null;
  }
}

/**
 * The targeting clause's own filters over creatures the geometry reached —
 * the types, the types spared, the sight of the source, the largest size and
 * the conditions the target must hold.
 *
 * **A fact nobody settled catches and is said**, as `areaCatch` says SRD
 * Hypnotic Pattern's: a creature whose type nobody declared, a sight line
 * nobody declared, a size nothing gave. **A fact the engine holds decides.**
 */
function narrowed(
  state: GameState,
  who: CharacterId,
  lineName: string,
  save: MonsterSave,
  candidates: readonly CharacterId[],
  excluded: AreaRejection[],
  unverified: string[],
): CharacterId[] {
  const kept: CharacterId[] = [];
  for (const target of candidates) {
    const creature = state.creatures[target];
    if (creature === undefined) continue;
    // The source is never caught by its own line — the glossary's origin
    // exclusion, which a Sphere laid over its own maker would otherwise miss.
    if (target === who) {
      excluded.push({ target, reason: `${who} is the source of ${lineName} and is not caught by it` });
      continue;
    }
    if (creature.vitals.dead) {
      excluded.push({ target, reason: `${target} is dead` });
      continue;
    }
    const type = creature.creatureType ?? null;
    const types = save.onlyIfTargetType;
    if (types !== undefined) {
      if (type !== null && !types.includes(type)) {
        excluded.push({ target, reason: `${lineName} reaches only ${types.join(' or ')}, and ${target} is ${type}` });
        continue;
      }
      if (type === null) {
        unverified.push(
          `${lineName} reaches only ${types.join(' or ')}, and nobody has said what ${target} is — caught anyway, and declareCreatureType settles it`,
        );
      }
    }
    const spared = save.unlessTargetType;
    if (spared !== undefined) {
      if (type !== null && spared.includes(type)) {
        excluded.push({ target, reason: `${lineName} spares ${spared.join(' and ')}, and ${target} is ${type}` });
        continue;
      }
      if (type === null) {
        unverified.push(
          `${lineName} spares ${spared.join(' and ')}, and nobody has said what ${target} is — caught anyway, and declareCreatureType settles it`,
        );
      }
    }
    if (save.seesSource === true) {
      const sees = canSee(state, target, who);
      if (sees === false) {
        excluded.push({ target, reason: `${lineName} catches only a creature that can see ${who}, and ${target} cannot` });
        continue;
      }
      if (sees === null) {
        unverified.push(
          `${lineName} catches a creature that can see ${who}, and nobody has said whether ${target} can — caught anyway, and declareSightBetween settles it`,
        );
      }
    }
    const largest = save.onlyIfTargetSize;
    if (largest !== undefined) {
      const size = effectiveSizeOf(state, target);
      if (size !== null && !sizeAtMost(size, largest)) {
        excluded.push({ target, reason: `${lineName} reaches a creature ${sizeWords(largest)} or smaller, and ${target} is ${size}` });
        continue;
      }
      if (size === null) {
        unverified.push(`${lineName} reaches a creature ${sizeWords(largest)} or smaller, and nothing has given ${target} a size — caught anyway`);
      }
    }
    const restriction = save.onlyIfTargetHas;
    if (restriction !== undefined) {
      const holds = restriction.conditions.some((condition) => hasCondition(creature.conditions, condition));
      if (!holds) {
        const held = restriction.conditions.join(', ');
        excluded.push({
          target,
          reason:
            restriction.orWilling === true
              ? `${target} holds none of ${held}, and ${lineName} reaches such a creature only if it is willing — name it in \`willing\``
              : `${lineName} reaches "${save.targets}", and ${target} holds none of ${held}`,
        });
        continue;
      }
    }
    kept.push(target);
  }
  return kept;
}

const sizeWords = (size: CreatureSize): string => `${size.slice(0, 1).toUpperCase()}${size.slice(1)}`;

/** Every creature in the state but the source, in id order. */
const othersThan = (state: GameState, who: CharacterId): CharacterId[] =>
  (Object.keys(state.creatures) as CharacterId[]).filter((id) => id !== who).sort();

/**
 * For a line that catches one creature, the aim's creature alone — or every
 * creature, where the caller named none. The aim's creature is excluded with
 * the list's own reason where it is not on it.
 */
function narrowToAim(
  shortlist: readonly CharacterId[],
  excluded: readonly AreaRejection[],
  aim: PrintedAim | undefined,
  lineName: string,
): { caught: CharacterId[]; excluded: AreaRejection[] } {
  const chosen = aim?.creature;
  if (chosen === undefined) return { caught: [...shortlist], excluded: [...excluded] };
  if (shortlist.includes(chosen)) return { caught: [chosen], excluded: excluded.filter((one) => one.target === chosen) };
  const why = excluded.find((one) => one.target === chosen);
  return {
    caught: [],
    excluded: [why ?? { target: chosen, reason: `${lineName} does not reach ${chosen}` }],
  };
}

/**
 * What a line reaches with this aim, before the day's grace and "isn't
 * currently affected" — see {@link PrintedLineReached}. The body of both the
 * query and the door's aim road.
 */
export function printedLineReached(
  state: GameState,
  who: CharacterId,
  found: PrintedSaveLine,
  aim?: PrintedAim,
): Result<PrintedLineReached> {
  const { line, save } = found;
  const excluded: AreaRejection[] = [];
  const unverified: string[] = [];
  const pointed = aim?.towards !== undefined || aim?.at !== undefined;
  const nothing = (needs: readonly ContextRequest[]): Result<PrintedLineReached> =>
    ok({ reached: [], excluded: [], needs, unverified: [], measured: false });
  const notDirectional = (what: string): Err =>
    err('not_directional', `${line.name} ${what}; it has no direction to point and no point to centre`);

  // **A move first.** SRD Bulette's leap lands on a creature somebody names;
  // SRD Centaur Trooper's charge wants the spaces crossed, which is I-E9b.
  const move = save.movesThen;
  if (move !== undefined) {
    if (move.kind === 'move-through') {
      return nothing([
        {
          kind: 'route',
          subject: who,
          need: `the spaces ${who} moves through, in order, ending where the move ends`,
          because: `${line.name} catches whoever's space ${who} enters, and which spaces those are is not something the engine may decide`,
          satisfyWith: 'takePrintedMove with `route` filled in, as points of 5 feet each',
        },
      ]);
    }
    const onto = aim?.creature;
    if (onto === undefined) {
      if (pointed) return notDirectional('lands on a creature somebody names');
      return nothing([
        {
          kind: 'position',
          subject: who,
          need: `the creature ${who} lands on`,
          because: `${line.name} jumps to a space within ${move.within} feet that holds one or more ${move.intoOccupiedBy} or smaller creatures`,
          satisfyWith: 'printedLineCatch again naming the creature to land on, then takePrintedMove to it',
        },
      ]);
    }
    const landing: Placement = { from: { creature: onto }, feet: 0 };
    const leap = leapLanding(state, who, line.name, move, landing);
    if (!leap.ok) {
      return leap.kind === 'needs-context' && leap.requests !== undefined ? nothing(leap.requests) : leap;
    }
    // The leap lands on `onto`'s own space, so the box it lands as always
    // holds `onto` — `printed-catch.test.ts` pins that for a Large bulette.
    const reached = narrowed(state, who, line.name, save, leap.value.entered, excluded, unverified);
    return ok({ reached, excluded, needs: [], unverified, landing, measured: true });
  }

  // **A template the spells lay.**
  const area = areaOf(save);
  if (area !== null) {
    const caught = areaCatch(
      state,
      who,
      { name: line.name },
      area,
      {
        targets: [],
        ...(aim?.towards === undefined ? {} : { towards: aim.towards }),
        ...(aim?.at === undefined ? {} : { at: aim.at }),
      },
      save.catches?.kind === 'sphere' ? save.catches.within : null,
      unverified,
      excluded,
    );
    if (!caught.ok) {
      if (caught.kind === 'needs-context' && caught.requests !== undefined) return nothing(caught.requests);
      // The aim nobody gave: asked for, never guessed.
      if (caught.code === 'no_direction' || caught.code === 'no_origin') return nothing([aimRequest(who, line.name, save)]);
      return caught;
    }
    const reached = narrowed(state, who, line.name, save, caught.value, excluded, unverified);
    return ok({ reached, excluded, needs: [], unverified, measured: true });
  }

  const catches = save.catches;
  const reach = save.reach;
  // A line that reaches one creature is aimed by naming it; a point is a
  // direction this catch does not take.
  if (pointed && aim?.creature === undefined) return notDirectional('catches no area');
  // "each creature in the elemental's space" takes no aim at all.
  if (
    aim !== undefined &&
    (aim.creature !== undefined || pointed) &&
    (catches?.kind === 'own-space' || catches?.kind === 'held') &&
    catches.count === undefined
  ) {
    return notDirectional(`catches each creature ${catches.kind === 'held' ? 'it holds' : 'in its space'}`);
  }

  // **The creature's own space, and whom it holds.** SRD Water Elemental's
  // Whelm and SRD Otyugh's Tentacle Slam.
  if (catches?.kind === 'own-space' || catches?.kind === 'held') {
    let candidates: CharacterId[];
    if (catches.kind === 'held') {
      // The door's own test (`grapplesOn`), which is also what a hold's room reads.
      candidates = othersThan(state, who).filter((id) =>
        grapplesOn(state, id).some((grapple) => grapple.grappler === who),
      );
    } else {
      if (state.scene === null) {
        return nothing([
          {
            kind: 'scene',
            subject: who,
            need: 'a scene, so that a space has somebody in it',
            because: `${line.name} catches whoever is in ${who}'s space`,
            satisfyWith: 'a setScene command',
          },
        ]);
      }
      const here = positionOf(state.scene, who);
      if (here === null) {
        return nothing([
          {
            kind: 'position',
            subject: who,
            need: `where ${who} is standing`,
            because: `${line.name} catches whoever is in ${who}'s space`,
            satisfyWith: `a placeCreatureInScene command for ${who}`,
          },
        ]);
      }
      candidates = [...new Set(crossingsAlong(state.scene, who, [here]).map((one) => one.occupant))].sort();
    }
    const shortlist = narrowed(state, who, line.name, save, candidates, excluded, unverified);
    const chosen = narrowToAim(shortlist, excluded, aim, line.name);
    return ok({ reached: chosen.caught, excluded: chosen.excluded, needs: [], unverified, measured: true });
  }

  // **A ruler to one creature** — W7-B13's `reach`, the shortlist the door
  // would accept one of.
  if (reach !== undefined) {
    if (state.scene === null) {
      return nothing([
        {
          kind: 'scene',
          subject: who,
          need: 'a scene, so that a distance means something',
          because: `${line.name} reaches ${reach.feet} feet`,
          satisfyWith: 'a setScene command',
        },
      ]);
    }
    const needs: ContextRequest[] = [];
    const inReach: CharacterId[] = [];
    const asked = aim?.creature === undefined ? othersThan(state, who) : [aim.creature];
    for (const target of asked) {
      if (state.creatures[target] === undefined) return unknownCreature(target);
      const beyond = reachedBy(state, who, target, line.name, reach.feet);
      if (beyond !== null) {
        if (beyond.kind === 'needs-context') needs.push(...(beyond.requests ?? []));
        else excluded.push({ target, reason: beyond.reason });
        continue;
      }
      if (reach.seen === true) {
        const sees = canSee(state, who, target);
        if (sees === false) {
          excluded.push({ target, reason: `${line.name} reaches a creature ${who} can see, and ${who} cannot see ${target}` });
          continue;
        }
        if (sees === null) {
          unverified.push(
            `${line.name} reaches a creature ${who} can see, and nobody has said whether it can see ${target} — declareSightBetween settles it`,
          );
        }
      }
      inReach.push(target);
    }
    const reached = narrowed(state, who, line.name, save, inReach, excluded, unverified);
    return ok({ reached, excluded, needs, unverified, measured: true });
  }

  // **Nothing the engine measures**: the caller names the head count, as every
  // line did before I-E9.
  if (aim !== undefined && (aim.creature !== undefined || pointed)) return notDirectional('is not measured by the engine');
  return nothing([headCountRequest(who, line.name, save)]);
}

/**
 * Who a printed line would catch, aimed so — the read-only question under
 * `printed_line_catch`. See this module's note.
 *
 * Refuses what the line **is** with the door's codes (`no_such_line`,
 * `line_states_no_save`, `save_is_triggered`) and a placement the rules
 * refuse (`out_of_range`, `not_directional`, a leap's `leap_too_far`); asks,
 * in `needs`, for what is merely missing. A creature the line has already
 * given a day's grace, or is still holding where its clause says "isn't
 * currently affected", is excluded in the door's own words.
 */
export function printedLineCatch(
  state: GameState,
  who: CharacterId,
  lineName: string,
  aim?: PrintedAim,
): Result<PrintedLineCatch> {
  const creature = creatureOf(state, who);
  if (creature === null) return unknownCreature(who, 'has no record here yet; add it first');
  const found = printedSaveLineOf(creature.sheet, lineName);
  if (!found.ok) return found;
  const reached = printedLineReached(state, who, found.value, aim);
  if (!reached.ok) return reached;

  const { line, save } = found.value;
  const shielded = printedLineSource(who, line.name);
  const caught: CharacterId[] = [];
  const excluded = [...reached.value.excluded];
  for (const target of reached.value.reached) {
    if ((state.creatures[target]?.lineImmunities ?? []).some((held) => held.source === shielded)) {
      excluded.push({ target, reason: `${target} is immune to ${who}'s ${line.name} for the rest of the day and would not be asked to save` });
      continue;
    }
    if (save.onlyIfNotAffected === true && affectedByPrintedLine(state, target, shielded)) {
      excluded.push({
        target,
        reason: `${target} is already under ${who}'s ${line.name} and the line reaches only creatures that are not`,
      });
      continue;
    }
    caught.push(target);
  }
  return ok({
    caught: caught.sort(),
    excluded,
    needs: reached.value.needs,
    unverified: reached.value.unverified,
    ...(reached.value.landing === undefined ? {} : { landing: reached.value.landing }),
  });
}
