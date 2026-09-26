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
import type { GameEvent } from '../events.js';
import type { GameState } from '../state.js';
import { creaturesStandingInCastingArea } from '../spells.js';
import { type CommandIdentity, commandOutcome, once } from '../idempotency.js';
import type { Supply } from './casting.js';
import { resolveEffects } from './spell-resolution.js';
import type { SpellResolution } from './targeting.js';

export interface TriggerGlyphCommand extends CommandIdentity {
  /** The inscribed casting, by its id. */
  readonly castingId: string;
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
