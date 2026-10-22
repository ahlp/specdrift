import type { ChatMessage } from './provider.js';
import type { OpenspecConfig, Spec } from '../openspec/types.js';
import type { FileKind, RepoContext, RepoFile } from '../repo/types.js';

export const DEFAULT_MAX_CONTEXT_BYTES = 120_000;

const STOPWORDS = new Set([
  // English
  'the',
  'and',
  'for',
  'with',
  'that',
  'this',
  'from',
  'shall',
  'must',
  'should',
  'system',
  'user',
  'when',
  'then',
  'given',
  'are',
  'was',
  'were',
  'has',
  'have',
  'not',
  'but',
  'all',
  'any',
  'can',
  'will',
  'would',
  'could',
  'into',
  'onto',
  'upon',
  'page',
  'each',
  'per',
  'its',
  'their',
  'which',
  'while',
  'there',
  'these',
  'those',
  'also',
  'only',
  // Portuguese
  'que',
  'para',
  'com',
  'uma',
  'dos',
  'das',
  'por',
  'como',
  'nao',
  'sim',
  'ser',
  'sao',
  'pelo',
  'pela',
  'nos',
  'nas',
  'aos',
  'deve',
  'devera',
  'pagina',
  'usuario',
  'sistema',
  'quando',
  'entao',
  'dado',
  'dada',
  'cada',
  'seu',
  'sua',
  'seus',
  'suas',
  'mais',
  'menos',
  'sobre',
  'entre',
  'apos',
  'sem',
  'essa',
  'esse',
  'isso',
  'esta',
  'este',
  'isto',
  'tem',
  'ter',
  'foi',
  'sendo',
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
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token));
}

function truncateToBytes(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text;

  let truncated = text.slice(0, maxBytes);
  while (
    truncated.length > 0 &&
    Buffer.byteLength(truncated, 'utf8') > maxBytes
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
  ].join(' ');

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
      (a, b) =>
        b.score - a.score || a.file.path.localeCompare(b.file.path),
    );

  const selected: RepoFile[] = [];
  let usedBytes = 0;

  for (const { file } of ranked) {
    if (usedBytes >= maxBytes) break;

    const remaining = maxBytes - usedBytes;
    const fileBytes = Buffer.byteLength(file.content, 'utf8');

    if (fileBytes <= remaining) {
      selected.push(file);
      usedBytes += fileBytes;
      continue;
    }

    const content = truncateToBytes(file.content, remaining);
    if (content.length === 0) break;

    selected.push({ ...file, content, truncated: true });
    usedBytes += Buffer.byteLength(content, 'utf8');
  }

  return selected;
}

function formatRepoFiles(files: RepoFile[]): string {
  if (files.length === 0) {
    return '(no repository files were selected)';
  }

  return files
    .map((file) => {
      const fence = '~~~';
      return [
        `## FILE: ${file.path}`,
        `language: ${file.language}${file.truncated ? ' (truncated)' : ''}`,
        `${fence}${file.language}`,
        file.content,
        fence,
      ].join('\n');
    })
    .join('\n\n');
}

function formatRules(config?: OpenspecConfig): string {
  if (!config?.rules || Object.keys(config.rules).length === 0) {
    return '';
  }
  return JSON.stringify(config.rules, null, 2);
}

export const SYSTEM_PROMPT = `You are a strict spec-compliance reviewer for OpenSpec (spec-driven development).

Your job: compare an OpenSpec capability spec with the repository source code and decide, for EACH scenario, whether the implementation satisfies it.

Rules:
- Use only the provided repository source map as evidence. Never invent files or behaviour.
- Cite exact relative file paths in evidence.files.
- If the code does not implement a scenario, use "not-implemented".
- If evidence is insufficient, use "inconclusive".
- If the code only partially satisfies a scenario, use "partial".
- If the code contradicts the scenario, use "non-compliant".
- If the code satisfies every THEN, use "compliant".
- Return exactly ONE finding per scenario, using the exact requirement and scenario titles from the spec.
- Do not add findings for scenarios that are not in the spec.
- Do not edit files. Suggest fixes only.

For every finding that is not "compliant", assign one drift class:
A = spec drift: the code evolved legitimately and the spec is stale; update the spec.
B = code drift: the spec changed and the code is stale; update the code.
C = green-field: a new spec with no implementation; plan the modules.
D = regression/bug: a code change violates the GIVEN/WHEN/THEN scenario.
E = orphan/dead code: a requirement was removed but the code remains.
F = contract/schema mismatch: payload, HTTP status, unit or type mismatch.
G = split-brain: spec and code changed with conflicting premises; needs human arbitration.
Use null for compliant findings.

Output: return ONLY a JSON object, with no markdown fences, in this shape:
{
  "spec": "<capability name>",
  "findings": [
    {
      "requirement": "<exact requirement title>",
      "scenario": "<exact scenario title>",
      "status": "compliant" | "partial" | "non-compliant" | "not-implemented" | "inconclusive",
      "classification": "A" | "B" | "C" | "D" | "E" | "F" | "G" | null,
      "evidence": { "files": ["<relative/path>"], "note": "<short justification>" },
      "fix": "<actionable suggested change, or empty string>"
    }
  ]
}`;

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
      '# Expected scenarios (return exactly one finding for each)',
      '',
      expected.length > 0
        ? expected.join('\n')
        : '(this spec contains no scenarios)',
    ].join('\n'),
  );

  sections.push(
    `# Repository source map\n\n${formatRepoFiles(files)}`,
  );

  const omitted = repo.files.length - files.length;
  sections.push(
    [
      '# Notes',
      '',
      '- The source map is budgeted; some files may be omitted or truncated.',
      '- Treat truncated files as partially visible.',
      '- Evidence must reference paths from the source map.',
      omitted > 0
        ? `- ${omitted} repository file(s) were omitted to fit the context budget.`
        : '',
    ]
      .filter(Boolean)
      .join('\n'),
  );

  return sections.join('\n\n');
}

export function buildMessages(options: PromptOptions): ChatMessage[] {
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: buildUserPrompt(options) },
  ];
}
