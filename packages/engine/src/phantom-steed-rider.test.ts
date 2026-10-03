import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap, isErr, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { declaredCasting } from './spellcasting.js';
import { checkSpellDefinitionValue } from './spell-schema.js';
import {
  advanceTime,
  dismissStrandedSummons,
  endOngoingSpell,
  mountCreature,
  pendingCastingsOf,
  resolveDeclaredCast,
  resolveSpell,
  strandedSummons,
} from './commands.js';
import { summonedId } from './commands/spell-effect-summon.js';

/**
 * SRD Phantom Steed's two sentences about its rider.
 *
 * > "For the duration, you or a creature you choose can ride the steed."
 * > "When the spell ends, the steed gradually fades, giving the rider 1 minute
 * > to dismount."
 *
 * **Who may ride is the caster's choice, and the mount command reads it.** The
 * casting names the creature (`CastSpellRequest.rider`); the summons pins the
 * caster and that creature on the bond (`SummonBond.riders`); anybody else is
 * refused `not_a_chosen_rider`.
 *
 * **The minute is a lifetime, not a delay.** The bond pins the span
 * (`SummonBond.fades`); when the casting ends — its hour, a dismissal, a blow
 * on the steed — the fold re-binds the steed to its summoner as a kept creature
 * lasting a minute from that moment, which is a lifetime `strandedSummons`
 * already reads. For that minute the steed is still there under its rider.
 */

const id = (s: string): CharacterId => asCharacterId(s);
const WIZ = id('wiz');
const FRIEND = id('friend');
const STRANGER = id('stranger');

const sheet = (): CharacterSheet => ({
  level: 9,
  abilities: { str: 14, dex: 14, con: 12, int: 18, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'int',
});

const added = (who: CharacterId): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(),
  maxHp: 40,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side: 'party',
});

const SETUP: readonly GameEvent[] = [
  added(WIZ),
  added(FRIEND),
  added(STRANGER),
  {
    type: 'spellcasting-declared',
    id: WIZ,
    spellcasting: declaredCasting({ ability: 'int', prepared: ['phantom-steed', 'find-familiar'] }),
  },
  {
    type: 'resource-pool-declared',
    id: WIZ,
    pool: { key: 'spell-slot:3', label: 'level 3', max: 4, recovers: 'long-rest' },
  },
  { type: 'scene-set', extent: { width: 400, depth: 400, height: 40 } },
  { type: 'landmark-added', name: 'the stable', at: { x: 100, y: 100, z: 0 } },
  { type: 'creature-placed', id: WIZ, placement: { from: { landmark: 'the stable' }, feet: 0 } },
  { type: 'creature-placed', id: FRIEND, placement: { from: { creature: WIZ }, feet: 5, bearing: 180 } },
  { type: 'creature-placed', id: STRANGER, placement: { from: { creature: WIZ }, feet: 5, bearing: 270 } },
];

const supply = (seed = 'steed') => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

/** The minute's rite, declared, waited out and settled; the steed set beside the caster. */
const summoned = (rider?: CharacterId) => {
  let log: GameEvent[] = [...SETUP];
  const declared = unwrap(
    resolveSpell(
      fold('seed', log),
      WIZ,
      { spellId: 'phantom-steed', targets: [WIZ], slotLevel: 3, ...(rider === undefined ? {} : { rider }) },
      supply(),
    ),
    'declare',
  );
  log = [...log, ...declared.events];
  const casting = pendingCastingsOf(fold('seed', log))[0]!.castingId;
  log = [...log, ...unwrap(advanceTime(fold('seed', log), 60, 'the rite'), 'minute')];
  log = [...log, ...unwrap(resolveDeclaredCast(fold('seed', log), casting, supply()), 'settle').events];
  const steed = summonedId(casting, 'phantom-steed');
  log.push({ type: 'creature-placed', id: steed, placement: { from: { creature: WIZ }, feet: 5, bearing: 90, size: 'large' } });
  return { log, casting, steed };
};

const mounts = (state: GameState, who: CharacterId, steed: CharacterId) =>
  mountCreature(state, who, steed, { willing: true });

describe('who may ride the phantom steed', () => {
  it('pins the caster and the creature the caster chose', () => {
    const { log, steed } = summoned(FRIEND);
    expect(fold('seed', log).creatures[steed]?.summonedBy?.riders).toEqual([FRIEND, WIZ].sort());
  });

  it('seats the chosen creature and refuses anybody else', () => {
    const { log, steed } = summoned(FRIEND);
    const state = fold('seed', log);
    expect(isErr(mounts(state, FRIEND, steed))).toBe(false);
    const stranger = mounts(state, STRANGER, steed);
    expect(isErr(stranger) && stranger.code).toBe('not_a_chosen_rider');
  });

  it('seats the caster whoever else was chosen, and nobody else where nobody was', () => {
    const chosen = summoned(FRIEND);
    expect(isErr(mounts(fold('seed', chosen.log), WIZ, chosen.steed))).toBe(false);

    const alone = summoned();
    const state = fold('seed', alone.log);
    expect(state.creatures[alone.steed]?.summonedBy?.riders).toEqual([WIZ]);
    expect(isErr(mounts(state, WIZ, alone.steed))).toBe(false);
    const friend = mounts(state, FRIEND, alone.steed);
    expect(isErr(friend) && friend.code).toBe('not_a_chosen_rider');
  });

  it('is refused on a spell whose summons prints no such choice', () => {
    const out = resolveSpell(
      fold('seed', SETUP),
      WIZ,
      { spellId: 'find-familiar', targets: [WIZ], slotLevel: 3, form: 'cat', rider: FRIEND } as never,
      supply(),
    );
    expect(isErr(out) && out.code).toBe('no_rider_clause');
  });
});

describe('the minute the steed takes to fade', () => {
  it('outlasts the casting by a minute, still under its rider', () => {
    const { log, casting, steed } = summoned();
    const riding = [...log, ...unwrap(mounts(fold('seed', log), WIZ, steed), 'mount')];
    const ended = [...riding, ...unwrap(endOngoingSpell(fold('seed', riding), WIZ, casting, null), 'dismissed')];
    const state = fold('seed', ended);

    expect(state.ongoing[casting]).toBeUndefined();
    expect(state.creatures[steed]).toBeDefined();
    expect(state.creatures[steed]?.summonedBy).toMatchObject({
      by: WIZ,
      castingId: null,
      kept: { lastsSeconds: 60 },
      riders: [WIZ],
    });
    expect(strandedSummons(state)).toEqual([]);
    expect(state.scene?.riding[WIZ]?.mount).toBe(steed);
  });

  it('is owed its departure when the minute is up, and not before', () => {
    const { log, casting, steed } = summoned();
    const ended = [...log, ...unwrap(endOngoingSpell(fold('seed', log), WIZ, casting, null), 'dismissed')];
    const fiftyNine = [...ended, ...unwrap(advanceTime(fold('seed', ended), 59, 'waiting'), 'wait')];
    expect(strandedSummons(fold('seed', fiftyNine))).toEqual([]);

    const sixty = [...fiftyNine, ...unwrap(advanceTime(fold('seed', fiftyNine), 1, 'waiting'), 'wait')];
    expect(strandedSummons(fold('seed', sixty))).toEqual([steed]);
    const gone = unwrap(dismissStrandedSummons(fold('seed', sixty)), 'faded');
    expect(fold('seed', [...sixty, ...gone]).creatures[steed]).toBeUndefined();
  });

  it('fades from the end of the hour as well as from a dismissal', () => {
    const { log, steed } = summoned();
    const hour = [...log, ...unwrap(advanceTime(fold('seed', log), 3600, 'the hour'), 'hour')];
    const state = fold('seed', hour);
    expect(state.creatures[steed]?.summonedBy?.kept?.lastsSeconds).toBe(60);
    expect(strandedSummons(state)).toEqual([]);
  });
});

describe('what a definition may say about either sentence', () => {
  const base = {
    id: 'homebrew-mount',
    name: 'Homebrew Mount',
    level: 3,
    school: 'illusion',
    castingTime: 'action',
    concentration: false,
    range: { kind: 'ranged', feet: 30 },
    targets: { count: 1, self: true },
    durationSeconds: 3600,
  };
  const codes = (summon: Record<string, unknown>): readonly string[] =>
    checkSpellDefinitionValue({ ...base, effects: [{ kind: 'summon', monster: 'phantom-steed', ...summon }] }).map(
      (one) => one.code,
    );

  it('accepts the two sentences as the book prints them', () => {
    expect(codes({ riddenBy: 'caster-or-chosen', fadesOver: 60 })).toEqual([]);
  });

  it('refuses another reading of who rides, and a fade of no time', () => {
    expect(codes({ riddenBy: 'anybody' })).toContain('malformed_field');
    expect(codes({ fadesOver: 0 })).toContain('bad_fade');
  });

  it('refuses a fade on a creature no casting holds', () => {
    expect(codes({ fadesOver: 60, kept: {} })).toContain('bad_fade');
  });
});
