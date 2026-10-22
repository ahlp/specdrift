import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import YAML from "yaml";
import { z } from "zod";
import { DEFAULT_MAX_CONTEXT_BYTES } from "../ai/prompt.js";
import { DEFAULT_SCAN_LIMITS } from "../repo/types.js";
import { configSchema } from "./schema.js";
import type { SpecdriftConfig } from "./schema.js";

export const CONFIG_FILE_NAMES = [
  ".specdriftrc",
  ".specdriftrc.json",
  ".specdriftrc.yaml",
  ".specdriftrc.yml",
] as const;

export interface ResolvedConfig {
  provider?: SpecdriftConfig["provider"];
  model?: string;
  baseUrl?: string;
  apiKey?: string;
  specsDir: string;
  include: string[];
  exclude: string[];
  format: "markdown" | "json" | "text";
  failOn: "error" | "warning" | "non-compliant";
  concurrency: number;
  maxTokens?: number;
  temperature?: number;
  maxFileBytes: number;
  maxTotalBytes: number;
  maxContextBytes: number;
  includeTests: boolean;
  timeoutMs?: number;
}

export interface LoadConfigOptions {
  root: string;
  overrides?: Partial<SpecdriftConfig>;
  env?: NodeJS.ProcessEnv;
  /** Set to false to skip `.specdriftrc` discovery (useful for tests). */
  file?: boolean;
}

function parseConfigContent(fileName: string, content: string): unknown {
  if (!content.trim()) return {};

  const extension = extname(fileName).toLowerCase();
  if (extension === ".json") return JSON.parse(content);
  if (extension === ".yaml" || extension === ".yml") {
    return YAML.parse(content);
  }

  // `.specdriftrc` may be either JSON or YAML.
  try {
    return JSON.parse(content);
  } catch {
    return YAML.parse(content);
  }
}

/** Read and validate the first `.specdriftrc` file found in the repository root. */
export async function readConfigFile(root: string): Promise<SpecdriftConfig> {
  for (const name of CONFIG_FILE_NAMES) {
    const path = join(root, name);
    let content: string;
    try {
      content = await readFile(path, "utf8");
    } catch {
      continue;
    }

    const raw = parseConfigContent(name, content);
    return configSchema.parse(raw ?? {});
  }

  return {};
}

function readString(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = env[key];
  return value && value.trim() !== "" ? value : undefined;
}

function readNumber(env: NodeJS.ProcessEnv, key: string): number | undefined {
  const value = readString(env, key);
  if (value === undefined) return undefined;

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`invalid numeric value for ${key}: "${value}"`);
  }
  return parsed;
}

function readBoolean(env: NodeJS.ProcessEnv, key: string): boolean | undefined {
  const value = readString(env, key)?.toLowerCase();
  if (value === undefined) return undefined;
  if (["1", "true", "yes", "on"].includes(value)) return true;
  if (["0", "false", "no", "off"].includes(value)) return false;
  throw new Error(`invalid boolean value for ${key}: "${value}"`);
}

function configFromEnv(env: NodeJS.ProcessEnv): Partial<SpecdriftConfig> {
  const config: Partial<SpecdriftConfig> = {};

  const provider = readString(env, "SPECDRIFT_PROVIDER");
  if (provider) config.provider = provider as SpecdriftConfig["provider"];

  const model = readString(env, "SPECDRIFT_MODEL");
  if (model) config.model = model;

  const baseUrl = readString(env, "SPECDRIFT_BASE_URL");
  if (baseUrl) config.baseUrl = baseUrl;

  const specsDir = readString(env, "SPECDRIFT_SPECS_DIR");
  if (specsDir) config.specsDir = specsDir;

  const format = readString(env, "SPECDRIFT_FORMAT");
  if (format) config.format = format as SpecdriftConfig["format"];

  const failOn = readString(env, "SPECDRIFT_FAIL_ON");
  if (failOn) config.failOn = failOn as SpecdriftConfig["failOn"];

  const concurrency = readNumber(env, "SPECDRIFT_CONCURRENCY");
  if (concurrency !== undefined) config.concurrency = concurrency;

  const maxTokens = readNumber(env, "SPECDRIFT_MAX_TOKENS");
  if (maxTokens !== undefined) config.maxTokens = maxTokens;

  const temperature = readNumber(env, "SPECDRIFT_TEMPERATURE");
  if (temperature !== undefined) config.temperature = temperature;

  const maxFileBytes = readNumber(env, "SPECDRIFT_MAX_FILE_BYTES");
  if (maxFileBytes !== undefined) config.maxFileBytes = maxFileBytes;

  const maxTotalBytes = readNumber(env, "SPECDRIFT_MAX_TOTAL_BYTES");
  if (maxTotalBytes !== undefined) config.maxTotalBytes = maxTotalBytes;

  const maxContextBytes = readNumber(env, "SPECDRIFT_MAX_CONTEXT_BYTES");
  if (maxContextBytes !== undefined) config.maxContextBytes = maxContextBytes;

  const includeTests = readBoolean(env, "SPECDRIFT_INCLUDE_TESTS");
  if (includeTests !== undefined) config.includeTests = includeTests;

  const timeoutMs = readNumber(env, "SPECDRIFT_TIMEOUT_MS");
  if (timeoutMs !== undefined) config.timeoutMs = timeoutMs;

  return config;
}

function formatZodError(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.join(".") || "(root)";
      return `${path}: ${issue.message}`;
    })
    .join("; ");
}

/**
 * Resolve the effective configuration with this precedence (highest first):
 *
 * 1. explicit overrides (CLI flags)
 * 2. `SPECDRIFT_*` environment variables
 * 3. `.specdriftrc` / `.specdriftrc.json` / `.specdriftrc.yaml` in the repository root
 * 4. built-in defaults
 */
export async function loadConfig(
  options: LoadConfigOptions,
): Promise<ResolvedConfig> {
  try {
    const fileConfig =
      options.file === false ? {} : await readConfigFile(options.root);
    const envConfig = configFromEnv(options.env ?? process.env);

    const mergedRaw = {
      ...fileConfig,
      ...envConfig,
      ...(options.overrides ?? {}),
    };

    const merged = configSchema.parse(mergedRaw);

    return {
      ...merged,
      specsDir: merged.specsDir ?? "./openspec",
      include: merged.include ?? [],
      exclude: merged.exclude ?? [],
      format: merged.format ?? "markdown",
      failOn: merged.failOn ?? "non-compliant",
      concurrency: merged.concurrency ?? 2,
      maxFileBytes: merged.maxFileBytes ?? DEFAULT_SCAN_LIMITS.maxFileBytes,
      maxTotalBytes: merged.maxTotalBytes ?? DEFAULT_SCAN_LIMITS.maxTotalBytes,
      maxContextBytes: merged.maxContextBytes ?? DEFAULT_MAX_CONTEXT_BYTES,
      includeTests: merged.includeTests ?? true,
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new Error(
        `invalid specdrift configuration: ${formatZodError(error)}`,
      );
    }
    throw error;
  }
}
