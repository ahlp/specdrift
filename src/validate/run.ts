import { buildMessages } from "../ai/prompt.js";
import type { Provider, ProviderId } from "../ai/provider.js";
import { parseSpecFile } from "../openspec/parse.js";
import type {
  DiscoveredSpec,
  OpenspecProject,
  ParseWarning,
  Spec,
} from "../openspec/types.js";
import type { RepoContext } from "../repo/types.js";
import {
  extractJson,
  inconclusiveFinding,
  parseValidationResponse,
  specStatusFromSummary,
  summarizeFindings,
} from "./result.js";
import type { Finding, FindingSummary, SpecStatus } from "./result.js";

export interface SpecValidationResult {
  spec: string;
  specPath: string;
  status: SpecStatus;
  findings: Finding[];
  summary: FindingSummary;
  requirements: number;
  durationMs: number;
  error?: string;
  warnings?: ParseWarning[];
}

export interface ReportTotals extends FindingSummary {
  specs: number;
  requirements: number;
}

export interface ValidationReport {
  generatedAt: string;
  root: string;
  provider: ProviderId;
  model?: string;
  specs: SpecValidationResult[];
  totals: ReportTotals;
}

export interface ValidateProjectOptions {
  project: OpenspecProject;
  repo: RepoContext;
  provider: Provider;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  concurrency?: number;
  maxContextBytes?: number;
  systemPrompt?: string;
  signal?: AbortSignal;
  verbose?: boolean;
  logger?: (message: string) => void;
  onSpecStart?: (spec: DiscoveredSpec) => void;
  onSpecDone?: (result: SpecValidationResult) => void;
}

function normalizeTitle(value: string): string {
  return value
    .toLowerCase()
    .replace(/^\s*#{1,6}\s*/, "")
    .replace(/^requirement\s*:\s*/, "")
    .replace(/^scenario\s*:\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Align model findings with the parsed spec.
 *
 * Guarantees exactly one finding per scenario: missing findings become
 * `inconclusive`, and returned titles are replaced with the spec's exact
 * titles. Findings for scenarios not present in the spec are dropped.
 */
export function reconcileFindings(spec: Spec, findings: Finding[]): Finding[] {
  const byPair = new Map<string, Finding>();
  const byScenario = new Map<string, Finding>();

  for (const finding of findings) {
    const requirement = normalizeTitle(finding.requirement);
    const scenario = normalizeTitle(finding.scenario);
    if (!scenario) continue;

    const pairKey = `${requirement}::${scenario}`;
    if (!byPair.has(pairKey)) byPair.set(pairKey, finding);
    if (!byScenario.has(scenario)) byScenario.set(scenario, finding);
  }

  const reconciled: Finding[] = [];

  for (const requirement of spec.requirements) {
    const requirementKey = normalizeTitle(requirement.title);

    for (const scenario of requirement.scenarios) {
      const scenarioKey = normalizeTitle(scenario.title);
      const matched =
        byPair.get(`${requirementKey}::${scenarioKey}`) ??
        byScenario.get(scenarioKey);

      reconciled.push(
        matched
          ? {
              ...matched,
              requirement: requirement.title,
              scenario: scenario.title,
            }
          : inconclusiveFinding(
              requirement.title,
              scenario.title,
              "The model returned no finding for this scenario.",
            ),
      );
    }
  }

  return reconciled;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  const workers = Array.from(
    { length: Math.max(1, Math.min(limit, items.length)) },
    async () => {
      while (true) {
        const current = nextIndex;
        nextIndex += 1;
        if (current >= items.length) return;
        results[current] = await worker(items[current] as T);
      }
    },
  );

  await Promise.all(workers);
  return results;
}

function aggregateTotals(results: SpecValidationResult[]): ReportTotals {
  const totals: ReportTotals = {
    specs: results.length,
    requirements: 0,
    total: 0,
    compliant: 0,
    nonCompliant: 0,
    notImplemented: 0,
    inconclusive: 0,
  };

  for (const result of results) {
    totals.requirements += result.requirements;
    totals.total += result.summary.total;
    totals.compliant += result.summary.compliant;
    totals.nonCompliant += result.summary.nonCompliant;
    totals.notImplemented += result.summary.notImplemented;
    totals.inconclusive += result.summary.inconclusive;
  }

  return totals;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function validateOne(
  discovered: DiscoveredSpec,
  options: ValidateProjectOptions,
): Promise<SpecValidationResult> {
  const startedAt = Date.now();
  options.onSpecStart?.(discovered);

  let spec: Spec | undefined;

  try {
    spec = await parseSpecFile(discovered.name, discovered.filePath);

    const messages = buildMessages(
      {
        spec,
        repo: options.repo,
        config: options.project.config,
        maxContextBytes: options.maxContextBytes,
      },
      options.systemPrompt,
    );

    if (options.verbose) {
      options.logger?.(
        `[${spec.name}] system prompt:\n${messages[0]?.content ?? ""}`,
      );
      options.logger?.(
        `[${spec.name}] user prompt:\n${messages[1]?.content ?? ""}`,
      );
    }

    const raw = await options.provider.chat(messages, {
      model: options.model,
      temperature: options.temperature,
      maxTokens: options.maxTokens,
      signal: options.signal,
    });

    if (options.verbose) {
      options.logger?.(`[${spec.name}] raw response:\n${raw}`);
    }

    const response = parseValidationResponse(extractJson(raw));
    const findings = reconcileFindings(spec, response.findings);
    const summary = summarizeFindings(findings);

    const result: SpecValidationResult = {
      spec: spec.name,
      specPath: spec.path,
      status: specStatusFromSummary(summary),
      findings,
      summary,
      requirements: spec.requirements.length,
      durationMs: Date.now() - startedAt,
      ...(spec.warnings.length > 0 ? { warnings: spec.warnings } : {}),
    };

    options.onSpecDone?.(result);
    return result;
  } catch (error) {
    const message = formatError(error);
    options.logger?.(`[${spec?.name ?? discovered.name}] ${message}`);

    const findings = spec
      ? spec.requirements.flatMap((requirement) =>
          requirement.scenarios.map((scenario) =>
            inconclusiveFinding(
              requirement.title,
              scenario.title,
              `validation failed: ${message}`,
            ),
          ),
        )
      : [];

    const summary = summarizeFindings(findings);

    const result: SpecValidationResult = {
      spec: spec?.name ?? discovered.name,
      specPath: spec?.path ?? discovered.filePath,
      status: "inconclusive",
      findings,
      summary,
      requirements: spec?.requirements.length ?? 0,
      durationMs: Date.now() - startedAt,
      error: message,
      ...(spec && spec.warnings.length > 0 ? { warnings: spec.warnings } : {}),
    };

    options.onSpecDone?.(result);
    return result;
  }
}

/**
 * Validate every discovered spec against the repository source map.
 * Specs are processed concurrently (default: 2) and results keep discovery
 * order.
 */
export async function validateProject(
  options: ValidateProjectOptions,
): Promise<ValidationReport> {
  const concurrency = Math.max(1, options.concurrency ?? 2);

  const results = await mapWithConcurrency(
    options.project.specs,
    concurrency,
    (discovered) => validateOne(discovered, options),
  );

  return {
    generatedAt: new Date().toISOString(),
    root: options.repo.root,
    provider: options.provider.id,
    ...(options.model ? { model: options.model } : {}),
    specs: results,
    totals: aggregateTotals(results),
  };
}
