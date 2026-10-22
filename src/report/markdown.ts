import type { ValidationReport } from '../validate/run.js';
import {
  CLASSIFICATION_LEGEND,
  FINDING_LABELS,
  isLocalProvider,
  SPEC_LABELS,
  evidenceText,
} from './labels.js';

function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();
}

function specHeading(report: ValidationReport): string[] {
  const locality = isLocalProvider(report.provider) ? 'local' : 'cloud';
  const lines = [
    `**Generated**: ${report.generatedAt}`,
    `**Repository**: \`${report.root}\``,
    `**Provider**: ${report.provider} (${locality})`,
  ];
  if (report.model) {
    lines.push(`**Model**: \`${report.model}\``);
  }
  return lines;
}

/**
 * Render a report shaped like the reference `spec-compliance-report.md`:
 * a summary table followed by one section per capability.
 */
export function renderMarkdown(report: ValidationReport): string {
  const lines: string[] = [];

  lines.push('# Spec Compliance Report', '');
  lines.push(...specHeading(report), '');

  lines.push('## Summary', '');
  lines.push('| Metric | Count |');
  lines.push('| --- | ---: |');
  const rows: Array<[string, number]> = [
    ['Specs', report.totals.specs],
    ['Requirements', report.totals.requirements],
    ['Scenarios', report.totals.total],
    ['Compliant', report.totals.compliant],
    ['Partial', report.totals.partial],
    ['Non-compliant', report.totals.nonCompliant],
    ['Not implemented', report.totals.notImplemented],
    ['Inconclusive', report.totals.inconclusive],
  ];
  for (const [label, count] of rows) {
    lines.push(`| ${label} | ${count} |`);
  }
  lines.push('');

  for (const spec of report.specs) {
    lines.push(`## ${spec.spec}`, '');
    lines.push(`**Spec File**: \`${spec.specPath}\``);
    lines.push(
      `**Status**: ${SPEC_LABELS[spec.status]} (${spec.summary.compliant}/${spec.summary.total} scenarios compliant)`,
    );
    lines.push(`**Duration**: ${spec.durationMs} ms`);

    if (spec.error) {
      lines.push(`**Error**: ${escapeCell(spec.error)}`);
    }
    lines.push('');

    if (spec.warnings && spec.warnings.length > 0) {
      lines.push('**Parse warnings**', '');
      for (const warning of spec.warnings) {
        const line = warning.line ? ` (line ${warning.line})` : '';
        lines.push(`- ${escapeCell(warning.message)}${line}`);
      }
      lines.push('');
    }

    if (spec.findings.length === 0) {
      lines.push('_No scenarios were found in this spec._', '');
      continue;
    }

    lines.push(
      '| Requirement | Scenario | Status | Class | Evidence | Suggested fix |',
    );
    lines.push('| --- | --- | --- | :---: | --- | --- |');

    for (const finding of spec.findings) {
      lines.push(
        `| ${escapeCell(finding.requirement)} | ${escapeCell(finding.scenario)} | ${FINDING_LABELS[finding.status]} | ${finding.classification ?? '—'} | ${escapeCell(evidenceText(finding))} | ${escapeCell(finding.fix || '—')} |`,
      );
    }
    lines.push('');
  }

  lines.push('## Classification legend', '');
  lines.push('| Class | Meaning |');
  lines.push('| --- | --- |');
  for (const [classification, meaning] of CLASSIFICATION_LEGEND) {
    lines.push(`| ${classification} | ${meaning} |`);
  }
  lines.push('');

  return lines.join('\n');
}
