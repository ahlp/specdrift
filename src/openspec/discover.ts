import { readdir, stat } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { parseConfigFile } from './parse.js';
import type { DiscoveredSpec, OpenspecProject } from './types.js';

export class OpenspecNotFoundError extends Error {
  constructor(input: string) {
    super(
      `could not find an OpenSpec project at "${input}" (expected a "specs/" directory)`,
    );
    this.name = 'OpenspecNotFoundError';
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

async function findMarkdownFiles(dir: string): Promise<string[]> {
  const results: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await findMarkdownFiles(entryPath)));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      results.push(entryPath);
    }
  }

  return results;
}

function specNameFromPath(specsDir: string, filePath: string): string {
  const relativePath = relative(specsDir, filePath).split(sep).join('/');
  const withoutExtension = relativePath.replace(/\.md$/i, '');
  if (withoutExtension.endsWith('/spec')) {
    return withoutExtension.slice(0, -'/spec'.length);
  }
  if (withoutExtension === 'spec') {
    return 'root';
  }
  return withoutExtension;
}

async function resolveDirs(input: string): Promise<{
  openspecDir: string;
  specsDir: string;
}> {
  const absolute = resolve(input);

  if (basename(absolute) === 'specs' && (await isDirectory(absolute))) {
    return { openspecDir: dirname(absolute), specsDir: absolute };
  }

  const specsDir = join(absolute, 'specs');
  if (!(await isDirectory(specsDir))) {
    throw new OpenspecNotFoundError(input);
  }

  return { openspecDir: absolute, specsDir };
}

/**
 * Discover an OpenSpec project: its capability specs and optional config.
 *
 * `input` may be either the OpenSpec directory (containing `specs/`) or the
 * `specs/` directory itself.
 */
export async function discoverOpenspec(
  input: string,
): Promise<OpenspecProject> {
  const { openspecDir, specsDir } = await resolveDirs(input);

  const files = await findMarkdownFiles(specsDir);
  const specs: DiscoveredSpec[] = files
    .map((filePath) => ({
      name: specNameFromPath(specsDir, filePath),
      filePath,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const project: OpenspecProject = {
    openspecDir,
    specsDir,
    specs,
  };

  const configCandidates = [
    join(openspecDir, 'config.yaml'),
    join(openspecDir, 'config.yml'),
  ];

  for (const candidate of configCandidates) {
    if (await isFile(candidate)) {
      project.configPath = candidate;
      project.config = await parseConfigFile(candidate);
      break;
    }
  }

  return project;
}
