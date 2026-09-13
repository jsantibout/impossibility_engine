/**
 * `npm run probe` — run the experiment and write down what happened.
 *
 * Wall-clock, files and a network call all live in this file and the driver.
 * Nothing below `surface.ts` knows any of them exist, which is the same
 * separation the engine keeps from the tool layer.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { CharacterId } from '@ie/shared';
import { WIZARD, tavernEncounter } from './fixture.js';
import type { FixtureVariant, IntentScript } from './fixture.js';
import { MAGE, ogreEncounter } from './ogre.js';
import type { Encounter } from './encounter.js';
import { createOpenAiDriver, createScriptedDriver, readApiKey } from './drivers.js';
import type { ModelDriver } from './drivers.js';
import { runExperiment } from './harness.js';
import { report, type Pricing } from './metrics.js';
import { TOOLS } from './surface.js';

const here = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

/**
 * A guess, and labelled as one everywhere it is used.
 *
 * The probe is not billed and cannot see an invoice, so this is an input to
 * the arithmetic rather than a fact about it. Every report that uses it prints
 * the rate beside the figure and the token counts beside both, so a reader
 * with the real number can rescale the whole table.
 */
const DEFAULT_PRICING: Pricing = {
  inputPerMTok: 1.25,
  cachedInputPerMTok: 0.125,
  outputPerMTok: 10,
};

interface Args {
  readonly driver: 'openai' | 'scripted';
  readonly model: string;
  readonly tier: 'tavern' | 'ogre';
  readonly variant: FixtureVariant;
  readonly rounds: number;
  readonly intents: IntentScript;
  readonly out: string;
  readonly pricing: Pricing;
}

function parseArgs(argv: readonly string[]): Args {
  const flags = new Map<string, string>();
  for (const arg of argv) {
    const match = /^--([a-z-]+)(?:=(.*))?$/.exec(arg);
    if (match) flags.set(match[1]!, match[2] ?? 'true');
  }
  const driver = flags.get('driver') === 'scripted' ? 'scripted' : 'openai';
  const tier = flags.get('encounter') === 'ogre' ? 'ogre' : 'tavern';
  const variant: FixtureVariant = flags.get('fixture') === 'thin' ? 'thin' : 'established';
  const intents: IntentScript = flags.get('intents') === 'unmodelled' ? 'unmodelled' : 'standard';
  const rate = (flag: string, fallback: number): number => {
    const raw = flags.get(flag);
    const n = raw === undefined ? Number.NaN : Number(raw);
    return Number.isFinite(n) ? n : fallback;
  };
  return {
    driver,
    model: flags.get('model') ?? 'gpt-5.5',
    tier,
    variant,
    // Four rounds is the scripted scenario's length and the length every Tier 1
    // measurement was taken over. Tier 2 keeps it so the per-round figures are
    // comparable rather than being a longer fight's average.
    rounds: Number(flags.get('rounds') ?? '4'),
    intents,
    out: flags.get('out') ?? (tier === 'ogre' ? `${driver}-ogre` : `${driver}-${variant}`),
    pricing: {
      inputPerMTok: rate('price-in', DEFAULT_PRICING.inputPerMTok),
      cachedInputPerMTok: rate('price-cached', DEFAULT_PRICING.cachedInputPerMTok),
      outputPerMTok: rate('price-out', DEFAULT_PRICING.outputPerMTok),
    },
  };
}

/**
 * Who the offline stand-in casts as.
 *
 * Apparatus, not tactics: the stand-in exists to drive every branch of the
 * surface without a network call, and it needs exactly one creature that will
 * reach for a spell so the cast path and its refusal are exercised. Everyone
 * else closes and swings.
 */
function standInCasters(tier: Args['tier']): ReadonlySet<CharacterId> {
  return new Set([tier === 'ogre' ? MAGE : WIZARD]);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const encounter: Encounter =
    args.tier === 'ogre' ? ogreEncounter() : tavernEncounter(args.variant, args.intents);

  let driver: ModelDriver;
  if (args.driver === 'scripted') {
    driver = createScriptedDriver(encounter, standInCasters(args.tier));
  } else {
    const apiKey = readApiKey(`${repoRoot}.env`);
    if (apiKey === null) {
      console.error(
        [
          'No OPENAI_API_KEY found.',
          '',
          'Set it in the environment, or write it to the repo root .env (already gitignored):',
          "  Set-Content -Path .env -Value 'OPENAI_API_KEY=sk-...' -Encoding utf8",
          '',
          'Or run the offline stand-in, which needs no key:',
          '  npm run probe -- --driver=scripted',
        ].join('\n'),
      );
      process.exitCode = 1;
      return;
    }
    driver = createOpenAiDriver({ apiKey, model: args.model, tools: TOOLS });
  }

  console.error(
    `probe: ${driver.name} driving ${encounter.id} (${encounter.roster.length} actors) for ${args.rounds} round(s)...`,
  );

  const outcome = await runExperiment(driver, {
    encounter,
    rounds: args.rounds,
    maxExchangesPerBeat: 8,
  });

  const title = `LLM probe — ${driver.name}, ${encounter.id}`;
  const markdown =
    report(title, outcome.analysis, outcome.determinism, {
      model: driver.name,
      events: outcome.log.length,
      pricing: args.pricing,
    }) +
    `\n## Harness interventions\n\n${outcome.interventions} turn(s) had to be ended by the harness because the model did not.\n`;

  const runs = `${here}../runs`;
  mkdirSync(runs, { recursive: true });
  writeFileSync(`${runs}/${args.out}.md`, markdown, 'utf8');
  writeFileSync(
    `${runs}/${args.out}.json`,
    JSON.stringify({ transcript: outcome.transcript, log: outcome.log }, null, 2),
    'utf8',
  );

  console.log(markdown);
  console.error(`probe: wrote runs/${args.out}.md and runs/${args.out}.json`);
}

await main();
