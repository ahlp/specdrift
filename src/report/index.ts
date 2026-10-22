import type { ValidationReport } from '../validate/run.js';
import { renderJson } from './json.js';
import { renderMarkdown } from './markdown.js';
import { renderText } from './text.js';
import type { TextRenderOptions } from './text.js';

export const REPORT_FORMATS = ['markdown', 'json', 'text'] as const;

export type ReportFormat = (typeof REPORT_FORMATS)[number];

export function isReportFormat(value: string): value is ReportFormat {
  return (REPORT_FORMATS as readonly string[]).includes(value);
}

export interface RenderReportOptions extends TextRenderOptions {}

export function renderReport(
  format: ReportFormat,
  report: ValidationReport,
  options: RenderReportOptions = {},
): string {
  switch (format) {
    case 'json':
      return renderJson(report);
    case 'text':
      return renderText(report, options);
    case 'markdown':
      return renderMarkdown(report);
    default:
      return renderMarkdown(report);
  }
}

export { renderJson } from './json.js';
export { renderMarkdown } from './markdown.js';
export { renderText } from './text.js';
export type { TextRenderOptions } from './text.js';
