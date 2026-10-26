import type { ChatMessage } from "./provider.js";
import type { OpenspecConfig, Spec } from "../openspec/types.js";
import type { FileKind, RepoContext, RepoFile } from "../repo/types.js";

export const DEFAULT_MAX_CONTEXT_BYTES = 120_000;

const STOPWORDS = new Set([
  // English
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "from",
  "shall",
  "must",
  "should",
  "system",
  "user",
  "when",
  "then",
  "given",
  "are",
  "was",
  "were",
  "has",
  "have",
  "not",
  "but",
  "all",
  "any",
  "can",
  "will",
  "would",
  "could",
  "into",
  "onto",
  "upon",
  "page",
  "each",
  "per",
  "its",
  "their",
  "which",
  "while",
  "there",
  "these",
  "those",
  "also",
  "only",
  // Portuguese
  "que",
  "para",
  "com",
  "uma",
  "dos",
  "das",
  "por",
  "como",
  "nao",
  "sim",
  "ser",
  "sao",
  "pelo",
  "pela",
  "nos",
  "nas",
  "aos",
  "deve",
  "devera",
  "pagina",
  "usuario",
  "sistema",
  "quando",
  "entao",
  "dado",
  "dada",
  "cada",
  "seu",
  "sua",
  "seus",
  "suas",
  "mais",
  "menos",
  "sobre",
  "entre",
  "apos",
  "sem",
  "essa",
  "esse",
  "isso",
  "esta",
  "este",
  "isto",
  "tem",
  "ter",
  "foi",
  "sendo",
]);

const KIND_BONUS: Record<FileKind, number> = {
  source: 4,
  config: 2,
  test: 1,
  other: 0,
  docs: 0,
};

function tokenize(text: string): string[] {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token));
}

function truncateToBytes(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text, "utf8") <= maxBytes) return text;

  let truncated = text.slice(0, maxBytes);
  while (
    truncated.length > 0 &&
    Buffer.byteLength(truncated, "utf8") > maxBytes
  ) {
    truncated = truncated.slice(0, -1);
  }
  return truncated;
}

/**
 * Rank repository files by keyword overlap with a spec and return the most
 * relevant ones within a byte budget.
 *
 * Files with no keyword overlap are still returned as a fallback (in the scan's
 * priority order), so the model always receives some context.
 */
export function selectRelevantFiles(
  repo: RepoContext,
  spec: Spec,
  maxBytes = DEFAULT_MAX_CONTEXT_BYTES,
): RepoFile[] {
  const specText = [
    spec.purpose,
    ...spec.requirements.flatMap((requirement) => [
      requirement.title,
      requirement.statement,
      ...requirement.scenarios.flatMap((scenario) => [
        scenario.title,
        ...scenario.steps.map((step) => step.text),
      ]),
    ]),
  ].join(" ");

  const specTokens = new Set(tokenize(specText));

  const ranked = repo.files
    .map((file) => {
      let score = KIND_BONUS[file.kind];

      for (const token of tokenize(file.path)) {
        if (specTokens.has(token)) score += 8;
      }

      const frequencies = new Map<string, number>();
      for (const token of tokenize(file.content)) {
        if (!specTokens.has(token)) continue;
        frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
      }
      for (const count of frequencies.values()) {
        score += Math.min(count, 10);
      }

      return { file, score };
    })
    .sort(
      (a, b) => b.score - a.score || a.file.path.localeCompare(b.file.path),
    );

  const selected: RepoFile[] = [];
  let usedBytes = 0;

  for (const { file } of ranked) {
    if (usedBytes >= maxBytes) break;

    const remaining = maxBytes - usedBytes;
    const fileBytes = Buffer.byteLength(file.content, "utf8");

    if (fileBytes <= remaining) {
      selected.push(file);
      usedBytes += fileBytes;
      continue;
    }

    const content = truncateToBytes(file.content, remaining);
    if (content.length === 0) break;

    selected.push({ ...file, content, truncated: true });
    usedBytes += Buffer.byteLength(content, "utf8");
  }

  return selected;
}

function formatRepoFiles(files: RepoFile[]): string {
  if (files.length === 0) {
    return "(no repository files were selected)";
  }

  return files
    .map((file) => {
      const fence = "~~~";
      return [
        `## FILE: ${file.path}`,
        `language: ${file.language}${file.truncated ? " (truncated)" : ""}`,
        `${fence}${file.language}`,
        file.content,
        fence,
      ].join("\n");
    })
    .join("\n\n");
}

function formatRules(config?: OpenspecConfig): string {
  if (!config?.rules || Object.keys(config.rules).length === 0) {
    return "";
  }
  return JSON.stringify(config.rules, null, 2);
}

export const SYSTEM_PROMPT_PERMISSIVE = `You are a pragmatic spec reviewer for spec-driven development. Your goal is to catch real drift between specs and code, not to police implementation details.

Compare each scenario against the repository source map at the level of INTENT and OUTCOME. Treat scenarios as goals ("what should happen"), not as instructions for "how" to build it.

Guidelines:
- Do not require specific file names, function names, class names, libraries, or code structure. Equivalent implementations are equally valid.
- Prefer "compliant" when a reasonable reading of the code satisfies the scenario's intent, even if the implementation differs from what you would choose.
- Flag "non-compliant" only when the code clearly contradicts the scenario's intent. Detail-level differences are not non-compliance.
- Use only the provided repository source map as evidence. Never invent files or behaviour, and do not assume omitted code is wrong unless the intent is clearly unmet.
- Cite file paths in evidence.files only when relevant and known.
- Do not prescribe how the code should be implemented; leave implementation decisions to the developers.
- Do not suggest fixes, improvements, or what you think is "correct". Report only what is explicitly violated.

Statuses:
- "compliant": the code broadly satisfies the scenario's intent.
- "non-compliant": the code explicitly contradicts the scenario's intent.
- "not-implemented": the capability the scenario describes is absent.
- "inconclusive": the evidence is insufficient to judge.

Return exactly ONE finding per scenario, using the exact requirement and scenario titles. Do not add findings for scenarios that are not in the spec.

For "non-compliant" and "not-implemented" findings, assign one drift class; use null otherwise:
A = spec drift: the code evolved legitimately and the spec is stale.
B = code drift: the spec changed and the code is stale.
C = green-field: a new spec with no implementation.
D = regression: a code change contradicts the scenario's intent.
E = orphan/dead code: a requirement was removed but the code remains.
F = contract mismatch: the interface, payload, HTTP contract, or units contradict the spec.
G = split-brain: spec and code changed with conflicting premises.
Use null for compliant findings.

Output: return ONLY a JSON object, with no markdown fences, in this shape:
{
  "spec": "<capability name>",
  "findings": [
    {
      "requirement": "<exact requirement title>",
      "scenario": "<exact scenario title>",
      "status": "compliant" | "non-compliant" | "not-implemented" | "inconclusive",
      "classification": "A" | "B" | "C" | "D" | "E" | "F" | "G" | null,
      "evidence": { "files": ["<relative/path>"], "note": "<short justification>" }
    }
  ]
}`;

export const SYSTEM_PROMPT_DECISION_TREE = `You review whether repository code honours the intent of OpenSpec scenarios.
You only report explicit violations. You never suggest fixes or improvements.

For EACH scenario, in the order listed, follow this procedure internally (do not output the intermediate steps):
1. Restate the scenario's intent in one sentence.
2. Identify which repository files could satisfy that intent.
3. Decide the status with this decision tree:
   - the code clearly contradicts the scenario's intent -> "non-compliant"
   - the capability described is clearly absent -> "not-implemented"
   - there is not enough evidence to decide -> "inconclusive"
   - otherwise -> "compliant" (default)
4. Assign a drift class ONLY for "non-compliant" or "not-implemented", otherwise null:
   A = spec drift, B = code drift, C = green-field, D = regression,
   E = orphan/dead code, F = contract mismatch, G = split-brain.
5. For a violation, write a short factual reason in evidence.note describing WHAT is violated. Do not write a suggestion or a remedy.

Guidelines:
- Read scenarios as goals/outcomes, not implementation instructions. Do not require specific file/function/class names, libraries, or structure.
- Prefer "compliant" when a reasonable reading of the code satisfies the intent.
- Use only the repository source map as evidence; cite paths only when relevant.
- Return exactly ONE finding per scenario, with the exact titles from the spec. Do not add findings for scenarios not listed.

Output ONLY a JSON object, no markdown fences, in this shape:
{
  "spec": "<capability name>",
  "findings": [
    {
      "requirement": "<exact requirement title>",
      "scenario": "<exact scenario title>",
      "status": "compliant" | "non-compliant" | "not-implemented" | "inconclusive",
      "classification": "A" | "B" | "C" | "D" | "E" | "F" | "G" | null,
      "evidence": { "files": ["<relative/path>"], "note": "<short factual reason>" }
    }
  ]
}`;

export const SYSTEM_PROMPT_MINIMAL = `You review whether code satisfies the intent of OpenSpec scenarios. Report only explicit violations.

For each scenario, choose one status:
- "compliant": no clear violation of intent.
- "non-compliant": the code clearly contradicts the scenario's intent.
- "not-implemented": the capability is clearly absent.
- "inconclusive": insufficient evidence.

Return exactly ONE finding per scenario with the exact requirement and scenario titles. For "non-compliant" or "not-implemented", set a drift class A-G; otherwise null. Include evidence files/note. Do not suggest fixes.

Output ONLY a JSON object, no markdown fences, in this shape:
{
  "spec": "<capability name>",
  "findings": [
    {
      "requirement": "<exact requirement title>",
      "scenario": "<exact scenario title>",
      "status": "compliant" | "non-compliant" | "not-implemented" | "inconclusive",
      "classification": "A" | "B" | "C" | "D" | "E" | "F" | "G" | null,
      "evidence": { "files": ["<relative/path>"], "note": "<short justification>" }
    }
  ]
}`;

export const SYSTEM_PROMPT_RTF = `Role:
You are a pragmatic spec reviewer for spec-driven development. You catch real drift between specs and code, not implementation details.

Task:
For each scenario in the spec, compare its intent (what should happen) against the provided repository source map and decide a status:
- "compliant": the code broadly satisfies the scenario's intent.
- "non-compliant": the code explicitly contradicts the scenario's intent.
- "not-implemented": the capability the scenario describes is absent.
- "inconclusive": the evidence is insufficient to judge.

Rules for the task:
- Read scenarios as goals/outcomes, not implementation instructions. Do not require specific file/function/class names, libraries, or structure.
- Prefer "compliant" when a reasonable reading of the code satisfies the intent. Only report explicit violations.
- Do not suggest fixes, improvements, or what you think is "correct".
- Use only the repository source map as evidence; cite paths only when relevant.
- For "non-compliant" and "not-implemented" findings, assign a drift class (A = spec drift, B = code drift, C = green-field, D = regression, E = orphan/dead code, F = contract mismatch, G = split-brain); otherwise null.
- Return exactly one finding per scenario, with the exact requirement and scenario titles.

Format:
Return ONLY a JSON object, no markdown fences, in this shape:
{
  "spec": "<capability name>",
  "findings": [
    {
      "requirement": "<exact requirement title>",
      "scenario": "<exact scenario title>",
      "status": "compliant" | "non-compliant" | "not-implemented" | "inconclusive",
      "classification": "A" | "B" | "C" | "D" | "E" | "F" | "G" | null,
      "evidence": { "files": ["<relative/path>"], "note": "<short justification>" }
    }
  ]
}`;

export const PROMPT_PRESET_NAMES = [
  "permissive",
  "decision-tree",
  "minimal",
  "rtf",
] as const;

export type PromptPresetName = (typeof PROMPT_PRESET_NAMES)[number];

export const PROMPT_PRESETS: Record<PromptPresetName, string> = {
  permissive: SYSTEM_PROMPT_PERMISSIVE,
  "decision-tree": SYSTEM_PROMPT_DECISION_TREE,
  minimal: SYSTEM_PROMPT_MINIMAL,
  rtf: SYSTEM_PROMPT_RTF,
};

export const DEFAULT_PROMPT: PromptPresetName = "rtf";

export function resolveSystemPrompt(name?: string): string {
  const key = (
    name && (PROMPT_PRESET_NAMES as readonly string[]).includes(name)
      ? name
      : DEFAULT_PROMPT
  ) as PromptPresetName;
  return PROMPT_PRESETS[key];
}

export interface PromptOptions {
  spec: Spec;
  repo: RepoContext;
  config?: OpenspecConfig;
  maxContextBytes?: number;
}

export function buildUserPrompt(options: PromptOptions): string {
  const { spec, repo, config } = options;
  const files = selectRelevantFiles(
    repo,
    spec,
    options.maxContextBytes ?? DEFAULT_MAX_CONTEXT_BYTES,
  );

  const expected = spec.requirements.flatMap((requirement) =>
    requirement.scenarios.map(
      (scenario) =>
        `- requirement: ${JSON.stringify(requirement.title)}\n  scenario: ${JSON.stringify(scenario.title)}`,
    ),
  );

  const sections: string[] = [];

  if (config?.context) {
    sections.push(`# Project context\n\n${config.context.trim()}`);
  }

  const rules = formatRules(config);
  if (rules) {
    sections.push(`# Project rules\n\n${rules}`);
  }

  sections.push(`# Capability: ${spec.name}\n\n${spec.raw.trim()}`);

  sections.push(
    [
      "# Expected scenarios (return exactly one finding for each)",
      "",
      expected.length > 0
        ? expected.join("\n")
        : "(this spec contains no scenarios)",
    ].join("\n"),
  );

  sections.push(`# Repository source map\n\n${formatRepoFiles(files)}`);

  const omitted = repo.files.length - files.length;
  sections.push(
    [
      "# Notes",
      "",
      "- The source map is budgeted; some files may be omitted or truncated.",
      "- Treat truncated files as partially visible.",
      "- Reference paths from the source map when available.",
      "- Judge at the level of intent and outcome; do not require a specific implementation.",
      omitted > 0
        ? `- ${omitted} repository file(s) were omitted to fit the context budget.`
        : "",
    ]
      .filter(Boolean)
      .join("\n"),
  );

  return sections.join("\n\n");
}

export function buildMessages(
  options: PromptOptions,
  systemPrompt: string = resolveSystemPrompt(),
): ChatMessage[] {
  return [
    { role: "system", content: systemPrompt },
    { role: "user", content: buildUserPrompt(options) },
  ];
}
