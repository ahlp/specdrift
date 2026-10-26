import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Command } from "commander";
import {
  ProviderError,
  resolveProvider,
  resolveSystemPrompt,
} from "../../ai/index.js";
import { loadConfig } from "../../config/index.js";
import type { ResolvedConfig, SpecdriftConfig } from "../../config/index.js";
import {
  discoverOpenspec,
  OpenspecNotFoundError,
} from "../../openspec/index.js";
import { renderReport } from "../../report/index.js";
import { scanRepository } from "../../repo/index.js";
import { validateProject } from "../../validate/index.js";
import type { ValidationReport } from "../../validate/index.js";

export interface ValidateCliOptions {
  specsDir?: string;
  root?: string;
  provider?: string;
  model?: string;
  baseUrl?: string;
  apiKey?: string;
  format?: string;
  output: string;
  failOn?: string;
  prompt?: string;
  include?: string[];
  exclude?: string[];
  maxTokens?: number;
  concurrency?: number;
  timeout?: number;
  verbose: boolean;
}

function cliOverrides(options: ValidateCliOptions): Partial<SpecdriftConfig> {
  const overrides: Partial<SpecdriftConfig> = {};

  if (options.specsDir !== undefined) overrides.specsDir = options.specsDir;
  if (options.provider !== undefined) {
    overrides.provider = options.provider as SpecdriftConfig["provider"];
  }
  if (options.model !== undefined) overrides.model = options.model;
  if (options.baseUrl !== undefined) overrides.baseUrl = options.baseUrl;
  if (options.apiKey !== undefined) overrides.apiKey = options.apiKey;
  if (options.format !== undefined) {
    overrides.format = options.format as SpecdriftConfig["format"];
  }
  if (options.failOn !== undefined) {
    overrides.failOn = options.failOn as SpecdriftConfig["failOn"];
  }
  if (options.prompt !== undefined) {
    overrides.prompt = options.prompt as SpecdriftConfig["prompt"];
  }
  if (options.include !== undefined) overrides.include = options.include;
  if (options.exclude !== undefined) overrides.exclude = options.exclude;
  if (options.maxTokens !== undefined) overrides.maxTokens = options.maxTokens;
  if (options.concurrency !== undefined) {
    overrides.concurrency = options.concurrency;
  }
  if (options.timeout !== undefined) {
    overrides.timeoutMs = options.timeout;
  }

  return overrides;
}

/**
 * Map a report to an exit code:
 *
 * - `error`: fail only when validation could not run for a spec.
 * - `non-compliant` (default): fail on non-compliant or unimplemented scenarios.
 * - `warning`: also fail on inconclusive scenarios or spec errors.
 */
export function decideExitCode(
  report: ValidationReport,
  failOn: ResolvedConfig["failOn"],
): number {
  if (failOn === "error") {
    return report.specs.some((spec) => Boolean(spec.error)) ? 1 : 0;
  }

  if (report.totals.nonCompliant > 0 || report.totals.notImplemented > 0) {
    return 1;
  }

  if (
    failOn === "warning" &&
    (report.totals.inconclusive > 0 ||
      report.specs.some((spec) => Boolean(spec.error)))
  ) {
    return 1;
  }

  return 0;
}

async function writeOutput(
  root: string,
  output: string,
  content: string,
): Promise<void> {
  if (output === "-") {
    process.stdout.write(content);
    return;
  }

  const target = resolve(root, output);
  await writeFile(target, content, "utf8");
  process.stderr.write(`specdrift: report written to ${target}\n`);
}

function reportCliError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);

  if (error instanceof OpenspecNotFoundError) {
    process.stderr.write(`specdrift: ${message}\n`);
    process.exitCode = 3;
    return;
  }

  if (error instanceof ProviderError) {
    process.stderr.write(`specdrift: ${message}\n`);
    process.exitCode = 4;
    return;
  }

  process.stderr.write(`specdrift: ${message}\n`);
  process.exitCode = 2;
}

export function registerValidateCommand(parent: Command): void {
  parent
    .command("validate")
    .description(
      "Semantically validate OpenSpec files against repository content using AI",
    )
    .option(
      "--specs-dir <path>",
      "directory containing openspec/ (default: ./openspec)",
    )
    .option("--root <path>", "repository root to scan", process.cwd())
    .option("--provider <name>", "AI provider: lmstudio | ollama | deepseek")
    .option("--model <id>", "model id/name override")
    .option("--base-url <url>", "override provider endpoint")
    .option("--api-key <key>", "API key (prefer DEEPSEEK_API_KEY env var)")
    .option("--format <fmt>", "report format: markdown | json | text")
    .option("--output <file>", "write report to a file instead of stdout", "-")
    .option(
      "--fail-on <level>",
      "exit non-zero at: error | warning | non-compliant",
    )
    .option(
      "--prompt <name>",
      "prompt preset: permissive | decision-tree | minimal | rtf (default: rtf)",
    )
    .option("--include <glob...>", "restrict source files scanned")
    .option("--exclude <glob...>", "extra ignore globs")
    .option("--max-tokens <n>", "cap per-request output tokens", (value) =>
      Number.parseInt(value, 10),
    )
    .option("--concurrency <n>", "parallel AI requests per spec", (value) =>
      Number.parseInt(value, 10),
    )
    .option(
      "--timeout <ms>",
      "provider request timeout in milliseconds",
      (value) => Number.parseInt(value, 10),
    )
    .option("--verbose", "print prompts, timing and raw responses", false)
    .action(async (cliOptions: ValidateCliOptions) => {
      const root = resolve(cliOptions.root ?? process.cwd());

      try {
        const config = await loadConfig({
          root,
          overrides: cliOverrides(cliOptions),
        });

        const specsDir = resolve(root, config.specsDir);
        const project = await discoverOpenspec(specsDir);

        if (project.specs.length === 0) {
          process.stderr.write(
            `specdrift: no OpenSpec specs found under ${specsDir}\n`,
          );
          process.exitCode = 3;
          return;
        }

        if (cliOptions.verbose) {
          process.stderr.write(
            `specdrift: discovered ${project.specs.length} spec(s) in ${specsDir}\n`,
          );
          process.stderr.write(`specdrift: scanning repository ${root}\n`);
        }

        const repo = await scanRepository({
          root,
          include: config.include,
          exclude: config.exclude,
          includeTests: config.includeTests,
          maxFileBytes: config.maxFileBytes,
          maxTotalBytes: config.maxTotalBytes,
        });

        const provider = await resolveProvider({
          provider: config.provider,
          model: config.model,
          baseUrl: config.baseUrl,
          apiKey: config.apiKey,
          timeoutMs: config.timeoutMs,
        });

        if (!provider.isLocal) {
          process.stderr.write(
            `specdrift: warning: provider "${provider.id}" is a cloud API; repository content will be sent to a third party.\n`,
          );
        }

        const report = await validateProject({
          project,
          repo,
          provider,
          model: config.model,
          temperature: config.temperature,
          maxTokens: config.maxTokens,
          concurrency: config.concurrency,
          maxContextBytes: config.maxContextBytes,
          systemPrompt: resolveSystemPrompt(config.prompt),
          verbose: cliOptions.verbose,
          logger: (message) => process.stderr.write(`${message}\n`),
          onSpecStart: (spec) =>
            process.stderr.write(`specdrift: validating ${spec.name}...\n`),
          onSpecDone: (result) => {
            const error = result.error ? ` — ${result.error}` : "";
            process.stderr.write(
              `specdrift: ${result.spec}: ${result.status} (${result.summary.compliant}/${result.summary.total} compliant)${error}\n`,
            );
          },
        });

        const useColor =
          cliOptions.output === "-" &&
          Boolean(process.stdout.isTTY) &&
          !process.env.NO_COLOR;
        const rendered = renderReport(config.format, report, {
          color: useColor,
        });
        await writeOutput(root, cliOptions.output, rendered);

        if (
          report.specs.length > 0 &&
          report.specs.every((spec) => Boolean(spec.error))
        ) {
          process.stderr.write(
            "specdrift: every spec failed to validate; check the AI provider and model.\n",
          );
          process.exitCode = 4;
          return;
        }

        process.exitCode = decideExitCode(report, config.failOn);
      } catch (error) {
        reportCliError(error);
      }
    });
}
