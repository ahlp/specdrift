import { Command } from 'commander';

export interface ValidateCliOptions {
  specsDir: string;
  root: string;
  provider?: string;
  model?: string;
  baseUrl?: string;
  apiKey?: string;
  format: 'markdown' | 'json' | 'text';
  output: string;
  failOn: 'error' | 'warning' | 'non-compliant';
  include?: string[];
  exclude?: string[];
  maxTokens?: number;
  concurrency: number;
  verbose: boolean;
}

export function registerValidateCommand(parent: Command): void {
  parent
    .command('validate')
    .description(
      'Semantically validate OpenSpec files against repository content using AI',
    )
    .option('--specs-dir <path>', 'directory containing openspec/', './openspec')
    .option('--root <path>', 'repository root to scan', process.cwd())
    .option('--provider <name>', 'AI provider: lmstudio | ollama | deepseek')
    .option('--model <id>', 'model id/name override')
    .option('--base-url <url>', 'override provider endpoint')
    .option('--api-key <key>', 'API key (prefer DEEPSEEK_API_KEY env var)')
    .option(
      '--format <fmt>',
      'report format: markdown | json | text',
      'markdown',
    )
    .option('--output <file>', 'write report to a file instead of stdout', '-')
    .option(
      '--fail-on <level>',
      'exit non-zero at: error | warning | non-compliant',
      'non-compliant',
    )
    .option('--include <glob...>', 'restrict source files scanned')
    .option('--exclude <glob...>', 'extra ignore globs')
    .option('--max-tokens <n>', 'cap per-request output tokens', (value) =>
      Number.parseInt(value, 10),
    )
    .option('--concurrency <n>', 'parallel AI requests per spec', (value) =>
      Number.parseInt(value, 10),
    2)
    .option('--verbose', 'print prompts, timing and raw responses', false)
    .action(async (options: ValidateCliOptions) => {
      console.error(
        'sdd openspec validate: not implemented yet (scaffold only)',
      );
      process.exitCode = 2;
    });
}
