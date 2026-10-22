/** A single GIVEN/WHEN/THEN (or AND/BUT) step inside a scenario. */
export interface ScenarioStep {
  keyword: string;
  text: string;
}

/** A `#### Scenario: ...` block. */
export interface Scenario {
  title: string;
  steps: ScenarioStep[];
  /** Raw markdown body of the scenario, without the heading. */
  raw: string;
}

/** A `### Requirement: ...` block, including its scenarios. */
export interface Requirement {
  title: string;
  /** Requirement statement text before the first scenario. */
  statement: string;
  scenarios: Scenario[];
  /** Raw markdown of the requirement, including its scenarios. */
  raw: string;
}

export interface ParseWarning {
  path: string;
  line?: number;
  message: string;
}

/** A parsed OpenSpec capability spec. */
export interface Spec {
  /** Capability name derived from the file path (e.g. `decision-display`). */
  name: string;
  path: string;
  purpose: string;
  requirements: Requirement[];
  warnings: ParseWarning[];
  raw: string;
}

/** Parsed `openspec/config.yaml`. */
export interface OpenspecConfig {
  schema?: string;
  context?: string;
  rules?: Record<string, string[]>;
  operations?: Record<string, unknown>;
  raw: unknown;
}

/** A spec file found on disk, before parsing. */
export interface DiscoveredSpec {
  name: string;
  filePath: string;
}

/** The discovered OpenSpec project layout. */
export interface OpenspecProject {
  openspecDir: string;
  specsDir: string;
  configPath?: string;
  config?: OpenspecConfig;
  specs: DiscoveredSpec[];
}
