import { readdir, readFile, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { extname, join } from "node:path";
import type { Ignore } from "ignore";
import { minimatch } from "minimatch";
import { readTextFile } from "./read.js";
import { DEFAULT_SCAN_LIMITS } from "./types.js";
import type {
  FileKind,
  RepoContext,
  RepoFile,
  ScanOptions,
  SkippedFile,
} from "./types.js";

const require = createRequire(import.meta.url);
const createIgnore = require("ignore") as (options?: {
  ignorecase?: boolean;
  ignoreCase?: boolean;
  allowRelativePaths?: boolean;
}) => Ignore;

/** Patterns always excluded from the repository source map. */
export const DEFAULT_IGNORE_PATTERNS = [
  // VCS / tooling
  "node_modules/",
  ".git/",
  ".hg/",
  ".svn/",
  ".idea/",
  ".vscode/",
  // build output / caches
  "dist/",
  "build/",
  "out/",
  "coverage/",
  ".next/",
  ".nuxt/",
  ".turbo/",
  ".cache/",
  "vendor/",
  "target/",
  "obj/",
  // the specs are supplied separately
  "openspec/",
  // lockfiles / logs / secrets
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lockb",
  ".env",
  ".env.*",
  "*.log",
  "*.min.js",
  "*.min.css",
  "*.map",
];

const SOURCE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".vue",
  ".svelte",
  ".py",
  ".rb",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".kts",
  ".swift",
  ".c",
  ".h",
  ".cc",
  ".cpp",
  ".hpp",
  ".cs",
  ".php",
  ".scala",
  ".ex",
  ".exs",
  ".clj",
  ".dart",
  ".lua",
  ".sh",
  ".bash",
  ".zsh",
  ".ps1",
  ".sql",
]);

const CONFIG_EXTENSIONS = new Set([
  ".json",
  ".yaml",
  ".yml",
  ".toml",
  ".ini",
  ".conf",
  ".graphql",
  ".gql",
  ".proto",
]);

const DOC_EXTENSIONS = new Set([".md", ".mdx", ".txt", ".rst", ".adoc"]);

const BINARY_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".bmp",
  ".tiff",
  ".svg",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".otf",
  ".pdf",
  ".zip",
  ".gz",
  ".tar",
  ".tgz",
  ".rar",
  ".7z",
  ".mp3",
  ".mp4",
  ".mov",
  ".avi",
  ".webm",
  ".wav",
  ".flac",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".class",
  ".jar",
  ".wasm",
  ".db",
  ".sqlite",
  ".sqlite3",
  ".bin",
  ".dat",
  ".pkl",
  ".npy",
  ".npz",
  ".xlsx",
  ".docx",
  ".pptx",
]);

const TEST_PATH_RE =
  /(^|\/)(__tests__|tests?|specs?)(\/|$)|\.(test|spec)\.[^/]+$/i;

const KIND_PRIORITY: Record<FileKind, number> = {
  source: 0,
  config: 1,
  test: 2,
  other: 3,
  docs: 4,
};

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "tsx",
  ".js": "javascript",
  ".jsx": "jsx",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".vue": "vue",
  ".svelte": "svelte",
  ".py": "python",
  ".rb": "ruby",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".kt": "kotlin",
  ".kts": "kotlin",
  ".swift": "swift",
  ".c": "c",
  ".h": "c",
  ".cc": "cpp",
  ".cpp": "cpp",
  ".hpp": "cpp",
  ".cs": "csharp",
  ".php": "php",
  ".scala": "scala",
  ".ex": "elixir",
  ".exs": "elixir",
  ".clj": "clojure",
  ".dart": "dart",
  ".lua": "lua",
  ".sh": "shell",
  ".bash": "shell",
  ".zsh": "shell",
  ".ps1": "powershell",
  ".sql": "sql",
  ".json": "json",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".toml": "toml",
  ".md": "markdown",
};

interface Candidate {
  absPath: string;
  relPath: string;
  kind: FileKind;
  size: number;
}

function detectLanguage(relPath: string): string {
  const fileName = relPath.split("/").pop()?.toLowerCase() ?? "";
  if (fileName === "dockerfile") return "dockerfile";
  if (fileName === "makefile") return "makefile";
  if (fileName === "gemfile") return "ruby";
  return LANGUAGE_BY_EXTENSION[extname(fileName).toLowerCase()] ?? "text";
}

function classify(relPath: string, includeTests: boolean): FileKind | null {
  if (TEST_PATH_RE.test(relPath)) {
    return includeTests ? "test" : null;
  }

  const extension = extname(relPath).toLowerCase();
  if (BINARY_EXTENSIONS.has(extension)) return null;
  if (SOURCE_EXTENSIONS.has(extension)) return "source";
  if (CONFIG_EXTENSIONS.has(extension)) return "config";
  if (DOC_EXTENSIONS.has(extension)) return "docs";
  return "other";
}

async function loadIgnore(root: string, extra: string[] = []) {
  const instance = createIgnore().add(DEFAULT_IGNORE_PATTERNS);

  try {
    const gitignore = await readFile(join(root, ".gitignore"), "utf8");
    instance.add(gitignore);
  } catch {
    // No .gitignore is fine.
  }

  if (extra.length > 0) {
    instance.add(extra);
  }

  return instance;
}

/**
 * Scan a repository into a compact, token-bounded source map.
 *
 * The walk honors `.gitignore`, a built-in ignore list (VCS, build output,
 * lockfiles, assets, and `openspec/` itself), `--exclude` patterns and, when
 * provided, an `--include` allowlist. Files are prioritized (source, config,
 * tests, other, docs) before the per-file and total budgets are applied.
 */
export async function scanRepository(
  options: ScanOptions,
): Promise<RepoContext> {
  const root = options.root;
  const stats = await stat(root);
  if (!stats.isDirectory()) {
    throw new Error(`repository root is not a directory: ${root}`);
  }

  const includeTests = options.includeTests ?? true;
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_SCAN_LIMITS.maxFileBytes;
  const maxTotalBytes =
    options.maxTotalBytes ?? DEFAULT_SCAN_LIMITS.maxTotalBytes;
  const maxFiles = options.maxFiles ?? DEFAULT_SCAN_LIMITS.maxFiles;
  const includePatterns = options.include ?? [];
  const skipped: SkippedFile[] = [];
  const MAX_SKIPPED = 500;

  const addSkipped = (path: string, reason: string): void => {
    if (skipped.length < MAX_SKIPPED) {
      skipped.push({ path, reason });
    }
  };

  const ig = await loadIgnore(root, options.exclude);

  const candidates: Candidate[] = [];

  const walk = async (dir: string, relDir: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      const relPath = relDir ? `${relDir}/${entry.name}` : entry.name;
      const absPath = join(dir, entry.name);

      if (entry.isSymbolicLink()) {
        addSkipped(relPath, "symlink");
        continue;
      }

      if (entry.isDirectory()) {
        if (ig.ignores(`${relPath}/`)) {
          addSkipped(relPath, "ignored directory");
          continue;
        }
        await walk(absPath, relPath);
        continue;
      }

      if (!entry.isFile()) continue;

      if (ig.ignores(relPath)) {
        addSkipped(relPath, "ignored");
        continue;
      }

      if (
        includePatterns.length > 0 &&
        !includePatterns.some((pattern) =>
          minimatch(relPath, pattern, { dot: true }),
        )
      ) {
        addSkipped(relPath, "not matched by --include");
        continue;
      }

      const kind = classify(relPath, includeTests);
      if (!kind) {
        addSkipped(relPath, "excluded file type");
        continue;
      }

      let size = 0;
      try {
        size = (await stat(absPath)).size;
      } catch {
        addSkipped(relPath, "unreadable");
        continue;
      }

      if (size === 0) {
        addSkipped(relPath, "empty file");
        continue;
      }

      candidates.push({ absPath, relPath, kind, size });
    }
  };

  await walk(root, "");

  candidates.sort(
    (a, b) =>
      KIND_PRIORITY[a.kind] - KIND_PRIORITY[b.kind] ||
      a.relPath.localeCompare(b.relPath),
  );

  const files: RepoFile[] = [];
  let totalBytes = 0;
  let budgetExhausted = false;

  for (const candidate of candidates) {
    if (files.length >= maxFiles) {
      budgetExhausted = true;
      addSkipped(candidate.relPath, "max files reached");
      continue;
    }

    const remaining = maxTotalBytes - totalBytes;
    if (remaining <= 0) {
      budgetExhausted = true;
      addSkipped(candidate.relPath, "total byte budget reached");
      continue;
    }

    const readLimit = Math.min(maxFileBytes, remaining, candidate.size);
    const { content, bytes, truncated } = await readTextFile(
      candidate.absPath,
      readLimit,
    );

    if (content.includes("\u0000")) {
      addSkipped(candidate.relPath, "binary content");
      continue;
    }

    const used = Buffer.byteLength(content, "utf8");
    totalBytes += used;

    files.push({
      path: candidate.relPath,
      content,
      kind: candidate.kind,
      language: detectLanguage(candidate.relPath),
      bytes,
      truncated: truncated || readLimit < candidate.size,
    });
  }

  return {
    root,
    files,
    skipped,
    totalBytes,
    budgetExhausted: budgetExhausted || totalBytes >= maxTotalBytes,
  };
}
