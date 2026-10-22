export {
  CLASSIFICATIONS,
  extractJson,
  FINDING_STATUSES,
  inconclusiveFinding,
  parseValidationResponse,
  specStatusFromSummary,
  summarizeFindings,
  ValidationParseError,
} from './result.js';
export type {
  Classification,
  Finding,
  FindingStatus,
  FindingSummary,
  SpecStatus,
  ValidationResponse,
} from './result.js';
export { reconcileFindings, validateProject } from './run.js';
export type {
  ReportTotals,
  SpecValidationResult,
  ValidateProjectOptions,
  ValidationReport,
} from './run.js';
