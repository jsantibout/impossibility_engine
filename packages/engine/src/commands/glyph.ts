/**
 * A DM says the trigger a caster invented has occurred.
 *
 * SRD Glyph of Warding: "You decide what triggers the glyph when you cast the
 * spell … Once a glyph is triggered, this spell ends." The trigger is fiction
 * — a footfall, a book opened, a word spoken — and the engine holds nothing it
 * could read it from, so whether it occurred is a decision the rules leave
 * open, which is the DM's door's whole criterion. Everything after the
 * decision is the engine's: who is standing in the Sphere, measured from the
 * point the glyph was pinned to; one saving throw each; the dice at the slot
 * the glyph was inscribed with, of the type the caster stated; and the casting
 * ending because it fired.
 *
 * **Off the record, not the book.** The effect list was pinned onto the
 * casting at the inscription with its stated type substituted, so a glyph
 * drawn last year erupts as it was drawn whatever the catalogue says today.
 * The definition is opened for its name and level alone, which is what every
 * later use of a casting opens it for.
 */
import type { CharacterId } from '@ie/shared';
import { err, ok, type Result } from '@ie/shared';
import { applyEvent, type GameEvent } from '../events.js';
import type { CommandStamp, CreatureState, GameState } from '../state.js';
import type { Content } from '../content.js';
import { positionOf, type Point } from '../positioning.js';
import { remaining, slotKeyOf } from '../resources.js';
import {
  castOnAHit,
  durationSecondsAt,
  type SpellDefinition,
  type StoredSpellRequest,
  untilDispelledAt,
} from '../spell-definitions.js';
import type { CastingRoute } from '../spellcasting.js';
import { creaturesStandingInCastingArea, type StoredCasting } from '../spells.js';
import { sheetAsItStands } from '../standing.js';
import { type CommandIdentity, commandOutcome, once } from '../idempotency.js';
import { chooseRoute, chooseSlotKind, type Supply } from './casting.js';
import { schedule } from './conditions.js';
import { numbersFor, routeLabel } from './item-casting.js';
import { castOrRelease, resolveEffects } from './spell-resolution.js';
import { declaredFacts, type CastSpellRequest, type SpellResolution } from './targeting.js';

export interface TriggerGlyphCommand extends CommandIdentity {
  /** The inscribed casting, by its id. */
  readonly castingId: string;
  /**
   * The creature that set it off, for a glyph that stores a spell — SRD Glyph
   * of Warding: "If the spell has a target, it targets the creature that
   * triggered the glyph. If the spell affects an area, the area is centered on
   * that creature." Who stepped on the rune is the DM's to say, as whether
   * anybody did is. Required for a spell glyph (`triggerer_required`) and
   * refused for a rune that stores nothing (`nothing_stored`), where the
   * Sphere says who is caught. (W7-S21)
   */
  readonly by?: CharacterId;
}

export function triggerGlyph(
  state: GameState,
  command: TriggerGlyphCommand,
  supply: Supply,
): Result<SpellResolution> {
  return once(state, 'trigger-glyph', command, () => {
    const already =
      command.commandId === undefined ? null : commandOutcome(state, command.commandId);
    return {
      events: [],
      castingId: already?.castingId ?? command.castingId,
      outcomes: [],
      unverified: [],
    };
  }, (stamp) => {
    const record = state.ongoing[command.castingId];
    if (record === undefined) {
      return err('not_ongoing', `${command.castingId} is not a spell that is still running`);
    }
    // **A spell glyph lets its stored spell go** at the creature the DM names,
    // and runs no rune — the book's two options, never both. See
    // `releaseStoredSpell`.
    if (record.stored !== undefined) {
      if (command.by === undefined) {
        return err(
          'triggerer_required',
          `${record.spell} holds a stored ${record.stored.spellId}, which takes effect on the creature that triggered it; name who did in \`by\``,
        );
      }
      return releaseStoredSpell(
        state,
        record.castingId,
        record.caster as CharacterId,
        record.stored,
        command.by,
        supply,
        stamp,
      );
    }
    if (command.by !== undefined) {
      return err(
        'nothing_stored',
        `${record.spell} stores no spell; its rune catches whoever stands in the Sphere, and naming who set it off says nothing the engine reads`,
      );
    }
    if (record.triggered === undefined) {
      return err(
        'no_trigger',
        `${record.spell} prints no trigger for a DM to set off; the one that does is inscribed and waits`,
      );
    }
    const scene = state.scene;
    if (scene === null) {
      return err('no_scene', `${record.spell} erupts over ground, and there is no scene for it to be in`);
    }
    const caught = creaturesStandingInCastingArea(scene, record);
    // A record that fires a rune pinned its area and its point at the
    // inscription — `resolveSpell` insists on both — so a null here is a log
    // this engine did not write, which is programmer error and not a ruling.
    if (caught === null) {
      throw new Error(`${record.castingId} fires a rune and pins no area to fire it over`);
    }
    // **The caster's book, for the name and the level only.** The effects are
    // the record's — see the module note.
    const definition = supply.content.spell(record.spellId);
    if (definition === null) {
      return err('no_definition', `${record.spellId} has no executable definition`);
    }

    const events: GameEvent[] = [];
    const unverified: string[] = [];
    const caster = state.creatures[record.caster] ?? null;
    const targets = [...caught].sort() as CharacterId[];

    const resolved = resolveEffects(state, record.caster as CharacterId, caster, definition, {
      castLevel: record.level,
      numbers: record.numbers,
      route: null,
      targets,
      unverified,
      supply,
      castingId: record.castingId,
      events,
      effects: record.triggered.effects,
      label: record.triggered.label,
      ...(record.origin === undefined ? {} : { from: record.origin }),
    });
    if (!resolved.ok) return resolved;

    // "Once a glyph is triggered, this spell ends": the ending is what the
    // firing costs, in the same batch, so no log can show a rune that erupted
    // and a glyph still inscribed.
    events.push({
      type: 'spell-ended',
      castingId: record.castingId,
      on: null,
      reason: 'triggered',
      ...(stamp === null ? {} : { command: stamp }),
    });

    return ok({
      events,
      castingId: record.castingId,
      outcomes: resolved.value.outcomes,
      unverified,
    });
  });
}

// — the spell glyph ———————————————————————————————————————————————————————————

/**
 * What storing a spell settles before anything is spent: the stored spell's
 * definition, the class route that supplies it, and the slot that pays for it.
 */
export interface StoringPlan {
  readonly stores: StoredSpellRequest;
  readonly definition: SpellDefinition;
  readonly route: Extract<CastingRoute, { readonly kind: 'prepared' }>;
  /** The slot the stored spell is cast from — its pool key and level. */
  readonly slot: { readonly key: string; readonly level: number };
}

/**
 * Whether this casting may store the spell it names — SRD Glyph of Warding:
 * "You can store a prepared spell of level 3 or lower in the glyph by casting
 * it as part of creating the glyph. The spell must target a single creature or
 * an area." With the higher-slot line read in: "you can store any spell of up
 * to the same level as the spell slot you use for the Glyph of Warding".
 *
 * **One guard, asked twice**: at the declaration, before the glyph's rite
 * begins, and again at the settlement an hour later, where the stored spell is
 * actually cast — for the reason the glyph's own route is re-derived there.
 * Null where the casting stores nothing. `glyphSlot` is the level of the
 * glyph's own slot where it has one, so a stored spell cast from a slot of the
 * same level is asked for two of them rather than one. (W7-S21)
 */
export function storedSpellProblem(
  state: GameState,
  caster: CreatureState,
  glyph: SpellDefinition,
  stores: StoredSpellRequest | undefined,
  castLevel: number,
  glyphSlot: number | null,
  content: Content,
): Result<StoringPlan | null> {
  if (stores === undefined) return ok(null);
  if (glyph.triggered?.storesSpell !== true) {
    return err('stores_nothing', `${glyph.name} prints no spell glyph; a casting of it stores no spell`);
  }
  const definition = content.spell(stores.spellId);
  if (definition === null) {
    return err(
      'no_definition',
      `${stores.spellId} has no executable definition; the engine can store only a spell it executes`,
    );
  }
  // "a **prepared** spell": a class's own preparation, which is also what
  // makes it a spell of a level at all — a cantrip is not stored in a slot.
  const chosen = chooseRoute(caster.spellcasting, stores.spellId, stores.source);
  if (!chosen.ok || chosen.value.kind !== 'prepared') {
    return err(
      'stored_not_prepared',
      `${definition.name} is not a spell ${caster.id} has prepared${chosen.ok ? '' : ` (${chosen.reason})`}; only a prepared spell is stored in ${glyph.name}`,
    );
  }
  const level = stores.slotLevel;
  if (!Number.isInteger(level) || level < definition.level) {
    return err('slot_too_small', `a level ${definition.level} spell does not fit in a level ${level} slot`);
  }
  if (level > castLevel) {
    return err(
      'stored_level_too_high',
      `${glyph.name} cast at level ${castLevel} stores a spell of up to that level, and ${definition.name} would be cast at level ${level}`,
    );
  }
  // "The spell must target a single creature or an area" — a creature named,
  // not the caster alone; or a template placed at a point, which is what can
  // be centred on the creature that set the glyph off.
  const aimsAtOne =
    definition.area === undefined && definition.targets.count === 1 && definition.range.kind !== 'self';
  const aimsAtArea = definition.area !== undefined && definition.area.origin === 'point';
  const swings =
    castOnAHit(definition) || definition.effects.some((effect) => effect.kind === 'weapon-attack');
  if ((!aimsAtOne && !aimsAtArea) || swings) {
    return err(
      'stored_targets_nothing',
      `${definition.name} does not target a single creature or an area, so ${glyph.name} cannot hold it`,
    );
  }
  // A rite of a minute or more is a casting settled on the clock, and a glyph
  // taking effect is a moment: the engine has no way to hold one inside the
  // other, which is its limit and not the book's.
  if (definition.castingTime === 'long') {
    return err(
      'stored_spell_too_long',
      `${definition.name} takes a minute or more to cast, and the engine cannot hold a rite inside ${glyph.name}; that is a limit of this engine rather than of the SRD`,
    );
  }
  // The facts a casting of it states, held to the validator every casting
  // meets — said now, because nobody is asked anything when it goes off.
  const stated = declaredFacts(state, definition, {
    spellId: stores.spellId,
    targets: [],
    ...(stores.damageType === undefined ? {} : { damageType: stores.damageType }),
    ...(stores.choice === undefined ? {} : { choice: stores.choice }),
    ...(stores.option === undefined ? {} : { option: stores.option }),
  });
  if (!stated.ok) return stated;
  // Its own slot, beside the glyph's — two of one level where both are.
  const kind = chooseSlotKind(caster, level, undefined);
  if (!kind.ok) return kind;
  const key = slotKeyOf(kind.value, level);
  const wanted = glyphSlot === level ? 2 : 1;
  const left = remaining(caster.resources, key);
  if (left < wanted) {
    return err(
      'no_slot',
      `${glyph.name} and the ${definition.name} stored in it want ${wanted} level ${level} slots, and ${caster.id} has ${left}`,
    );
  }
  return ok({ stores, definition, route: chosen.value, slot: { key, level } });
}

/**
 * The stored spell cast "as part of creating the glyph": its `spell-cast` —
 * the slot spent, the casting id begun, no Concentration and no Duration,
 * because "the spell being stored has no immediate effect" — and the record
 * the glyph keeps of it.
 *
 * `state` is the world the id is read from: the stored spell's casting begins
 * immediately after the glyph's own. (W7-S21)
 */
export function storedSpellCast(
  state: GameState,
  casterId: CharacterId,
  plan: StoringPlan,
): { readonly event: GameEvent; readonly stored: StoredCasting } {
  const caster = state.creatures[casterId]!;
  const castingId = `cast:${state.castingsBegun + 1}`;
  const numbers = numbersFor(
    state,
    casterId,
    sheetAsItStands(state, casterId) ?? caster.sheet,
    plan.route,
  );
  return {
    event: {
      type: 'spell-cast',
      castingId,
      id: casterId,
      spell: plan.definition.name,
      level: plan.slot.level,
      slot: plan.slot,
      slotless: null,
      castingTime: plan.definition.castingTime,
      concentration: false,
      route: routeLabel(plan.route),
    },
    stored: {
      ...plan.stores,
      castingId,
      classId: plan.route.classId,
      ability: plan.route.ability,
      numbers,
    },
  };
}

/**
 * "When the glyph is triggered, the stored spell takes effect."
 *
 * Through `castOrRelease`'s held path — the one a readied spell is let go by,
 * and for the same reason: the slot went when the spell was cast, so nothing
 * is paid, no action is spent and no trigger is asked. The request is the
 * stored one aimed at the creature the DM named: "If the spell has a target,
 * it targets the creature that triggered the glyph. If the spell affects an
 * area, the area is centered on that creature." It is measured from nowhere —
 * the glyph, not the caster, is where the spell comes from — so the stored
 * spell's Range and its "a creature you can see" are not asked, and the route
 * and the numbers are the ones pinned at the inscription.
 *
 * "If the spell requires Concentration, it lasts until the end of its full
 * duration": the `spell-cast` at the inscription held no Concentration, and
 * the stored spell's own clock starts here, as a released readied spell's
 * does. Then the glyph ends, because a triggered glyph is spent. (W7-S21)
 */
function releaseStoredSpell(
  state: GameState,
  glyphId: string,
  casterId: CharacterId,
  stored: StoredCasting,
  by: CharacterId,
  supply: Supply,
  stamp: CommandStamp | null,
): Result<SpellResolution> {
  const definition = supply.content.spell(stored.spellId);
  if (definition === null) {
    return err('no_definition', `${stored.spellId} has no executable definition`);
  }
  if (state.creatures[by] === undefined) {
    return err(
      'unknown_creature',
      `${by} has no record here; the creature that triggered a glyph is one the table has added`,
    );
  }
  // Centred on the creature, for an area: where it stands is a fact the scene
  // holds, and a creature nobody has placed cannot have an area centred on it.
  let at: Point | undefined;
  if (definition.area !== undefined) {
    const standing = state.scene === null ? null : positionOf(state.scene, by);
    if (standing === null) {
      return err(
        'unplaced',
        `${definition.name} is centred on the creature that triggered ${glyphId}, and nobody has placed ${by}`,
      );
    }
    at = standing;
  }
  const request: CastSpellRequest = {
    spellId: stored.spellId,
    targets: definition.targets.count > 0 ? [by] : [],
    ...(at === undefined ? {} : { at }),
    slotLevel: stored.slotLevel,
    ...(stored.source === undefined ? {} : { source: stored.source }),
    ...(stored.damageType === undefined ? {} : { damageType: stored.damageType }),
    ...(stored.choice === undefined ? {} : { choice: stored.choice }),
    ...(stored.option === undefined ? {} : { option: stored.option }),
  };
  const resolved = castOrRelease(
    state,
    casterId,
    request,
    supply,
    { castingId: stored.castingId },
    undefined,
    {
      route: { kind: 'prepared', ability: stored.ability, classId: stored.classId },
      numbers: stored.numbers,
    },
  );
  if (!resolved.ok) return resolved;

  const events: GameEvent[] = [...resolved.value.events];
  // The stored spell's full duration, from the moment it takes effect — the
  // arithmetic a released readied spell's clock is started with.
  if (definition.durationSeconds !== undefined && !untilDispelledAt(definition, stored.slotLevel)) {
    const timer = schedule(
      events.reduce(applyEvent, state),
      { kind: 'casting', castingId: stored.castingId },
      { kind: 'seconds', seconds: durationSecondsAt(definition, stored.slotLevel)! },
    );
    if (!timer.ok) return timer;
    events.push(timer.value);
  }
  // "Once a glyph is triggered, this spell ends."
  events.push({
    type: 'spell-ended',
    castingId: glyphId,
    on: null,
    reason: 'triggered',
    ...(stamp === null ? {} : { command: stamp }),
  });
  return ok({
    events,
    castingId: glyphId,
    outcomes: resolved.value.outcomes,
    unverified: resolved.value.unverified,
  });
}
