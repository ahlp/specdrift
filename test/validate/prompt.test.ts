import { describe, expect, it } from 'vitest';
import {
  buildMessages,
  buildUserPrompt,
  selectRelevantFiles,
} from '../../src/ai/prompt.js';
import { parseSpec } from '../../src/openspec/parse.js';
import type { RepoContext, RepoFile } from '../../src/repo/types.js';

const SPEC = parseSpec(
  'decision-display',
  'spec.md',
  [
    '## Purpose',
    '',
    'Render the daily decision with DecisionDisplay.',
    '',
    '## Requirements',
    '',
    '### Requirement: Display decision',
    '',
    'The system SHALL render the decision.',
    '',
    '#### Scenario: Render SIM',
    '',
    '- **GIVEN** the API returns SIM',
    '- **WHEN** the page loads',
    '- **THEN** SIM is shown',
  ].join('\n'),
);

function file(path: string, content: string): RepoFile {
  return {
    path,
    content,
    kind: 'source',
    language: 'typescript',
    bytes: Buffer.byteLength(content, 'utf8'),
    truncated: false,
  };
}

function repo(files: RepoFile[]): RepoContext {
  return {
    root: '/repo',
    files,
    skipped: [],
    totalBytes: files.reduce(
      (total, entry) => total + Buffer.byteLength(entry.content, 'utf8'),
      0,
    ),
    budgetExhausted: false,
  };
}

describe('selectRelevantFiles', () => {
  it('ranks files that match the spec ahead of unrelated files', () => {
    const context = repo([
      file('src/other.ts', 'export const unrelated = "nothing to see here";'),
      file(
        'src/DecisionDisplay.tsx',
        'export function DecisionDisplay() { return "SIM"; }',
      ),
    ]);

    const selected = selectRelevantFiles(context, SPEC, 1000);

    expect(selected[0]?.path).toBe('src/DecisionDisplay.tsx');
  });

  it('respects the byte budget and truncates the final file', () => {
    const context = repo([
      file('src/DecisionDisplay.tsx', 'DecisionDisplay '.repeat(50)),
    ]);

    const selected = selectRelevantFiles(context, SPEC, 100);

    expect(selected).toHaveLength(1);
    expect(selected[0]?.truncated).toBe(true);
    expect(
      Buffer.byteLength(selected[0]?.content ?? '', 'utf8'),
    ).toBeLessThanOrEqual(100);
  });
});

describe('buildUserPrompt', () => {
  it('includes the spec, expected scenarios and relevant files', () => {
    const context = repo([
      file(
        'src/DecisionDisplay.tsx',
        'export function DecisionDisplay() { return "SIM"; }',
      ),
    ]);

    const prompt = buildUserPrompt({ spec: SPEC, repo: context });

    expect(prompt).toContain('# Capability: decision-display');
    expect(prompt).toContain('Render the daily decision');
    expect(prompt).toContain('# Expected scenarios');
    expect(prompt).toContain('"Render SIM"');
    expect(prompt).toContain('## FILE: src/DecisionDisplay.tsx');
    expect(prompt).toContain('DecisionDisplay');
  });

  it('includes config context and rules when present', () => {
    const context = repo([]);
    const prompt = buildUserPrompt({
      spec: SPEC,
      repo: context,
      config: {
        raw: {},
        context: 'Tech stack: TypeScript',
        rules: { proposal: ['Keep it short'] },
      },
    });

    expect(prompt).toContain('# Project context');
    expect(prompt).toContain('Tech stack: TypeScript');
    expect(prompt).toContain('# Project rules');
    expect(prompt).toContain('Keep it short');
  });
});

describe('buildMessages', () => {
  it('returns a system prompt with the taxonomy and a user prompt', () => {
    const messages = buildMessages({ spec: SPEC, repo: repo([]) });

    expect(messages).toHaveLength(2);
    expect(messages[0]?.role).toBe('system');
    expect(messages[0]?.content).toContain('A = spec drift');
    expect(messages[0]?.content).toContain('return ONLY a JSON object');
    expect(messages[1]?.role).toBe('user');
  });
});
