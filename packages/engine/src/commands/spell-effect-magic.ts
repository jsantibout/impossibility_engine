/**
 * The two effect kinds whose subject is other magic: the spell already
 * running on the target, and the casting the target is making.
 *
 * SRD writes them as one family and the engine answers them the same way —
 * an ability check against a threshold, with every number a fact the engine
 * already holds rather than one the definition carries. Dispel Magic reads
 * what is running; the interrupt reads the casting the trigger accepted.
 */

import { ABILITY_NAMES, type CharacterId, err, ok, type Result } from '@ie/shared';
import { type D20TestResult, rollAbilityCheck, rollSavingThrow } from '../checks.js';
import {
  applyEvent,
  spellOn,
  type CreatureState,
  type GameEvent,
  type GameState,
} from '../events.js';
import { effectiveConditions, sheetAsItStands } from '../standing.js';
import { ongoingSpellsOn } from './ongoing.js';
import { checkBonuses, recordD20Test, savingSupport } from './rolls.js';
import { type EffectContext, type EffectOfKind } from './spell-effect-context.js';

/**
 * SRD Dispel Magic, against whatever is running on the target.
 *
 * **It takes no `effect`**, which is the shape of the spell rather than an
 * omission: every number Dispel Magic needs — the threshold, the DC, the
 * ability — is a fact the engine already holds, so the definition carries none
 * and there is nothing here to read off one.
 */
export function resolveDispelEffect(
  ctx: EffectContext,
  target: CharacterId,
  world: GameState,
): Result<GameState> {
  const { casterId, casterSheet, name, castLevel, ability, supply, events, outcomes } = ctx;
  let current = world;

  // SRD: "make an ability check using your spellcasting ability" — the
  // *chosen* source's, which is why it is read off the context rather than off
  // the sheet. See {@link EffectContext.ability}: a casting that has no ability
  // to roll with is refused at the route, before anything is spent, so this
  // guard is the statement that the branch is unreachable rather than a rule.
  if (ability === null) {
    return err(
      'no_spellcasting_ability',
      `${name} is resolved with an ability check using your own spellcasting ability, and ${casterId} has none to make it with`,
    );
  }

  // SRD Dispel Magic: "Any ongoing spell of level 3 or lower **on the
  // target** ends." What is on the target is live state, and before the
  // ongoing record the engine could not have answered it: a spell's
  // level lived in the log and on a concentrating caster, and neither is
  // a thing a later spell can ask about.
  const running = ongoingSpellsOn(current, target);
  if (running.length === 0) {
    outcomes.push({ target, affected: false });
    return ok(current);
  }

  for (const spell of running) {
    // SRD "Using a Higher-Level Spell Slot": "You automatically end a
    // spell on the target if the spell's level is equal to or less than
    // the level of the spell slot you use." Dispel Magic is level 3, so
    // the printed "level 3 or lower" is the same sentence read at the
    // spell's own level — one rule, not two.
    const automatic = spell.level <= castLevel;
    let rolled: D20TestResult | undefined;

    if (!automatic) {
      // "make an ability check using your spellcasting ability (DC 10
      // plus that spell's level)" — a bare ability check, no skill and
      // no proficiency, through the one calculator the engine has.
      const check = rollAbilityCheck(
        supply.issuer,
        supply.rng,
        casterSheet().sheet,
        // The caster's own spellcasting ability, which is what the sentence
        // asks for and is not a number: it decides the roll's modes and which
        // conditions fail it outright. An item's route may carry none — a wand
        // that prints its own DC in a hand that casts nothing — and
        // `castersAbilityRead` refuses such a casting at the route, before
        // anything is spent, which is why this cannot be null here.
        ability,
        {
          dc: 10 + spell.level,
          conditions: effectiveConditions(current, casterId),
          ...(supply.modes === undefined ? {} : { modes: supply.modes }),
          // A worn item's "+1 bonus to ability checks" reaches this one too:
          // the SRD makes it an ability check, and says nothing that excludes
          // it. One gatherer, so the four check sites cannot disagree.
          bonuses: checkBonuses(current, casterId, supply.bonuses),
        },
      );
      if (!check.ok) return check;

      events.push(
        recordD20Test(
          casterId,
          `${name} vs ${spell.spell} (level ${spell.level})`,
          check.value,
          check.value.success ? 'dispelled' : 'held',
        ),
      );

      if (!check.value.success) {
        // A failed check changes nothing at all. The spell runs on, the
        // slot is still spent, and the log says which.
        outcomes.push({ target, check: check.value, affected: false });
        continue;
      }
      rolled = check.value;
    }

    // Whether the whole casting ends or only its hold on this creature
    // is the distinction SRD draws by letting Dispel Magic target "one
    // creature, object, or magical effect": a spell that is on this
    // creature and nobody else has nothing left to be, so it ends, while
    // one that caught three creatures loses only this one.
    //
    // Asked of `spellOn` rather than of a field on the record: "on this
    // creature and nobody else" is the stored half unioned with whoever the
    // casting is still holding something on, and reading the stored half alone
    // would end a whole Bless because the record remembered aiming at nobody.
    const whole = spellOn(current, spell).length <= 1;
    const ended: GameEvent = {
      type: 'spell-ended',
      castingId: spell.castingId,
      on: whole ? null : target,
      reason: 'dispelled',
    };
    events.push(ended);
    current = applyEvent(current, ended);

    outcomes.push({
      target,
      // Present only when the spell was high enough to need one, which
      // is the difference between the two halves of the SRD's sentence.
      ...(rolled === undefined ? {} : { check: rolled }),
      dispelled: spell.castingId,
      affected: true,
    });
  }
  return ok(current);
}

/**
 * SRD Counterspell: the save that decides whether a casting dissipates.
 */
export function resolveInterruptCastingEffect(
  ctx: EffectContext,
  effect: EffectOfKind<'interrupt-casting'>,
  target: CharacterId,
  victim: CreatureState,
  world: GameState,
): Result<GameState> {
  const { casterId, name, supply, events, outcomes, saveDc, answers } = ctx;
  let current = world;

  // SRD Counterspell: "The creature makes a Constitution saving throw.
  // On a failed save, the spell dissipates with no effect."
  //
  // The window was proved open by the trigger before anything was spent.
  // It is read again here because the events emitted since — the
  // Counterspell's own casting — have been folded in, and reading the
  // stale copy would be reading a different game than the one being
  // changed.
  //
  // **By the id the trigger resolved**, which is what the keyed record made
  // necessary and what makes the two reads provably the same casting: several
  // may be open, and several may belong to one caster, so "the" casting is no
  // longer a thing to read.
  const open = answers === undefined ? undefined : current.pendingCastings[answers];
  if (open === undefined) {
    return err(
      'nothing_to_interrupt',
      `${name} found no casting in progress to interrupt`,
    );
  }

  const support = savingSupport(current, target, victim, effect.ability, supply);
  // The sheet as it stands, so an Amulet of Health reaches the Constitution
  // save SRD Counterspell asks the interrupted caster for. Read off `current`,
  // which has the Counterspell's own casting folded into it.
  const sheet = sheetAsItStands(current, target) ?? victim.sheet;
  const save = rollSavingThrow(supply.issuer, supply.rng, sheet, effect.ability, {
    dc: saveDc,
    conditions: support.conditions,
    modes: support.modes,
    bonuses: support.bonuses,
  });
  if (!save.ok) return save;

  events.push(
    recordD20Test(
      target,
      `${ABILITY_NAMES[effect.ability]} save vs ${name}`,
      save.value,
      save.value.success ? 'resisted' : 'affected',
    ),
  );

  // A success buys the caster nothing beyond their spell going ahead —
  // the SRD states no other consequence, so neither does this.
  if (save.value.success) {
    outcomes.push({ target, save: save.value, affected: false });
    return ok(current);
  }

  const interrupted: GameEvent = {
    type: 'spell-interrupted',
    castingId: open.castingId,
    id: open.caster,
    by: casterId,
    reason: 'countered',
  };
  events.push(interrupted);
  current = applyEvent(current, interrupted);

  outcomes.push({
    target,
    save: save.value,
    affected: true,
    interrupted: open.castingId,
  });
  return ok(current);
}
