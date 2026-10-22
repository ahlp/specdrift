import { describe, expect, it } from "vitest";
import {
  isReportFormat,
  renderJson,
  renderMarkdown,
  renderReport,
  renderText,
} from "../../src/report/index.js";
import type { ValidationReport } from "../../src/validate/run.js";

function sampleReport(): ValidationReport {
  return {
    generatedAt: "2026-10-22T00:00:00.000Z",
    root: "/repo",
    provider: "lmstudio",
    model: "local-model",
    specs: [
      {
        spec: "decision-display",
        specPath: "/repo/openspec/specs/decision-display/spec.md",
        status: "non-compliant",
        requirements: 1,
        durationMs: 123,
        summary: {
          total: 2,
          compliant: 1,
          partial: 0,
          nonCompliant: 1,
          notImplemented: 0,
          inconclusive: 0,
        },
        findings: [
          {
            requirement: "Display decision",
            scenario: "Render SIM",
            status: "compliant",
            classification: null,
            evidence: { files: ["src/a.ts"], note: "ok" },
            fix: "",
          },
          {
            requirement: "Display decision",
            scenario: "Render NAO",
            status: "non-compliant",
            classification: "D",
            evidence: { files: ["src/b.ts"], note: "wrong theme" },
            fix: "Fix the theme",
          },
        ],
      },
    ],
    totals: {
      specs: 1,
      requirements: 1,
      total: 2,
      compliant: 1,
      partial: 0,
      nonCompliant: 1,
      notImplemented: 0,
      inconclusive: 0,
    },
  };
}

describe("renderMarkdown", () => {
  it("renders a summary, capability section and classification legend", () => {
    const markdown = renderMarkdown(sampleReport());

    expect(markdown).toContain("# Spec Compliance Report");
    expect(markdown).toContain("**Provider**: lmstudio (local)");
    expect(markdown).toContain("| Scenarios | 2 |");
    expect(markdown).toContain("## decision-display");
    expect(markdown).toContain("✅ Compliant");
    expect(markdown).toContain("❌ Non-compliant");
    expect(markdown).toContain("`src/a.ts` — ok");
    expect(markdown).toContain("Fix the theme");
    expect(markdown).toContain("| D | Regression/bug");
  });

  it("escapes pipe characters in table cells", () => {
    const report = sampleReport();
    report.specs[0]!.findings[0]!.requirement = "A | B";
    const markdown = renderMarkdown(report);

    expect(markdown).toContain("A \\| B");
  });

  it("renders an error and parse warnings", () => {
    const report = sampleReport();
    report.specs[0]!.error = "provider exploded";
    report.specs[0]!.warnings = [
      { path: "spec.md", line: 3, message: "scenario has no steps" },
    ];

    const markdown = renderMarkdown(report);
    expect(markdown).toContain("**Error**: provider exploded");
    expect(markdown).toContain("scenario has no steps");
  });
});

describe("renderJson", () => {
  it("emits a stable, machine-readable payload", () => {
    const parsed = JSON.parse(renderJson(sampleReport())) as {
      schemaVersion: number;
      provider: string;
      specs: Array<{ findings: Array<{ classification: string | null }> }>;
    };

    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.provider).toBe("lmstudio");
    expect(parsed.specs[0]?.findings[1]?.classification).toBe("D");
  });
});

describe("renderText", () => {
  it("renders a compact report without ANSI codes when color is off", () => {
    const text = renderText(sampleReport(), { color: false });

    expect(text).toContain("specdrift openspec validate");
    expect(text).toContain("decision-display");
    expect(text).toContain("Render NAO");
    expect(text).toContain("[D]");
    expect(text).toContain("Fix the theme");
    expect(text).toContain("Totals");
    expect(text).toContain("1/2 compliant");
    expect(text).not.toContain("\u001b[");
  });
});

describe("renderReport", () => {
  it("dispatches on the requested format", () => {
    const report = sampleReport();

    expect(renderReport("json", report).trimStart().startsWith("{")).toBe(true);
    expect(renderReport("markdown", report)).toContain("# Spec Compliance");
    expect(renderReport("text", report, { color: false })).toContain("Totals");
  });

  it("validates report format names", () => {
    expect(isReportFormat("markdown")).toBe(true);
    expect(isReportFormat("json")).toBe(true);
    expect(isReportFormat("text")).toBe(true);
    expect(isReportFormat("sarif")).toBe(false);
  });
});
