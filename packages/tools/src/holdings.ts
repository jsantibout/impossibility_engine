/**
 * What one character holds, and what is left of it.
 *
 * `observe.ts` answers "what is going on" for the whole table; this answers
 * "what have I got" for one creature, and the split is deliberate. A caller
 * choosing what to do on its turn needs its slots, its pools and the features
 * it may switch on; a caller narrating the room needs none of them, and folding
 * a feature inventory into every `look` would multiply the largest read on the
 * surface by the size of the roster.
 *
 * **Nothing here decides a rule, and in particular nothing here decides
 * whether a feature may be used right now.** The report says what the
 * character has, what the feature costs, what is left of the pool it draws on
 * and whether it is already running; whether the engine will allow it is the
 * *command's* answer, and asking the question twice in two places is how two
 * answers drift. The one thing this adds beyond the record is `spentBy` — the
 * name of the tool that spends each feature — which is the same closing of a
 * loop `Establish.tools` already does for a fact that must be established: a
 * feature a caller is told it holds and cannot find a door for is half a door.
 *
 * Every number is read off `GameState` through the engine's own readers where
 * one exists — {@link armorClassOf} and {@link speedOf} rather than the sheet,
 * because a caller shown the base number would be reasoning against a number
 * the engine never uses.
 */

import type { CharacterId } from '@ie/shared';
import type { GameState } from '@ie/engine';
import {
  armorClassOf,
  movementLeftFor,
  pactSlotKey,
  speedOf,
  spellSlotKey,
} from '@ie/engine';

const SLOT_LEVELS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

/**
 * The tools that spend a feature, by the shape of the feature on the sheet.
 *
 * A record rather than a string beside each branch, because the point of the
 * field is that a caller can dispatch on it: `holdings.test.ts` asserts every
 * name here is a tool this surface really publishes.
 */
export const SPENT_BY = {
  activated: 'activate_feature',
  'self-heal': 'heal_with_feature',
  'healing-touch': 'draw_on_healing_pool',
  recovery: 'regain_uses',
  /** A pool with a menu: SRD Channel Divinity's Turn Undead, Divine Spark. */
  'pool-option': 'use_pool_option',
  /** Elected on a casting rather than spent on its own — `usingFeatures`. */
  'casting-election': 'cast_spell',
} as const;

export type SpendableKind = keyof typeof SPENT_BY;

/**
 * What kind of thing a feature is, from the caller's point of view.
 *
 * `reaction` and `passive` have no door and say so: a Reaction a feature
 * offers is reported by `options` when a window opens for it, and a passive
 * benefit is never anybody's to spend.
 */
export type HeldFeatureKind = SpendableKind | 'reaction' | 'passive';

export interface HeldSlots {
  readonly level: number;
  readonly max: number;
  readonly spent: number;
  readonly left: number;
}

export interface HeldPool {
  readonly key: string;
  /** How to say it out loud: "Rage", "Lay On Hands". */
  readonly label: string;
  readonly max: number;
  readonly spent: number;
  readonly left: number;
  /** What refills it: a Short Rest, a Long Rest, a dawn, or something special. */
  readonly recovers: string;
  /** Uses a **Short** Rest gives back without refilling it, where it does. */
  readonly regainsOnShortRest: number | null;
}

/** One item off a pool's menu, named by the call that spends a use on it. */
export interface HeldPoolOption {
  /** The id `use_pool_option.option` takes — SRD's `turn-undead`. */
  readonly option: string;
  /** What the log calls it: SRD's "Turn Undead". */
  readonly name: string;
  readonly action: 'action' | 'bonus-action';
}

export interface HeldFeature {
  readonly feature: string;
  readonly name: string;
  readonly kind: HeldFeatureKind;
  /** The tool that spends it, or null where nothing on this surface does. */
  readonly spentBy: string | null;
  /** What using it costs in the action economy, where it costs anything. */
  readonly action: 'action' | 'bonus-action' | 'none' | null;
  /** The pool it draws on, and what is left of that pool. */
  readonly pool: string | null;
  readonly left: number | null;
  /** Running right now. Only a feature that is switched on is ever true. */
  readonly active: boolean;
  /** An activation's deadline, and the two ways out nobody commands. */
  readonly lasts?: string;
  readonly endsOn?: readonly string[];
  readonly forbidsCasting?: boolean;
  /**
   * The longest the feature's own sentence says it may be maintained, in
   * seconds — SRD Rage's "up to 10 minutes".
   *
   * **Reported precisely because nothing enforces it.** It is pinned onto the
   * sheet at creation and read by no engine command, so a table that wants the
   * bound kept has to keep it, and a caller that is never shown it cannot. The
   * other two bounds beside it *are* the engine's: `lasts` is a real deadline
   * and `endsOn` really ends the feature.
   */
  readonly capSeconds?: number;
  /**
   * What a use of this feature's pool buys, for a pool with a menu.
   *
   * SRD Channel Divinity is one feature, one pool and several named purchases
   * at one use apiece, and `use_pool_option` is asked for the feature *and*
   * the option — so a caller shown the feature and not the menu has been told
   * half of what it needs to type the call. Each carries its own price in the
   * action economy, because the SRD writes one per option rather than one per
   * feature.
   */
  readonly options?: readonly HeldPoolOption[];
  /** A healing touch's conditions, and what each one costs out of the pool. */
  readonly lifts?: readonly string[];
  readonly costPerCondition?: number;
  /** A recovery's other pool, and the moment its own sentence names. */
  readonly restores?: string;
  readonly moment?: string;
  /** A Reaction's window, and whether the SRD spends a Reaction on it. */
  readonly window?: string;
  readonly costsReaction?: boolean;
}

/** One class's half of what a character can cast, on that class's terms. */
export interface HeldCastingClass {
  readonly classId: string;
  /** SRD: "you use the spellcasting ability of that class". */
  readonly ability: string;
  /** Which pool this class's own slots live in — `spellSlots` or `pactSlots`. */
  readonly slotKind: string;
  readonly cantrips: readonly string[];
  readonly prepared: readonly string[];
}

/**
 * A spell a feat or a feature granted, and how it is paid for.
 *
 * `source` is what `cast_spell.source` wants when two routes would serve, and
 * `freeCastPool` with what is left of it is what `cast_spell.payment` chooses
 * between: SRD Magic Initiate's "once without a spell slot" is a pool of one,
 * and spending it instead of a slot is a decision the engine refuses to make.
 */
export interface HeldGrantedSpell {
  readonly spellId: string;
  readonly source: string;
  readonly freeCastPool: string | null;
  /** Free castings left, or null where the grant has no pool of its own. */
  readonly left: number | null;
  readonly slotCasting: boolean;
}

export interface HeldBudget {
  readonly action: boolean;
  readonly bonusAction: boolean;
  readonly reaction: boolean;
  readonly movementFeet: number;
}

export interface Holdings {
  readonly who: string;
  readonly name: string;
  readonly level: number;
  readonly hp: number;
  readonly hpMax: number;
  readonly temporaryHp: number;
  readonly dead: boolean;
  readonly armorClass: number;
  readonly speed: number;
  readonly conditions: readonly string[];
  readonly concentratingOn: string | null;
  /**
   * What this character can cast and by which route.
   *
   * Reported because a caster that cannot see its own list types spell ids
   * from memory — and because the two refusals that ask *which* route casts a
   * spell, `class_required` and `payment_required`, name fields whose answers
   * are on no other read.
   */
  readonly spellcasting: {
    readonly classes: readonly HeldCastingClass[];
    readonly granted: readonly HeldGrantedSpell[];
  };
  /** Null outside a fight, where there is no action economy to report. */
  readonly budget: HeldBudget | null;
  readonly spellSlots: readonly HeldSlots[];
  /** Pact Magic, kept apart because it is a different resource at the same level. */
  readonly pactSlots: readonly HeldSlots[];
  /** Every other limited-use pool, slots excluded: they are the two lists above. */
  readonly pools: readonly HeldPool[];
  readonly features: readonly HeldFeature[];
}

/** One pool as a slot line, or null where the creature has no such pool. */
const slotAt = (
  state: GameState,
  who: string,
  key: string,
  level: number,
): HeldSlots | null => {
  const pool = state.creatures[who]?.resources.pools[key];
  if (pool === undefined) return null;
  return { level, max: pool.max, spent: pool.spent, left: pool.max - pool.spent };
};

const leftIn = (state: GameState, who: string, key: string | null): number | null => {
  if (key === null) return null;
  const pool = state.creatures[who]?.resources.pools[key];
  return pool === undefined ? null : pool.max - pool.spent;
};

/**
 * Everything one character holds.
 *
 * Null for a creature the engine has never been told about, which the tool
 * turns into the request that would settle it — a thin record is homework
 * rather than a verdict.
 */
export function holdingsOf(state: GameState, id: CharacterId): Holdings | null {
  const who = String(id);
  const creature = state.creatures[who];
  if (creature === undefined) return null;

  const sheet = creature.sheet;
  const budget = state.combat?.budgets[who];
  const active = creature.activeFeatures;

  const slotKeys = new Set<string>();
  const spellSlots: HeldSlots[] = [];
  const pactSlots: HeldSlots[] = [];
  for (const level of SLOT_LEVELS) {
    const spell = spellSlotKey(level);
    const pact = pactSlotKey(level);
    slotKeys.add(spell);
    slotKeys.add(pact);
    const asSpell = slotAt(state, who, spell, level);
    if (asSpell !== null) spellSlots.push(asSpell);
    const asPact = slotAt(state, who, pact, level);
    if (asPact !== null) pactSlots.push(asPact);
  }

  const pools: HeldPool[] = Object.values(creature.resources.pools)
    .filter((pool) => !slotKeys.has(pool.key))
    .map((pool) => ({
      key: pool.key,
      label: pool.label,
      max: pool.max,
      spent: pool.spent,
      left: pool.max - pool.spent,
      recovers: pool.recovers,
      regainsOnShortRest: pool.regainsOnShortRest ?? null,
    }));

  /**
   * One line per feature, and the **first** claim on an id wins.
   *
   * A feature is usually one thing, but Rage is two: it is an activation, and
   * while it runs it is also three standing effects carrying its own id. The
   * order below is therefore spendable kinds first and the standing effects
   * last, so Rage reads as the thing a caller can switch on rather than as a
   * damage resistance it can do nothing with. A feature that grants several
   * standing effects likewise reports once rather than once per grant.
   */
  const features: HeldFeature[] = [];
  const named = new Set<string>();
  const add = (entry: HeldFeature): void => {
    if (named.has(entry.feature)) return;
    named.add(entry.feature);
    features.push(entry);
  };

  for (const one of sheet.activated ?? []) {
    add({
      feature: one.feature,
      name: one.name,
      kind: 'activated',
      spentBy: SPENT_BY.activated,
      action: one.action,
      pool: one.pool,
      left: leftIn(state, who, one.pool),
      active: active.includes(one.feature),
      lasts: one.lasts,
      ...(one.endsOn === undefined ? {} : { endsOn: one.endsOn }),
      ...(one.forbidsCasting === undefined ? {} : { forbidsCasting: one.forbidsCasting }),
      ...(one.capSeconds === undefined ? {} : { capSeconds: one.capSeconds }),
    });
  }

  for (const one of sheet.selfHeals ?? []) {
    add({
      feature: one.feature,
      name: one.name,
      kind: 'self-heal',
      spentBy: SPENT_BY['self-heal'],
      action: one.action,
      pool: one.pool,
      left: leftIn(state, who, one.pool),
      active: false,
    });
  }

  for (const one of sheet.healingTouch ?? []) {
    add({
      feature: one.feature,
      name: one.name,
      kind: 'healing-touch',
      spentBy: SPENT_BY['healing-touch'],
      action: one.action,
      pool: one.pool,
      left: leftIn(state, who, one.pool),
      active: false,
      lifts: one.lifts,
      costPerCondition: one.costPerCondition,
    });
  }

  for (const one of sheet.recoveries ?? []) {
    add({
      feature: one.feature,
      name: one.name,
      kind: 'recovery',
      spentBy: SPENT_BY.recovery,
      action: null,
      pool: one.pool,
      left: leftIn(state, who, one.pool),
      active: false,
      restores: one.restores,
      moment: one.moment,
    });
  }

  /**
   * A pool with a menu, reported once per **feature** and not once per option.
   *
   * SRD Channel Divinity is one feature whose uses buy any of three things, so
   * three lines would report three pools of two uses where there is one pool of
   * two. The options ride on the single line instead, which is also the shape
   * the call takes: `use_pool_option` is asked for a feature and an option.
   *
   * **This is the gap `spentBy` exists to prevent, and it was open.** A Cleric
   * was told it held Channel Divinity — the pool is on `pools` — and no feature
   * line named a tool for it, because this file enumerated every other host of
   * an effect list and not this one. The engine has executed Turn Undead and
   * Divine Spark since the week a pool use became the third host.
   */
  const menus = new Map<string, HeldPoolOption[]>();
  for (const one of sheet.poolOptions ?? []) {
    const found = menus.get(one.feature);
    const entry = { option: one.option, name: one.name, action: one.action };
    if (found === undefined) menus.set(one.feature, [entry]);
    else found.push(entry);
  }
  for (const one of sheet.poolOptions ?? []) {
    const options = menus.get(one.feature) ?? [];
    add({
      feature: one.feature,
      name: one.featureName,
      kind: 'pool-option',
      spentBy: SPENT_BY['pool-option'],
      // The price is the option's rather than the feature's — the SRD prints a
      // casting time per entry on the menu — so the feature reports one only
      // where every option agrees on it, and the options carry their own.
      action: options.every((entry) => entry.action === options[0]!.action)
        ? options[0]!.action
        : null,
      pool: one.pool,
      left: leftIn(state, who, one.pool),
      active: false,
      options,
    });
  }

  for (const one of sheet.reactions ?? []) {
    add({
      feature: one.feature,
      name: one.name,
      kind: 'reaction',
      // No door yet: `options` reports a Reaction when a window opens for it,
      // and nothing on this surface takes one but an Opportunity Attack.
      spentBy: null,
      action: null,
      pool: one.pool,
      left: leftIn(state, who, one.pool),
      active: false,
      window: one.window,
      costsReaction: one.costsReaction,
    });
  }

  /**
   * The standing effects, split by whether the casting they reach has to name
   * them.
   *
   * SRD writes an elective feature as "you can" — Elemental Affinity,
   * Empowered Evocation, Overchannel — and the engine adds nothing unless the
   * casting elects it. That is the whole of what `cast_spell.usingFeatures`
   * carries, and a caller that has not been told which features are electable
   * cannot fill it in.
   *
   * **This is the one place in this file that answers a question the engine
   * also answers, and the copy is not exact.** `electableCastingDamage` in
   * `standing.ts` is the engine's own answer and is deliberately disclosed
   * here rather than left to be discovered: it is not on `@ie/engine`'s
   * barrel, so this layer cannot call it, and putting it there is an engine
   * change that was out of scope for the task that wrote this. The copy reads
   * the sheet's own declarations where the engine reads `standingFor`, and
   * `standingFor` does two things more:
   *
   * - it folds in **an item's** grants, so an optional casting-damage grant on
   *   a magic item is electable and would not be listed here;
   * - it drops an effect whose `requires` are not met right now, so one with an
   *   unmet requirement would be listed here and then refused `no_such_feature`
   *   by the casting — a misleading refusal produced by this report.
   *
   * Neither is reachable in the SRD catalogue today: all three optional grants
   * are self-reach class features with no `requires`. Both are reachable by
   * *content alone*, with no engine change, which is what makes exporting
   * `electableCastingDamage` and calling it the fix rather than a tidy-up.
   */
  for (const effect of sheet.standing ?? []) {
    const elective = effect.grant.kind === 'casting-damage' && effect.grant.optional === true;
    add({
      feature: effect.feature,
      name: effect.name,
      kind: elective ? 'casting-election' : 'passive',
      spentBy: elective ? SPENT_BY['casting-election'] : null,
      action: null,
      pool: null,
      left: null,
      active: false,
    });
  }

  return {
    who: creature.id,
    name: creature.name,
    level: sheet.level,
    hp: creature.vitals.hp,
    hpMax: creature.vitals.hpMax,
    temporaryHp: creature.vitals.temporaryHp,
    dead: creature.vitals.dead,
    armorClass: armorClassOf(state, creature.id),
    speed: speedOf(state, creature.id),
    conditions: creature.conditions.conditions,
    concentratingOn: creature.concentration?.spell ?? null,
    spellcasting: {
      classes: creature.spellcasting.classes.map((entry) => ({
        classId: entry.classId,
        ability: entry.ability,
        slotKind: entry.slotKind,
        cantrips: entry.cantrips,
        prepared: entry.prepared,
      })),
      granted: creature.spellcasting.granted.map((entry) => ({
        spellId: entry.spellId,
        source: entry.source,
        freeCastPool: entry.freeCastPool,
        left: leftIn(state, who, entry.freeCastPool),
        slotCasting: entry.slotCasting,
      })),
    },
    budget:
      budget === undefined
        ? null
        : {
            action: budget.action,
            bonusAction: budget.bonusAction,
            reaction: budget.reaction,
            movementFeet: movementLeftFor(state, creature.id) ?? 0,
          },
    spellSlots,
    pactSlots,
    pools: [...pools].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)),
    features: [...features].sort((a, b) => (a.feature < b.feature ? -1 : a.feature > b.feature ? 1 : 0)),
  };
}
