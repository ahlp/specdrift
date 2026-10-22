import { describe, expect, it } from "vitest";
import { parseSpec } from "../../src/openspec/parse.js";
import {
  extractJson,
  parseValidationResponse,
  specStatusFromSummary,
  summarizeFindings,
  ValidationParseError,
} from "../../src/validate/result.js";
import { reconcileFindings } from "../../src/validate/run.js";

const SPEC = parseSpec(
  "decision-display",
  "spec.md",
  [
    "## Purpose",
    "",
    "Render the daily decision.",
    "",
    "## Requirements",
    "",
    "### Requirement: Display decision",
    "",
    "The system SHALL render the decision.",
    "",
    "#### Scenario: Render SIM",
    "",
    "- **GIVEN** the API returns SIM",
    "- **WHEN** the page loads",
    "- **THEN** SIM is shown",
    "",
    "#### Scenario: Render NAO",
    "",
    "- **GIVEN** the API returns NAO",
    "- **WHEN** the page loads",
    "- **THEN** NAO is shown",
  ].join("\n"),
);

describe("extractJson", () => {
  it("parses plain JSON", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });

  it("parses fenced JSON", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it("parses JSON embedded in prose", () => {
    expect(extractJson('Here is the result: {"a":1} thanks')).toEqual({
      a: 1,
    });
  });

  it("throws ValidationParseError when no JSON is present", () => {
    expect(() => extractJson("no json here")).toThrow(ValidationParseError);
  });
});

describe("parseValidationResponse", () => {
  it("normalizes aliases, classification and defaults", () => {
    const response = parseValidationResponse({
      spec: "decision-display",
      findings: [
        {
          requirement: "Display decision",
          scenario: "Render SIM",
          status: "PASS",
          classification: "b",
          evidence: { files: ["src/a.ts"] },
        },
        {
          scenario: "Render NAO",
          status: "failed",
          classification: "none",
        },
        {
          scenario: "Unknown",
          status: "missing",
        },
      ],
    });

    expect(response.findings[0]).toMatchObject({
      status: "compliant",
      classification: "B",
      evidence: { files: ["src/a.ts"], note: "" },
      fix: "",
    });
    expect(response.findings[1]).toMatchObject({
      status: "non-compliant",
      classification: null,
      evidence: { files: [], note: "" },
    });
    expect(response.findings[2]?.status).toBe("not-implemented");
  });

  it("accepts a bare array of findings", () => {
    const response = parseValidationResponse([
      { scenario: "Render SIM", status: "compliant" },
    ]);
    expect(response.findings).toHaveLength(1);
  });

  it("falls back to inconclusive for an unknown status", () => {
    const response = parseValidationResponse([
      { scenario: "Render SIM", status: "something-else" },
    ]);
    expect(response.findings[0]?.status).toBe("inconclusive");
  });
});

describe("reconcileFindings", () => {
  it("keeps one finding per scenario and adds missing ones", () => {
    const findings = reconcileFindings(SPEC, [
      {
        requirement: "### Requirement: Display decision",
        scenario: "Render SIM",
        status: "compliant",
        classification: null,
        evidence: { files: ["src/a.ts"], note: "ok" },
        fix: "",
      },
      {
        requirement: "wrong requirement",
        scenario: "Render NAO",
        status: "non-compliant",
        classification: "D",
        evidence: { files: ["src/b.ts"], note: "bug" },
        fix: "fix it",
      },
      {
        requirement: "Display decision",
        scenario: "Not in the spec",
        status: "compliant",
        classification: null,
        evidence: { files: [], note: "" },
        fix: "",
      },
    ]);

    expect(findings).toHaveLength(2);
    expect(findings[0]).toMatchObject({
      requirement: "Display decision",
      scenario: "Render SIM",
      status: "compliant",
    });
    expect(findings[1]).toMatchObject({
      requirement: "Display decision",
      scenario: "Render NAO",
      status: "non-compliant",
    });
  });

  it("marks scenarios without a finding as inconclusive", () => {
    const findings = reconcileFindings(SPEC, []);
    expect(findings).toHaveLength(2);
    expect(findings.every((finding) => finding.status === "inconclusive")).toBe(
      true,
    );
  });
});

describe("summaries", () => {
  it("counts each status and derives the spec status", () => {
    const findings = reconcileFindings(SPEC, [
      {
        requirement: "Display decision",
        scenario: "Render SIM",
        status: "compliant",
        classification: null,
        evidence: { files: [], note: "" },
        fix: "",
      },
      {
        requirement: "Display decision",
        scenario: "Render NAO",
        status: "partial",
        classification: "B",
        evidence: { files: [], note: "" },
        fix: "",
      },
    ]);

    const summary = summarizeFindings(findings);
    expect(summary).toEqual({
      total: 2,
      compliant: 1,
      partial: 1,
      nonCompliant: 0,
      notImplemented: 0,
      inconclusive: 0,
    });
    expect(specStatusFromSummary(summary)).toBe("partial");
  });

  it("prioritizes non-compliance over other statuses", () => {
    expect(
      specStatusFromSummary({
        total: 3,
        compliant: 1,
        partial: 1,
        nonCompliant: 1,
        notImplemented: 0,
        inconclusive: 0,
      }),
    ).toBe("non-compliant");

    expect(
      specStatusFromSummary({
        total: 2,
        compliant: 1,
        partial: 0,
        nonCompliant: 0,
        notImplemented: 0,
        inconclusive: 1,
      }),
    ).toBe("inconclusive");
  });
});
