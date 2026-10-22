export type FileKind = 'source' | 'config' | 'test' | 'docs' | 'other';

export interface ScanOptions {
  /** Repository root to scan. */
  root: string;
  /** Allowlist globs (relative to root). When non-empty, only matches pass. */
  include?: string[];
  /** Extra gitignore-style patterns to exclude. */
  exclude?: string[];
  /** Include test files (default: true). */
  includeTests?: boolean;
  /** Max bytes read from a single file (default: 40_000). */
  maxFileBytes?: number;
  /** Max bytes across all included files (default: 400_000). */
  maxTotalBytes?: number;
  /** Max number of included files (default: 400). */
  maxFiles?: number;
}

export interface RepoFile {
  /** POSIX-style path relative to the repository root. */
  path: string;
  content: string;
  kind: FileKind;
  language: string;
  /** Original file size in bytes. */
  bytes: number;
  truncated: boolean;
}

export interface SkippedFile {
  path: string;
  reason: string;
}

export interface RepoContext {
  root: string;
  files: RepoFile[];
  skipped: SkippedFile[];
  totalBytes: number;
  budgetExhausted: boolean;
}

export const DEFAULT_SCAN_LIMITS = {
  maxFileBytes: 40_000,
  maxTotalBytes: 400_000,
  maxFiles: 400,
} as const;
