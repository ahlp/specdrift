import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ChatMessage, Provider } from '../../src/ai/provider.js';
import type { OpenspecProject } from '../../src/openspec/types.js';
import type { RepoContext } from '../../src/repo/types.js';
import { validateProject } from '../../src/validate/run.js';

const SPEC_CONTENT = [
  '## Purpose',
  '',
  'Render the daily decision.',
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
  '',
  '#### Scenario: Render NAO',
  '',
  '- **GIVEN** the API returns NAO',
  '- **WHEN** the page loads',
  '- **THEN** NAO is shown',
].join('\n');

const RESPONSE_WITH_ONE_FINDING = JSON.stringify({
  spec: 'decision-display',
  findings: [
    {
      requirement: 'Display decision',
      scenario: 'Render SIM',
      status: 'compliant',
      classification: null,
      evidence: { files: ['src/DecisionDisplay.tsx'], note: 'renders SIM' },
      fix: '',
    },
  ],
});

class FakeProvider implements Provider {
  readonly id = 'lmstudio' as const;
  readonly isLocal = true;
  readonly calls: ChatMessage[][] = [];

  constructor(
    private readonly handler: (
      messages: ChatMessage[],
    ) => string | Promise<string>,
  ) {}

  async chat(messages: ChatMessage[]): Promise<string> {
    this.calls.push(messages);
    return this.handler(messages);
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }
}

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sdd-validate-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function writeSpec(name: string): Promise<string> {
  const path = join(dir, `${name}.md`);
  await writeFile(path, SPEC_CONTENT, 'utf8');
  return path;
}

async function makeProject(names: string[]): Promise<OpenspecProject> {
  const specs = [];
  for (const name of names) {
    specs.push({ name, filePath: await writeSpec(name) });
  }
  return {
    openspecDir: dir,
    specsDir: dir,
    specs,
  };
}

const REPO: RepoContext = {
  root: '/repo',
  files: [
    {
      path: 'src/DecisionDisplay.tsx',
      content: 'export function DecisionDisplay() { return "SIM"; }',
      kind: 'source',
      language: 'tsx',
      bytes: 49,
      truncated: false,
    },
  ],
  skipped: [],
  totalBytes: 49,
  budgetExhausted: false,
};

describe('validateProject', () => {
  it('reconciles findings and aggregates totals', async () => {
    const project = await makeProject(['decision-display']);
    const provider = new FakeProvider(() => RESPONSE_WITH_ONE_FINDING);

    const report = await validateProject({ project, repo: REPO, provider });

    expect(report.provider).toBe('lmstudio');
    expect(report.specs).toHaveLength(1);

    const result = report.specs[0];
    expect(result?.findings).toHaveLength(2);
    expect(result?.findings[0]).toMatchObject({
      requirement: 'Display decision',
      scenario: 'Render SIM',
      status: 'compliant',
    });
    expect(result?.findings[1]).toMatchObject({
      requirement: 'Display decision',
      scenario: 'Render NAO',
      status: 'inconclusive',
    });
    expect(result?.status).toBe('inconclusive');
    expect(result?.requirements).toBe(1);
    expect(result?.error).toBeUndefined();

    expect(report.totals).toEqual({
      specs: 1,
      requirements: 1,
      total: 2,
      compliant: 1,
      partial: 0,
      nonCompliant: 0,
      notImplemented: 0,
      inconclusive: 1,
    });
  });

  it('marks the spec non-compliant when a scenario fails', async () => {
    const project = await makeProject(['decision-display']);
    const provider = new FakeProvider(() =>
      JSON.stringify({
        findings: [
          { scenario: 'Render SIM', status: 'failed' },
          { scenario: 'Render NAO', status: 'pass' },
        ],
      }),
    );

    const report = await validateProject({ project, repo: REPO, provider });
    expect(report.specs[0]?.status).toBe('non-compliant');
    expect(report.totals.nonCompliant).toBe(1);
    expect(report.totals.compliant).toBe(1);
  });

  it('turns provider failures into inconclusive findings', async () => {
    const project = await makeProject(['decision-display']);
    const provider = new FakeProvider(() => {
      throw new Error('connection refused');
    });

    const report = await validateProject({ project, repo: REPO, provider });
    const result = report.specs[0];

    expect(result?.error).toContain('connection refused');
    expect(result?.status).toBe('inconclusive');
    expect(result?.findings.every((entry) => entry.status === 'inconclusive')).toBe(
      true,
    );
  });

  it('turns malformed model output into an inconclusive result', async () => {
    const project = await makeProject(['decision-display']);
    const provider = new FakeProvider(() => 'this is not JSON');

    const report = await validateProject({ project, repo: REPO, provider });
    expect(report.specs[0]?.error).toMatch(/valid JSON/);
    expect(report.specs[0]?.status).toBe('inconclusive');
  });

  it('processes multiple specs and preserves discovery order', async () => {
    const project = await makeProject(['alpha', 'beta']);
    const provider = new FakeProvider(() => RESPONSE_WITH_ONE_FINDING);

    const report = await validateProject({
      project,
      repo: REPO,
      provider,
      concurrency: 2,
    });

    expect(report.specs.map((spec) => spec.spec)).toEqual(['alpha', 'beta']);
    expect(provider.calls).toHaveLength(2);
    expect(report.totals.specs).toBe(2);
    expect(report.totals.requirements).toBe(2);
  });

  it('reports lifecycle callbacks', async () => {
    const project = await makeProject(['decision-display']);
    const provider = new FakeProvider(() => RESPONSE_WITH_ONE_FINDING);
    const started: string[] = [];
    const done: string[] = [];

    await validateProject({
      project,
      repo: REPO,
      provider,
      onSpecStart: (spec) => started.push(spec.name),
      onSpecDone: (result) => done.push(result.spec),
    });

    expect(started).toEqual(['decision-display']);
    expect(done).toEqual(['decision-display']);
  });
});
