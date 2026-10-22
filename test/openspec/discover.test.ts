import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  discoverOpenspec,
  OpenspecNotFoundError,
} from '../../src/openspec/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, '..', 'fixtures', 'openspec');

describe('discoverOpenspec', () => {
  it('discovers specs and config from the openspec directory', async () => {
    const project = await discoverOpenspec(fixtures);

    expect(project.openspecDir).toBe(fixtures);
    expect(project.specsDir).toBe(join(fixtures, 'specs'));
    expect(project.specs.map((spec) => spec.name)).toEqual([
      'decision-display',
      'incomplete',
    ]);
    expect(project.specs[0]?.filePath).toBe(
      join(fixtures, 'specs', 'decision-display', 'spec.md'),
    );
    expect(project.configPath).toBe(join(fixtures, 'config.yaml'));
    expect(project.config?.schema).toBe('spec-driven');
  });

  it('accepts the specs directory directly', async () => {
    const project = await discoverOpenspec(join(fixtures, 'specs'));

    expect(project.openspecDir).toBe(fixtures);
    expect(project.specsDir).toBe(join(fixtures, 'specs'));
    expect(project.specs).toHaveLength(2);
  });

  it('throws OpenspecNotFoundError when no specs directory exists', async () => {
    await expect(discoverOpenspec(join(fixtures, 'does-not-exist'))).rejects.toThrow(
      OpenspecNotFoundError,
    );
  });
});
