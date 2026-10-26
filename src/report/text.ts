import chalk from "chalk";
import type { ValidationReport } from "../validate/run.js";
import type { FindingStatus, SpecStatus } from "../validate/result.js";
import {
  FINDING_ICONS,
  FINDING_STATUS_NAMES,
  isLocalProvider,
  SPEC_ICONS,
  SPEC_STATUS_NAMES,
  evidenceText,
} from "./labels.js";

export interface TextRenderOptions {
  /** Force colors on/off. Defaults to TTY detection and NO_COLOR. */
  color?: boolean;
}

function paintStatus(
  status: FindingStatus | SpecStatus,
  color: boolean,
  text: string,
): string {
  if (!color) return text;

  switch (status) {
    case "compliant":
      return chalk.green(text);
    case "non-compliant":
      return chalk.red(text);
    case "not-implemented":
      return chalk.magenta(text);
    case "inconclusive":
      return chalk.gray(text);
    default:
      return text;
  }
}

/**
 * Render a compact, colorized report for terminal consumption.
 */
export function renderText(
  report: ValidationReport,
  options: TextRenderOptions = {},
): string {
  const color =
    options.color ?? Boolean(process.stdout.isTTY && !process.env.NO_COLOR);

  const bold = (text: string): string => (color ? chalk.bold(text) : text);
  const dim = (text: string): string => (color ? chalk.dim(text) : text);

  const lines: string[] = [];

  lines.push(bold("specdrift openspec validate"));
  lines.push(`Repository: ${report.root}`);
  lines.push(
    `Provider:   ${report.provider} (${isLocalProvider(report.provider) ? "local" : "cloud"})`,
  );
  if (report.model) {
    lines.push(`Model:      ${report.model}`);
  }
  lines.push("");

  for (const spec of report.specs) {
    const specStatus = paintStatus(
      spec.status,
      color,
      `${SPEC_ICONS[spec.status]} ${SPEC_STATUS_NAMES[spec.status]}`,
    );
    lines.push(
      `${bold(spec.spec)}  ${specStatus} (${spec.summary.compliant}/${spec.summary.total} compliant)`,
    );
    lines.push(dim(`  ${spec.specPath}`));

    if (spec.error) {
      lines.push(
        color ? chalk.red(`  error: ${spec.error}`) : `  error: ${spec.error}`,
      );
    }

    for (const finding of spec.findings) {
      const icon = FINDING_ICONS[finding.status];
      const label = FINDING_STATUS_NAMES[finding.status];
      const classification = finding.classification
        ? ` [${finding.classification}]`
        : "";
      lines.push(
        `  ${paintStatus(finding.status, color, `${icon} ${label}`)}${classification}  ${finding.requirement} / ${finding.scenario}`,
      );

      const evidence = evidenceText(finding).replace(/`/g, "");
      if (evidence !== "—") {
        lines.push(dim(`      evidence: ${evidence}`));
      }
    }

    lines.push("");
  }

  lines.push(bold("Totals"));
  lines.push(
    `  ${report.totals.compliant}/${report.totals.total} compliant · ` +
      `${report.totals.nonCompliant} non-compliant · ` +
      `${report.totals.notImplemented} not implemented · ` +
      `${report.totals.inconclusive} inconclusive`,
  );

  return `${lines.join("\n")}\n`;
}
