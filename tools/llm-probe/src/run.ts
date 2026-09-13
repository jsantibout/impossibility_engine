/**
 * `npm run probe` — run the experiment and write down what happened.
 *
 * Wall-clock, files and a network call all live in this file and the driver.
 * Nothing below `surface.ts` knows any of them exist, which is the same
 * separation the engine keeps from the tool layer.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { GOBLIN_A, GOBLIN_B, SEED, WIZARD } from './fixture.js';
import type { FixtureVariant, IntentScript } from './fixture.js';
import { createOpenAiDriver, createScriptedDriver, readApiKey } from './drivers.js';
import type { ModelDriver } from './drivers.js';
import { runExperiment } from './harness.js';
import { report } from './metrics.js';
import { TOOLS } from './surface.js';

const here = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

interface Args {
  readonly driver: 'openai' | 'scripted';
  readonly model: string;
  readonly variant: FixtureVariant;
  readonly rounds: number;
  readonly intents: IntentScript;
  readonly out: string;
}

function parseArgs(argv: readonly string[]): Args {
  const flags = new Map<string, string>();
  for (const arg of argv) {
    const match = /^--([a-z-]+)(?:=(.*))?$/.exec(arg);
    if (match) flags.set(match[1]!, match[2] ?? 'true');
  }
  const driver = flags.get('driver') === 'scripted' ? 'scripted' : 'openai';
  const variant: FixtureVariant = flags.get('fixture') === 'thin' ? 'thin' : 'established';
  const intents: IntentScript = flags.get('intents') === 'unmodelled' ? 'unmodelled' : 'standard';
  return {
    driver,
    model: flags.get('model') ?? 'gpt-5.5',
    variant,
    rounds: Number(flags.get('rounds') ?? '4'),
    intents,
    out: flags.get('out') ?? `${driver}-${variant}`,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  let driver: ModelDriver;
  if (args.driver === 'scripted') {
    driver = createScriptedDriver(WIZARD, [GOBLIN_A, GOBLIN_B]);
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
    `probe: ${driver.name} driving the ${args.variant} tavern fixture (${args.intents} player) for ${args.rounds} round(s)...`,
  );

  const outcome = await runExperiment(driver, {
    seed: SEED,
    variant: args.variant,
    rounds: args.rounds,
    intents: args.intents,
    maxExchangesPerBeat: 8,
  });

  const title = `LLM probe — ${driver.name}, ${args.variant} fixture`;
  const markdown =
    report(title, outcome.analysis, outcome.determinism, {
      model: driver.name,
      events: outcome.log.length,
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
