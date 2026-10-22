import type { ValidationReport } from '../validate/run.js';

export const REPORT_SCHEMA_VERSION = 1;

/**
 * Render the machine-readable report. The payload is stable and includes the
 * finding status and drift classification for each scenario.
 */
export function renderJson(report: ValidationReport): string {
  return `${JSON.stringify(
    { schemaVersion: REPORT_SCHEMA_VERSION, ...report },
    null,
    2,
  )}\n`;
}
