import { readFile } from "node:fs/promises";
import YAML from "yaml";
import type {
  OpenspecConfig,
  ParseWarning,
  Requirement,
  Scenario,
  ScenarioStep,
  Spec,
} from "./types.js";

interface Block {
  level: number;
  title: string;
  lines: string[];
  startLine: number;
}

const HEADING_RE = /^(#{1,6})\s+(.*?)\s*$/;
const BOLD_STEP_RE = /^\s*[-*]?\s*\*\*(GIVEN|WHEN|THEN|AND|BUT)\*\*\s*(.*)$/i;
const PLAIN_STEP_RE = /^\s*[-*]\s*(GIVEN|WHEN|THEN|AND|BUT)\b\s*:?\s*(.*)$/i;

function splitBlocks(content: string): Block[] {
  const lines = content.split(/\r?\n/);
  const blocks: Block[] = [];
  let current: Block | null = null;

  lines.forEach((line, index) => {
    const match = HEADING_RE.exec(line);
    if (match) {
      const hashes = match[1] ?? "";
      const title = (match[2] ?? "").trim();
      current = {
        level: hashes.length,
        title,
        lines: [],
        startLine: index + 1,
      };
      blocks.push(current);
    } else if (current) {
      current.lines.push(line);
    }
  });

  return blocks;
}

function normaliseHeading(value: string): string {
  return value.trim().toLowerCase().replace(/:$/, "");
}

function parseScenario(title: string, block: Block): Scenario {
  const steps: ScenarioStep[] = [];

  for (const line of block.lines) {
    const match = BOLD_STEP_RE.exec(line) ?? PLAIN_STEP_RE.exec(line);
    if (!match) continue;
    steps.push({
      keyword: (match[1] ?? "").toUpperCase(),
      text: (match[2] ?? "").trim(),
    });
  }

  return {
    title,
    steps,
    raw: block.lines.join("\n").trim(),
  };
}

/**
 * Parse the markdown content of a single OpenSpec capability spec.
 *
 * The parser is language-agnostic: it keys off the structural markers
 * (`## Purpose`, `### Requirement:`, `#### Scenario:`) and the bold
 * `GIVEN`/`WHEN`/`THEN` step labels, so English, Portuguese and mixed
 * specs are all supported.
 */
export function parseSpec(
  name: string,
  filePath: string,
  content: string,
): Spec {
  const warnings: ParseWarning[] = [];
  const blocks = splitBlocks(content);
  const requirements: Requirement[] = [];
  let purpose = "";
  let currentRequirement: Requirement | null = null;

  for (const block of blocks) {
    if (block.level === 2 && normaliseHeading(block.title) === "purpose") {
      purpose = block.lines.join("\n").trim();
      currentRequirement = null;
      continue;
    }

    if (block.level === 3) {
      const match = /^requirement\s*:\s*(.*)$/i.exec(block.title);
      if (!match) {
        warnings.push({
          path: filePath,
          line: block.startLine,
          message: `unexpected level-3 heading: "${block.title}"`,
        });
        currentRequirement = null;
        continue;
      }

      const title = (match[1] ?? "").trim();
      if (!title) {
        warnings.push({
          path: filePath,
          line: block.startLine,
          message: "requirement heading has no title",
        });
      }

      currentRequirement = {
        title,
        statement: block.lines.join("\n").trim(),
        scenarios: [],
        raw: "",
      };
      requirements.push(currentRequirement);
      continue;
    }

    if (block.level === 4) {
      const match = /^scenario\s*:\s*(.*)$/i.exec(block.title);
      if (!match) continue;

      const title = (match[1] ?? "").trim();
      const scenario = parseScenario(title, block);

      if (!currentRequirement) {
        warnings.push({
          path: filePath,
          line: block.startLine,
          message: `scenario "${title}" is not inside a requirement`,
        });
        continue;
      }

      if (scenario.steps.length === 0) {
        warnings.push({
          path: filePath,
          line: block.startLine,
          message: `scenario "${title}" has no GIVEN/WHEN/THEN steps`,
        });
      }

      currentRequirement.scenarios.push(scenario);
    }
  }

  if (!purpose) {
    warnings.push({
      path: filePath,
      message: 'spec has no "## Purpose" section',
    });
  }

  for (const requirement of requirements) {
    if (!requirement.title) {
      warnings.push({
        path: filePath,
        message: "spec contains a requirement without a title",
      });
    }
    if (requirement.scenarios.length === 0) {
      warnings.push({
        path: filePath,
        message: `requirement "${requirement.title}" has no scenarios`,
      });
    }
    requirement.raw = [
      requirement.statement,
      ...requirement.scenarios.map((scenario) =>
        `#### Scenario: ${scenario.title}\n\n${scenario.raw}`.trim(),
      ),
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  return {
    name,
    path: filePath,
    purpose,
    requirements,
    warnings,
    raw: content,
  };
}

/** Read and parse a spec file from disk. */
export async function parseSpecFile(
  name: string,
  filePath: string,
): Promise<Spec> {
  const content = await readFile(filePath, "utf8");
  return parseSpec(name, filePath, content);
}

/** Parse the contents of `openspec/config.yaml`. */
export function parseConfig(filePath: string, content: string): OpenspecConfig {
  const raw = YAML.parse(content) as Record<string, unknown> | null;
  const config: OpenspecConfig = { raw: raw ?? {} };

  if (!raw || typeof raw !== "object") {
    return config;
  }

  if (typeof raw.schema === "string") config.schema = raw.schema;
  if (typeof raw.context === "string") config.context = raw.context;
  if (raw.rules && typeof raw.rules === "object") {
    config.rules = raw.rules as Record<string, string[]>;
  }
  if (raw.operations && typeof raw.operations === "object") {
    config.operations = raw.operations as Record<string, unknown>;
  }

  // Surface the file path for diagnostics without changing the raw payload.
  void filePath;

  return config;
}

/** Read and parse an `openspec/config.yaml` file. */
export async function parseConfigFile(
  filePath: string,
): Promise<OpenspecConfig> {
  const content = await readFile(filePath, "utf8");
  return parseConfig(filePath, content);
}
