#!/usr/bin/env node
import { createRequire } from 'node:module';
import { Command } from 'commander';
import { registerOpenspecCommand } from './commands/openspec.js';

const require = createRequire(import.meta.url);
const pkg = require('../../package.json') as { version: string };

export function createProgram(): Command {
  const program = new Command();

  program
    .name('sdd')
    .description('Semantic OpenSpec validation against repository content')
    .version(pkg.version);

  registerOpenspecCommand(program);

  return program;
}

export async function main(argv: string[] = process.argv): Promise<void> {
  const program = createProgram();
  await program.parseAsync(argv);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`sdd: ${message}`);
  process.exitCode = 2;
});
