#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveSystemPrompt } from '../dist/ai/prompt.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const fixtureRoot =
  process.argv[2] ?? resolve(repoRoot, '..', 'flood-status-recife');
const approach = process.argv[3] ?? 'permissive';
const reps = Math.max(1, Number(process.argv[4] ?? 3));
const model = process.argv[5] ?? 'deepseek-flash';

const outRoot = join(repoRoot, 'results', 'prompt-eval');
const approachDir = join(outRoot, approach);
mkdirSync(approachDir, { recursive: true });

writeFileSync(
  join(approachDir, 'prompt.txt'),
  `${resolveSystemPrompt(approach)}\n`,
);

function readKey() {
  if (process.env.DEEPSEEK_API_KEY) return process.env.DEEPSEEK_API_KEY;
  const rc = join(os.homedir(), '.zshrc');
  if (existsSync(rc)) {
    const match = readFileSync(rc, 'utf8').match(
      /DEEPSEEK_API_KEY\s*=\s*["']([^"']+)["']/,
    );
    if (match) return match[1];
  }
  return null;
}

const key = readKey();
if (!key) {
  console.error('no DEEPSEEK_API_KEY found (env or ~/.zshrc)');
  process.exit(2);
}

const cli = join(repoRoot, 'dist', 'cli', 'index.js');
const manifest = [];

for (let rep = 1; rep <= reps; rep += 1) {
  const output = join(approachDir, `run-${String(rep).padStart(2, '0')}.json`);
  const startedAt = Date.now();

  const result = spawnSync(
    process.execPath,
    [
      cli,
      'openspec',
      'validate',
      '--root',
      fixtureRoot,
      '--specs-dir',
      join(fixtureRoot, 'openspec'),
      '--provider',
      'deepseek',
      '--model',
      model,
      '--prompt',
      approach,
      '--format',
      'json',
      '--output',
      output,
      '--concurrency',
      '2',
    ],
    {
      env: { ...process.env, DEEPSEEK_API_KEY: key },
      stdio: ['ignore', 'inherit', 'inherit'],
    },
  );

  const entry = {
    approach,
    rep,
    output,
    exitCode: result.status ?? null,
    durationMs: Date.now() - startedAt,
    startedAt: new Date(startedAt).toISOString(),
  };
  manifest.push(entry);
  console.log(
    `[${approach} run ${rep}/${reps}] exit=${result.status} duration=${entry.durationMs}ms`,
  );
}

writeFileSync(
  join(approachDir, 'manifest.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
console.log('stored under', approachDir);
