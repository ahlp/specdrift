#!/usr/bin/env node
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', 'results', 'prompt-eval');

const PROBLEM_STATUSES = new Set(['non-compliant', 'not-implemented']);

const byScenario = new Map();

for (const approach of readdirSync(root)) {
  const dir = join(root, approach);
  for (const file of readdirSync(dir)) {
    if (!file.startsWith('run-') || !file.endsWith('.json')) continue;
    const report = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    for (const spec of report.specs ?? []) {
      for (const finding of spec.findings ?? []) {
        if (!PROBLEM_STATUSES.has(finding.status)) continue;
        const key = `${spec.spec} :: ${finding.requirement} :: ${finding.scenario}`;
        let entry = byScenario.get(key);
        if (!entry) {
          entry = {
            spec: spec.spec,
            requirement: finding.requirement,
            scenario: finding.scenario,
            count: 0,
            classifications: new Set(),
            notes: new Set(),
            approaches: new Set(),
          };
          byScenario.set(key, entry);
        }
        entry.count += 1;
        if (finding.classification) entry.classifications.add(finding.classification);
        entry.notes.add(finding.evidence?.note ?? '');
        entry.approaches.add(approach);
      }
    }
  }
}

const rows = [...byScenario.values()].sort((a, b) => b.count - a.count);
for (const row of rows) {
  console.log(`\n### ${row.spec} — ${row.scenario}`);
  console.log(`  requirement: ${row.requirement}`);
  console.log(`  flagged ${row.count}x across approaches: ${[...row.approaches].join(', ')}`);
  console.log(`  classifications: ${[...row.classifications].join(', ') || '—'}`);
  console.log('  notes:');
  for (const note of row.notes) console.log(`    - ${note}`);
}
