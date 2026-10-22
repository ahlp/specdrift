import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_MAX_CONTEXT_BYTES } from '../../src/ai/prompt.js';
import { loadConfig, readConfigFile } from '../../src/config/load.js';
import { DEFAULT_SCAN_LIMITS } from '../../src/repo/types.js';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'sdd-config-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('loadConfig', () => {
  it('resolves built-in defaults', async () => {
    const config = await loadConfig({ root, env: {} });

    expect(config).toMatchObject({
      specsDir: './openspec',
      include: [],
      exclude: [],
      format: 'markdown',
      failOn: 'non-compliant',
      concurrency: 2,
      includeTests: true,
      maxFileBytes: DEFAULT_SCAN_LIMITS.maxFileBytes,
      maxTotalBytes: DEFAULT_SCAN_LIMITS.maxTotalBytes,
      maxContextBytes: DEFAULT_MAX_CONTEXT_BYTES,
    });
  });

  it('reads a JSON .sddrc', async () => {
    await writeFile(
      join(root, '.sddrc'),
      JSON.stringify({ format: 'json', concurrency: 3 }),
      'utf8',
    );

    const config = await loadConfig({ root, env: {} });
    expect(config.format).toBe('json');
    expect(config.concurrency).toBe(3);
  });

  it('reads a YAML .sddrc.yaml', async () => {
    await writeFile(
      join(root, '.sddrc.yaml'),
      'format: text\nincludeTests: false\nspecsDir: ./specs\n',
      'utf8',
    );

    const config = await loadConfig({ root, env: {} });
    expect(config.format).toBe('text');
    expect(config.includeTests).toBe(false);
    expect(config.specsDir).toBe('./specs');
  });

  it('applies file < env < overrides precedence', async () => {
    await writeFile(
      join(root, '.sddrc'),
      JSON.stringify({ format: 'json', concurrency: 3 }),
      'utf8',
    );

    const config = await loadConfig({
      root,
      env: { SDD_FORMAT: 'text', SDD_CONCURRENCY: '4' },
      overrides: { format: 'markdown' },
    });

    expect(config.format).toBe('markdown');
    expect(config.concurrency).toBe(4);
  });

  it('parses environment variables', async () => {
    const config = await loadConfig({
      root,
      env: {
        SDD_PROVIDER: 'ollama',
        SDD_INCLUDE_TESTS: 'false',
        SDD_MAX_TOKENS: '1000',
        SDD_TEMPERATURE: '0.2',
        SDD_FAIL_ON: 'warning',
      },
    });

    expect(config.provider).toBe('ollama');
    expect(config.includeTests).toBe(false);
    expect(config.maxTokens).toBe(1000);
    expect(config.temperature).toBe(0.2);
    expect(config.failOn).toBe('warning');
  });

  it('rejects invalid config values', async () => {
    await writeFile(
      join(root, '.sddrc'),
      JSON.stringify({ provider: 'nope' }),
      'utf8',
    );

    await expect(loadConfig({ root, env: {} })).rejects.toThrow(
      /invalid sdd configuration/,
    );
  });

  it('rejects unknown config keys', async () => {
    await writeFile(
      join(root, '.sddrc'),
      JSON.stringify({ unknownKey: true }),
      'utf8',
    );

    await expect(loadConfig({ root, env: {} })).rejects.toThrow(/unknownKey/);
  });

  it('rejects invalid numeric environment values', async () => {
    await expect(
      loadConfig({ root, env: { SDD_CONCURRENCY: 'abc' } }),
    ).rejects.toThrow(/invalid numeric value/);
  });

  it('can skip config file discovery', async () => {
    await writeFile(
      join(root, '.sddrc'),
      JSON.stringify({ format: 'json' }),
      'utf8',
    );

    const config = await loadConfig({ root, env: {}, file: false });
    expect(config.format).toBe('markdown');
  });
});

describe('readConfigFile', () => {
  it('returns an empty object when no config exists', async () => {
    await expect(readConfigFile(root)).resolves.toEqual({});
  });
});
