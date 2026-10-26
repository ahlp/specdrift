import { z } from "zod";

export const FINDING_STATUSES = [
  "compliant",
  "non-compliant",
  "not-implemented",
  "inconclusive",
] as const;

export type FindingStatus = (typeof FINDING_STATUSES)[number];

export const CLASSIFICATIONS = ["A", "B", "C", "D", "E", "F", "G"] as const;

export type Classification = (typeof CLASSIFICATIONS)[number];

export interface Finding {
  requirement: string;
  scenario: string;
  status: FindingStatus;
  classification: Classification | null;
  evidence: {
    files: string[];
    note: string;
  };
}

export interface ValidationResponse {
  spec?: string;
  findings: Finding[];
}

export type SpecStatus = "compliant" | "non-compliant" | "inconclusive";

export interface FindingSummary {
  total: number;
  compliant: number;
  nonCompliant: number;
  notImplemented: number;
  inconclusive: number;
}

export class ValidationParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationParseError";
  }
}

function normalizeStatus(value: unknown): unknown {
  if (typeof value !== "string") return value;

  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-");
  const aliases: Record<string, string> = {
    pass: "compliant",
    passed: "compliant",
    ok: "compliant",
    satisfied: "compliant",
    fail: "non-compliant",
    failed: "non-compliant",
    violation: "non-compliant",
    missing: "not-implemented",
    unimplemented: "not-implemented",
    absent: "not-implemented",
    unknown: "inconclusive",
    unsure: "inconclusive",
  };

  return aliases[normalized] ?? normalized;
}

function normalizeClassification(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return value;

  const normalized = value.trim().toUpperCase();
  if (normalized === "" || normalized === "NONE" || normalized === "NULL") {
    return null;
  }
  return normalized;
}

const statusSchema = z
  .preprocess(normalizeStatus, z.enum(FINDING_STATUSES))
  .catch("inconclusive");

const classificationSchema = z
  .preprocess(
    normalizeClassification,
    z.union([z.enum(CLASSIFICATIONS), z.null()]),
  )
  .catch(null);

const evidenceSchema = z
  .preprocess(
    (value) => value ?? {},
    z.object({
      files: z.array(z.string()).catch([]),
      note: z.string().catch(""),
    }),
  )
  .catch({ files: [], note: "" });

const findingSchema = z.object({
  requirement: z.string().catch(""),
  scenario: z.string().catch(""),
  status: statusSchema,
  classification: classificationSchema,
  evidence: evidenceSchema,
});

const validationResponseSchema = z.preprocess(
  (value) => (Array.isArray(value) ? { findings: value } : value),
  z.object({
    spec: z.string().optional(),
    findings: z.array(findingSchema).default([]),
  }),
);

/**
 * Extract a JSON value from a model response, tolerating markdown fences and
 * surrounding prose. Throws `ValidationParseError` when no JSON is found.
 */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new ValidationParseError("model returned an empty response");
  }

  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  const candidate = fenced?.[1]?.trim() ?? trimmed;

  const attempts: string[] = [candidate];

  const objectStart = candidate.indexOf("{");
  const objectEnd = candidate.lastIndexOf("}");
  if (objectStart >= 0 && objectEnd > objectStart) {
    attempts.push(candidate.slice(objectStart, objectEnd + 1));
  }

  const arrayStart = candidate.indexOf("[");
  const arrayEnd = candidate.lastIndexOf("]");
  if (arrayStart >= 0 && arrayEnd > arrayStart) {
    attempts.push(candidate.slice(arrayStart, arrayEnd + 1));
  }

  for (const attempt of attempts) {
    try {
      return JSON.parse(attempt) as unknown;
    } catch {
      // try the next candidate
    }
  }

  throw new ValidationParseError("model response does not contain valid JSON");
}

export function parseValidationResponse(raw: unknown): ValidationResponse {
  const parsed = validationResponseSchema.parse(raw);
  return {
    spec: parsed.spec,
    findings: parsed.findings,
  };
}

export function inconclusiveFinding(
  requirement: string,
  scenario: string,
  note: string,
): Finding {
  return {
    requirement,
    scenario,
    status: "inconclusive",
    classification: null,
    evidence: { files: [], note },
  };
}

export function summarizeFindings(findings: Finding[]): FindingSummary {
  const summary: FindingSummary = {
    total: findings.length,
    compliant: 0,
    nonCompliant: 0,
    notImplemented: 0,
    inconclusive: 0,
  };

  for (const finding of findings) {
    switch (finding.status) {
      case "compliant":
        summary.compliant += 1;
        break;
      case "non-compliant":
        summary.nonCompliant += 1;
        break;
      case "not-implemented":
        summary.notImplemented += 1;
        break;
      case "inconclusive":
        summary.inconclusive += 1;
        break;
    }
  }

  return summary;
}

export function specStatusFromSummary(summary: FindingSummary): SpecStatus {
  if (summary.nonCompliant > 0 || summary.notImplemented > 0) {
    return "non-compliant";
  }
  if (summary.inconclusive > 0) {
    return "inconclusive";
  }
  return "compliant";
}
