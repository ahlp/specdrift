import type { ProviderId } from "../ai/provider.js";
import type {
  Classification,
  Finding,
  FindingStatus,
  SpecStatus,
} from "../validate/result.js";

export const FINDING_LABELS: Record<FindingStatus, string> = {
  compliant: "✅ Compliant",
  partial: "🟡 Partial",
  "non-compliant": "❌ Non-compliant",
  "not-implemented": "⚪ Not implemented",
  inconclusive: "❔ Inconclusive",
};

export const FINDING_ICONS: Record<FindingStatus, string> = {
  compliant: "✔",
  partial: "◐",
  "non-compliant": "✖",
  "not-implemented": "○",
  inconclusive: "?",
};

export const FINDING_STATUS_NAMES: Record<FindingStatus, string> = {
  compliant: "compliant",
  partial: "partial",
  "non-compliant": "non-compliant",
  "not-implemented": "not implemented",
  inconclusive: "inconclusive",
};

export const SPEC_LABELS: Record<SpecStatus, string> = {
  compliant: "✅ Compliant",
  partial: "🟡 Partial",
  "non-compliant": "❌ Non-compliant",
  inconclusive: "❔ Inconclusive",
};

export const SPEC_ICONS: Record<SpecStatus, string> = {
  compliant: "✔",
  partial: "◐",
  "non-compliant": "✖",
  inconclusive: "?",
};

export const SPEC_STATUS_NAMES: Record<SpecStatus, string> = {
  compliant: "compliant",
  partial: "partial",
  "non-compliant": "non-compliant",
  inconclusive: "inconclusive",
};

export const CLASSIFICATION_LEGEND: ReadonlyArray<
  readonly [Classification, string]
> = [
  ["A", "Spec drift: code evolved legitimately; update the spec."],
  ["B", "Code drift: spec changed; update the code."],
  ["C", "Green-field: new spec with no implementation."],
  ["D", "Regression/bug: code violates the scenario."],
  ["E", "Orphan/dead code: requirement removed but code remains."],
  ["F", "Contract/schema mismatch: payload, HTTP, unit or type drift."],
  ["G", "Split-brain: spec and code conflict; needs human arbitration."],
];

export function isLocalProvider(id: ProviderId): boolean {
  return id !== "deepseek";
}

export function evidenceText(finding: Finding): string {
  const files = finding.evidence.files;
  const note = finding.evidence.note.trim();

  if (files.length === 0 && !note) return "—";

  const fileList = files.map((file) => `\`${file}\``).join(", ");
  if (files.length === 0) return note;
  if (!note) return fileList;
  return `${fileList} — ${note}`;
}
