import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseConfig, parseSpec } from '../../src/openspec/parse.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, '..', 'fixtures', 'openspec');

describe('parseSpec', () => {
  it('parses purpose, requirements and scenarios from a bilingual spec', async () => {
    const filePath = join(
      fixtures,
      'specs',
      'decision-display',
      'spec.md',
    );
    const content = await readFile(filePath, 'utf8');
    const spec = parseSpec('decision-display', filePath, content);

    expect(spec.name).toBe('decision-display');
    expect(spec.purpose).toContain('instant daily decision display');
    expect(spec.warnings).toEqual([]);
    expect(spec.requirements).toHaveLength(2);

    const [decision, navigation] = spec.requirements;
    expect(decision?.title).toBe('Exibir Decisão do Dia Centralizada');
    expect(decision?.statement).toContain('48px+');
    expect(decision?.scenarios).toHaveLength(2);

    const [sim] = decision?.scenarios ?? [];
    expect(sim?.title).toBe('Decisão SIM exibida corretamente com tema alerta');
    expect(sim?.steps.map((step) => step.keyword)).toEqual([
      'GIVEN',
      'WHEN',
      'THEN',
      'THEN',
    ]);
    expect(sim?.steps[0]?.text).toBe('Usuário acessa a página sem parâmetros');
    expect(sim?.steps[3]?.text).toBe('Tema da página tem cor base #ff4d00');

    expect(navigation?.title).toBe('Navegação para Feed RSS');
    expect(navigation?.scenarios).toHaveLength(1);
    expect(navigation?.raw).toContain('Ícone RSS redireciona para /rss');
  });

  it('supports plain GIVEN/WHEN/THEN bullets', () => {
    const spec = parseSpec(
      'plain',
      'plain.md',
      [
        '## Purpose',
        '',
        'Plain steps.',
        '',
        '### Requirement: Plain',
        '',
        'SHALL work.',
        '',
        '#### Scenario: plain scenario',
        '',
        '- GIVEN a thing',
        '- WHEN something happens',
        '- THEN the result is true',
      ].join('\n'),
    );

    const scenario = spec.requirements[0]?.scenarios[0];
    expect(scenario?.steps.map((step) => step.keyword)).toEqual([
      'GIVEN',
      'WHEN',
      'THEN',
    ]);
    expect(spec.warnings).toEqual([]);
  });

  it('warns instead of failing on malformed structure', async () => {
    const filePath = join(fixtures, 'specs', 'incomplete', 'spec.md');
    const content = await readFile(filePath, 'utf8');
    const spec = parseSpec('incomplete', filePath, content);

    expect(spec.purpose).toBe('');
    const messages = spec.warnings.map((warning) => warning.message);
    expect(messages).toContain('spec has no "## Purpose" section');
    expect(messages).toContain(
      'scenario "Sem passos" has no GIVEN/WHEN/THEN steps',
    );
    expect(messages.some((message) => message.includes('unexpected level-3'))).toBe(
      true,
    );
  });
});

describe('parseConfig', () => {
  it('parses schema, context, rules and operations', async () => {
    const filePath = join(fixtures, 'config.yaml');
    const content = await readFile(filePath, 'utf8');
    const config = parseConfig(filePath, content);

    expect(config.schema).toBe('spec-driven');
    expect(config.context).toContain('Tech stack: TypeScript');
    expect(config.rules?.proposal?.[0]).toContain('500 words');
    expect(config.operations).toHaveProperty('apply');
    expect(config.raw).toBeTypeOf('object');
  });

  it('tolerates an empty config file', () => {
    const config = parseConfig('config.yaml', '');
    expect(config.schema).toBeUndefined();
    expect(config.raw).toEqual({});
  });
});
