# sdd

> Semantic validation of [OpenSpec](https://github.com/Fission-AI/OpenSpec)
> specs against real repository code, using a local or cloud AI provider.

`sdd` complements the structural `openspec validate` command: instead of
checking that spec files are well-formed, it asks an AI model to compare each
requirement and scenario with the repository source and report drift.

```
sdd openspec              # command group (prints help)
sdd openspec validate     # semantic validation
```

## Requirements

- Node.js >= 18
- An AI provider:
  - [LM Studio](https://lmstudio.ai/) running locally (recommended), or
  - [Ollama](https://ollama.com/) running locally, or
  - a DeepSeek API key

## Install

```bash
npm install -g @ahlp/sdd
# or run without installing
npx @ahlp/sdd openspec validate
```

The package is published under the `@ahlp` scope because the bare npm name
`sdd` is already taken. The installed command is still **`sdd`**.

## Quick start

From a repository that contains an `openspec/` directory:

```bash
# Auto-detect a local provider (LM Studio, then Ollama)
sdd openspec validate

# Force a provider and model
sdd openspec validate --provider ollama --model llama3.1

# Machine-readable report + fail CI on drift
sdd openspec validate --format json --fail-on non-compliant
```

The default report is written to stdout in Markdown. Use `--output report.md`
to write it to a file (colors are only used for TTY stdout).

## Expected project layout

```
repo/
├── openspec/
│   ├── config.yaml                 # optional: schema, context, rules
│   └── specs/
│       └── decision-display/
│           └── spec.md
├── src/
└── ...
```

Each `spec.md` uses the OpenSpec structure:

```markdown
## Purpose

One paragraph describing the capability.

## Requirements

### Requirement: Display the decision

The system SHALL ...

#### Scenario: Render SIM

- **GIVEN** ...
- **WHEN** ...
- **THEN** ...
```

Specs may be written in English, Portuguese, or mixed; the parser keys off the
structural markers and `GIVEN`/`WHEN`/`THEN` labels.

## Commands and flags

### `sdd openspec validate`

| Flag                  | Description                                            | Default          |
| --------------------- | ------------------------------------------------------ | ---------------- |
| `--specs-dir <path>`  | Directory containing `openspec/` (or the `specs/` dir) | `./openspec`     |
| `--root <path>`       | Repository root to scan                                | `process.cwd()`  |
| `--provider <name>`   | `lmstudio` \| `ollama` \| `deepseek`                   | auto-detect      |
| `--model <id>`        | Model id/name                                          | provider default |
| `--base-url <url>`    | Provider endpoint override                             | provider default |
| `--api-key <key>`     | DeepSeek API key (prefer `DEEPSEEK_API_KEY`)           | env              |
| `--format <fmt>`      | `markdown` \| `json` \| `text`                         | `markdown`       |
| `--output <file>`     | Write the report to a file; `-` is stdout              | `-`              |
| `--fail-on <level>`   | `error` \| `warning` \| `non-compliant`                | `non-compliant`  |
| `--include <glob...>` | Only scan matching files                               | all              |
| `--exclude <glob...>` | Extra ignore globs                                     | none             |
| `--max-tokens <n>`    | Cap per-request output tokens                          | provider default |
| `--concurrency <n>`   | Parallel spec requests                                 | `2`              |
| `--verbose`           | Print prompts, raw responses and debug details         | off              |

The repository scan honors `.gitignore` and always skips VCS directories, build
output, lockfiles, binaries, and `openspec/` itself.

## Providers

### LM Studio (local)

1. Load a model in LM Studio.
2. Start the local server (default `http://localhost:1234`).
3. Run `sdd openspec validate --provider lmstudio`.

Override the endpoint with `--base-url` or `SDD_LMSTUDIO_BASE_URL`. No API key
is required.

### Ollama (local)

```bash
ollama serve
ollama pull llama3.1
sdd openspec validate --provider ollama --model llama3.1
```

The native `/api/chat` endpoint is used by default. A base URL ending in `/v1`
switches to Ollama's OpenAI-compatible endpoint. Environment overrides:
`SDD_OLLAMA_BASE_URL`, `SDD_OLLAMA_MODEL`.

### DeepSeek (cloud)

```bash
export DEEPSEEK_API_KEY=sk-...
sdd openspec validate --provider deepseek --model deepseek-chat
```

Defaults to `https://api.deepseek.com/v1` and `deepseek-chat`.
Environment overrides: `SDD_DEEPSEEK_API_KEY`, `SDD_DEEPSEEK_BASE_URL`,
`SDD_DEEPSEEK_MODEL`.

> **Privacy:** LM Studio and Ollama keep repository content on your machine.
> DeepSeek uploads the selected source files to a third party. `sdd` prints a
> warning when a cloud provider is selected.

### Provider auto-detection

When `--provider` and `SDD_PROVIDER` are absent, `sdd` probes:

1. LM Studio (`http://localhost:1234`)
2. Ollama (`http://localhost:11434`)
3. DeepSeek (only if an API key is available)

If none is reachable it exits with a clear message and code `4`.

## Configuration

Precedence, highest first:

1. CLI flags
2. `SDD_*` environment variables
3. `.sddrc` / `.sddrc.json` / `.sddrc.yaml` / `.sddrc.yml` in the repository root
4. Built-in defaults

`.sddrc` may be JSON or YAML:

```yaml
provider: ollama
model: llama3.1
specsDir: ./openspec
format: markdown
failOn: non-compliant
concurrency: 2
includeTests: true
maxContextBytes: 120000
exclude:
  - "**/*.generated.ts"
```

Unknown keys are rejected so typos are caught early.

### Environment variables

| Variable                                    | Purpose                              |
| ------------------------------------------- | ------------------------------------ |
| `SDD_PROVIDER`                              | `lmstudio` \| `ollama` \| `deepseek` |
| `SDD_MODEL`                                 | Model override                       |
| `SDD_BASE_URL`                              | Generic endpoint override            |
| `SDD_SPECS_DIR`                             | OpenSpec directory                   |
| `SDD_FORMAT`                                | Report format                        |
| `SDD_FAIL_ON`                               | Failure threshold                    |
| `SDD_CONCURRENCY`                           | Parallel spec requests               |
| `SDD_MAX_TOKENS`                            | Output token cap                     |
| `SDD_TEMPERATURE`                           | Sampling temperature                 |
| `SDD_MAX_FILE_BYTES`                        | Per-file scan budget                 |
| `SDD_MAX_TOTAL_BYTES`                       | Total scan budget                    |
| `SDD_MAX_CONTEXT_BYTES`                     | Prompt context budget                |
| `SDD_INCLUDE_TESTS`                         | Include test files in the scan       |
| `SDD_TIMEOUT_MS`                            | Provider request timeout             |
| `SDD_LMSTUDIO_BASE_URL`                     | LM Studio endpoint                   |
| `SDD_OLLAMA_BASE_URL`                       | Ollama endpoint                      |
| `SDD_OLLAMA_MODEL`                          | Ollama model                         |
| `SDD_DEEPSEEK_BASE_URL`                     | DeepSeek endpoint                    |
| `SDD_DEEPSEEK_MODEL`                        | DeepSeek model                       |
| `SDD_DEEPSEEK_API_KEY` / `DEEPSEEK_API_KEY` | DeepSeek key                         |

Project-wide guidance in `openspec/config.yaml` (`context`, `rules`,
`operations`) is included in the prompt.

## Reports

Three formats are available:

- **markdown** (default) — a summary table followed by one section per
  capability, with evidence and suggested fixes.
- **json** — stable machine-readable output with `schemaVersion: 1`, finding
  statuses and drift classifications.
- **text** — compact colorized terminal output.

Each finding reports:

| Field            | Meaning                                                                    |
| ---------------- | -------------------------------------------------------------------------- |
| `status`         | `compliant`, `partial`, `non-compliant`, `not-implemented`, `inconclusive` |
| `classification` | Drift class `A`–`G`, or `null` when compliant                              |
| `evidence.files` | Repository paths used as evidence                                          |
| `evidence.note`  | Short justification                                                        |
| `fix`            | Suggested action (report-only; `sdd` never edits files)                    |

### Drift taxonomy

| Class | Meaning                                                       |
| ----- | ------------------------------------------------------------- |
| A     | Spec drift — code evolved; update the spec                    |
| B     | Code drift — spec changed; update the code                    |
| C     | Green-field — new spec, no implementation                     |
| D     | Regression/bug — code violates the scenario                   |
| E     | Orphan/dead code — requirement removed, code remains          |
| F     | Contract/schema mismatch — payload, HTTP, unit or type drift  |
| G     | Split-brain — spec and code conflict; needs human arbitration |

## Exit codes

| Code | Meaning                                                |
| ---- | ------------------------------------------------------ |
| `0`  | Validation passed                                      |
| `1`  | Findings reached the `--fail-on` threshold             |
| `2`  | Usage or configuration error                           |
| `3`  | No OpenSpec project/specs found                        |
| `4`  | Provider unreachable, or every spec failed to validate |

`--fail-on` levels:

- `error` — fail only when validation could not run for a spec.
- `non-compliant` (default) — fail on `non-compliant` or `not-implemented`.
- `warning` — also fail on `partial`, `inconclusive`, or spec errors.

## How it works

```
discover openspec/specs
        ↓
parse Purpose / Requirements / Scenarios
        ↓
scan repository (.gitignore-aware, token-budgeted)
        ↓
rank files by relevance to each spec and build the prompt
        ↓
call the AI provider
        ↓
validate the response with zod and reconcile one finding per scenario
        ↓
aggregate → report → exit code
```

Missing findings are not silently dropped: each spec scenario without a model
finding is reported as `inconclusive`, so coverage is always explicit.

## Library usage

`sdd` is also an npm library:

```ts
import { resolve } from "node:path";
import {
  discoverOpenspec,
  loadConfig,
  renderReport,
  resolveProvider,
  scanRepository,
  validateProject,
} from "@ahlp/sdd";

const root = process.cwd();
const config = await loadConfig({ root });
const project = await discoverOpenspec(resolve(root, config.specsDir));
const repo = await scanRepository({
  root,
  include: config.include,
  exclude: config.exclude,
  includeTests: config.includeTests,
});
const provider = await resolveProvider({
  provider: config.provider,
  model: config.model,
  baseUrl: config.baseUrl,
  apiKey: config.apiKey,
});

const report = await validateProject({
  project,
  repo,
  provider,
  concurrency: config.concurrency,
});

console.log(renderReport(config.format, report));
```

All pipeline stages and the three renderers are exported from the package root.

## Development

```bash
npm install
npm run build        # compile to dist/
npm test             # vitest
npm run typecheck    # src + tests
```

The test suite includes an end-to-end run with a mock LM Studio server. A manual
runner validates a real project layout:

```bash
npm run build
node test/manual/run-fixture.mjs /path/to/project
```

## Limitations (v1)

- Report-only: it suggests fixes but never edits code or specs.
- Targets `openspec/specs/**`; the `changes/` proposal workflow is not covered.
- Model quality and context budget affect accuracy; truncated or omitted files
  are marked in the prompt.
- The published package has no runtime audit advisories. Dev tooling
  (Vitest 2/Vite) currently reports audit advisories that do not ship to
  consumers; a Vitest upgrade is planned.

## License

MIT — see [LICENSE](./LICENSE).
