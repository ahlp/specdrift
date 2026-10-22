import { describe, expect, it } from 'vitest';
import { decideExitCode } from '../../src/cli/commands/validate.js';
import type { ValidationReport } from '../../src/validate/run.js';

function report(
  overrides: Partial<ValidationReport['totals']> = {},
  specError = false,
): ValidationReport {
  return {
    generatedAt: '2026-10-22T00:00:00.000Z',
    root: '/repo',
    provider: 'lmstudio',
    specs: [
      {
        spec: 'demo',
        specPath: '/repo/openspec/specs/demo/spec.md',
        status: specError ? 'inconclusive' : 'compliant',
        findings: [],
        summary: {
          total: 0,
          compliant: 0,
          partial: 0,
          nonCompliant: 0,
          notImplemented: 0,
          inconclusive: 0,
        },
        requirements: 0,
        durationMs: 0,
        ...(specError ? { error: 'provider failed' } : {}),
      },
    ],
    totals: {
      specs: 1,
      requirements: 0,
      total: 0,
      compliant: 0,
      partial: 0,
      nonCompliant: 0,
      notImplemented: 0,
      inconclusive: 0,
      ...overrides,
    },
  };
}

describe('decideExitCode', () => {
  it('returns 0 when everything is compliant', () => {
    expect(decideExitCode(report(), 'non-compliant')).toBe(0);
    expect(decideExitCode(report(), 'warning')).toBe(0);
    expect(decideExitCode(report(), 'error')).toBe(0);
  });

  it('fails on non-compliant or unimplemented scenarios', () => {
    expect(decideExitCode(report({ nonCompliant: 1 }), 'non-compliant')).toBe(1);
    expect(decideExitCode(report({ notImplemented: 1 }), 'non-compliant')).toBe(
      1,
    );
    expect(decideExitCode(report({ nonCompliant: 1 }), 'error')).toBe(0);
  });

  it('fails on partial or inconclusive only for the warning level', () => {
    expect(decideExitCode(report({ partial: 1 }), 'non-compliant')).toBe(0);
    expect(decideExitCode(report({ partial: 1 }), 'warning')).toBe(1);
    expect(decideExitCode(report({ inconclusive: 1 }), 'non-compliant')).toBe(0);
    expect(decideExitCode(report({ inconclusive: 1 }), 'warning')).toBe(1);
  });

  it('maps spec errors to the error and warning levels', () => {
    expect(decideExitCode(report({}, true), 'error')).toBe(1);
    expect(decideExitCode(report({}, true), 'warning')).toBe(1);
    expect(decideExitCode(report({}, true), 'non-compliant')).toBe(0);
  });
});
