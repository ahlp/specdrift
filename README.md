# specdrift

> Framework-agnostic semantic spec validation. Point it at your specs and your
> code; it tells you where they drift apart, using a local or cloud AI provider.

`specdrift` complements structural validators such as `openspec validate`:
instead of checking that spec files are well-formed, it asks an AI model to
compare each requirement and scenario with the real repository source and report
drift, with evidence.

**OpenSpec is the first supported spec format**, but the validation engine is
format-agnostic. New adapters can map other formats — Gherkin, RFC-style
documents, custom Markdown, ADRs — onto the same pipeline without changing the
CLI or the AI layer.

```
specdrift openspec              # OpenSpec command group (prints help)
specdrift openspec validate     # semantic validation for OpenSpec projects
```

## Why framework-agnostic?

The pipeline is deliberately split into two layers:

```
┌──────────────────────┐
│  spec format adapter │  discovery + parsing (e.g. src/openspec)
└──────────┬───────────┘
           │ neutral model: Spec → Requirement → Scenario → GIVEN/WHEN/THEN
           ▼
┌──────────────────────────────────────────────────────────┐
│ repository scan → prompt → AI provider → reconcile → report │
│              (format-agnostic core)                        │
└──────────────────────────────────────────────────────────┘
```

The core (`src/repo`, `src/ai`, `src/validate`, `src/report`) knows nothing about
OpenSpec-specific files. An adapter only has to:

1. discover spec files, and
2. parse them into the neutral requirement/scenario model.

The CLI is structured per format (`specdrift <format> validate`), so adding a
new adapter does not break existing commands.

### Supported formats

| Format                      | Command                       | Status    |
| --------------------------- | ----------------------------- | --------- |
| OpenSpec                    | `specdrift openspec validate` | ✅ v1     |
| Gherkin / Cucumber          | `specdrift gherkin validate`  | planned   |
| Custom Markdown / RFC specs | `specdrift markdown validate` | planned   |
| ADRs                        | `specdrift adr validate`      | exploring |

## Requirements

- Node.js >= 18
- An AI provider:
  - [LM Studio](https://lmstudio.ai/) running locally (recommended), or
  - [Ollama](https://ollama.com/) running locally, or
  - a DeepSeek API key

## Install

```bash
npm install -g specdrift
# or run without installing
npx specdrift openspec validate
```

## Quick start

From a repository that contains an `openspec/` directory:

```bash
# Auto-detect a local provider (LM Studio, then Ollama)
specdrift openspec validate

# Force a provider and model
specdrift openspec validate --provider ollama --model llama3.1

# Machine-readable report + fail CI on drift
specdrift openspec validate --format json --fail-on non-compliant
```

The default report is written to stdout in Markdown. Use `--output report.md`
to write it to a file (colors are only used for TTY stdout).

## Expected OpenSpec layout

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

### `specdrift openspec validate`

| Flag                  | Description                                                          | Default          |
| --------------------- | -------------------------------------------------------------------- | ---------------- |
| `--specs-dir <path>`  | Directory containing `openspec/` (or the `specs/` dir)               | `./openspec`     |
| `--root <path>`       | Repository root to scan                                              | `process.cwd()`  |
| `--provider <name>`   | `lmstudio` \| `ollama` \| `deepseek`                                 | auto-detect      |
| `--model <id>`        | Model id/name                                                        | provider default |
| `--base-url <url>`    | Provider endpoint override                                           | provider default |
| `--api-key <key>`     | DeepSeek API key (prefer `DEEPSEEK_API_KEY`)                         | env              |
| `--format <fmt>`      | `markdown` \| `json` \| `text`                                       | `markdown`       |
| `--output <file>`     | Write the report to a file; `-` is stdout                            | `-`              |
| `--fail-on <level>`   | `error` \| `warning` \| `non-compliant`                              | `non-compliant`  |
| `--prompt <name>`     | Prompt preset: `permissive` \| `decision-tree` \| `minimal` \| `rtf` | `rtf`            |
| `--include <glob...>` | Only scan matching files                                             | all              |
| `--exclude <glob...>` | Extra ignore globs                                                   | none             |
| `--max-tokens <n>`    | Cap per-request output tokens                                        | provider default |
| `--concurrency <n>`   | Parallel spec requests                                               | `2`              |
| `--timeout <ms>`      | Provider request timeout                                             | provider default |
| `--verbose`           | Print prompts, raw responses and debug details                       | off              |

The repository scan honors `.gitignore` and always skips VCS directories, build
output, lockfiles, binaries, and `openspec/` itself.

## Providers

### LM Studio (local)

1. Load a model in LM Studio.
2. Start the local server (default `http://localhost:1234`).
3. Run `specdrift openspec validate --provider lmstudio`.

Override the endpoint with `--base-url` or `SPECDRIFT_LMSTUDIO_BASE_URL`. No API
key is required.

> **Slow / reasoning models:** large models (e.g. 27B) processing repository
> context can exceed the default request timeout, and reasoning models spend
> output tokens on `reasoning_content` before producing JSON. For those, run
> with reduced concurrency and a larger budget:
>
> ```bash
> specdrift openspec validate --provider lmstudio --model <model> \
>   --concurrency 1 --max-tokens 8192 --timeout 600000
> ```
>
> `HTTP 0` in an error means a transport-level failure (connection refused or
> timeout); the underlying cause is included in the message after `HTTP 0:`.

### Ollama (local)

```bash
ollama serve
ollama pull llama3.1
specdrift openspec validate --provider ollama --model llama3.1
```

The native `/api/chat` endpoint is used by default. A base URL ending in `/v1`
switches to Ollama's OpenAI-compatible endpoint. Environment overrides:
`SPECDRIFT_OLLAMA_BASE_URL`, `SPECDRIFT_OLLAMA_MODEL`.

### DeepSeek (cloud)

```bash
export DEEPSEEK_API_KEY=sk-...
specdrift openspec validate --provider deepseek --model deepseek-chat
```

Defaults to `https://api.deepseek.com/v1` and `deepseek-chat`.
Environment overrides: `SPECDRIFT_DEEPSEEK_API_KEY`,
`SPECDRIFT_DEEPSEEK_BASE_URL`, `SPECDRIFT_DEEPSEEK_MODEL`.

> **Privacy:** LM Studio and Ollama keep repository content on your machine.
> DeepSeek uploads the selected source files to a third party. `specdrift`
> prints a warning when a cloud provider is selected.

### Provider auto-detection

When `--provider` and `SPECDRIFT_PROVIDER` are absent, `specdrift` probes:

1. LM Studio (`http://localhost:1234`)
2. Ollama (`http://localhost:11434`)
3. DeepSeek (only if an API key is available)

If none is reachable it exits with a clear message and code `4`.

## Configuration

Precedence, highest first:

1. CLI flags
2. `SPECDRIFT_*` environment variables
3. `.specdriftrc` / `.specdriftrc.json` / `.specdriftrc.yaml` /
   `.specdriftrc.yml` in the repository root
4. Built-in defaults

`.specdriftrc` may be JSON or YAML:

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

| Variable                                          | Purpose                              |
| ------------------------------------------------- | ------------------------------------ |
| `SPECDRIFT_PROVIDER`                              | `lmstudio` \| `ollama` \| `deepseek` |
| `SPECDRIFT_MODEL`                                 | Model override                       |
| `SPECDRIFT_BASE_URL`                              | Generic endpoint override            |
| `SPECDRIFT_SPECS_DIR`                             | OpenSpec directory                   |
| `SPECDRIFT_FORMAT`                                | Report format                        |
| `SPECDRIFT_FAIL_ON`                               | Failure threshold                    |
| `SPECDRIFT_CONCURRENCY`                           | Parallel spec requests               |
| `SPECDRIFT_MAX_TOKENS`                            | Output token cap                     |
| `SPECDRIFT_TEMPERATURE`                           | Sampling temperature                 |
| `SPECDRIFT_MAX_FILE_BYTES`                        | Per-file scan budget                 |
| `SPECDRIFT_MAX_TOTAL_BYTES`                       | Total scan budget                    |
| `SPECDRIFT_MAX_CONTEXT_BYTES`                     | Prompt context budget                |
| `SPECDRIFT_INCLUDE_TESTS`                         | Include test files in the scan       |
| `SPECDRIFT_TIMEOUT_MS`                            | Provider request timeout             |
| `SPECDRIFT_LMSTUDIO_BASE_URL`                     | LM Studio endpoint                   |
| `SPECDRIFT_OLLAMA_BASE_URL`                       | Ollama endpoint                      |
| `SPECDRIFT_OLLAMA_MODEL`                          | Ollama model                         |
| `SPECDRIFT_DEEPSEEK_BASE_URL`                     | DeepSeek endpoint                    |
| `SPECDRIFT_DEEPSEEK_MODEL`                        | DeepSeek model                       |
| `SPECDRIFT_DEEPSEEK_API_KEY` / `DEEPSEEK_API_KEY` | DeepSeek key                         |

Project-wide guidance in `openspec/config.yaml` (`context`, `rules`,
`operations`) is included in the prompt.

## Reports

Three formats are available:

- **markdown** (default) — a summary table followed by one section per
  capability, with evidence.
- **json** — stable machine-readable output with `schemaVersion: 1`, finding
  statuses and drift classifications.
- **text** — compact colorized terminal output.

Each finding reports:

| Field            | Meaning                                                         |
| ---------------- | --------------------------------------------------------------- |
| `status`         | `compliant`, `non-compliant`, `not-implemented`, `inconclusive` |
| `classification` | Drift class `A`–`G`, or `null` when compliant                   |
| `evidence.files` | Repository paths used as evidence                               |
| `evidence.note`  | Short justification                                             |

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
- `warning` — also fail on `inconclusive`, or spec errors.

## How it works

```
discover specs (format adapter)
        ↓
parse Purpose / Requirements / Scenarios into the neutral model
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

`specdrift` is also an npm library:

```ts
import { resolve } from "node:path";
import {
  discoverOpenspec,
  loadConfig,
  renderReport,
  resolveProvider,
  scanRepository,
  validateProject,
} from "specdrift";

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
Future format adapters are expected to expose the same `discover*` + parsed
`Spec` shape, so they can reuse `scanRepository`, `validateProject` and the
report renderers unchanged.

## Development

```bash
npm install
npm run build        # compile to dist/
npm test             # vitest
npm run typecheck    # src + tests
npm run ci           # typecheck + test + build
```

The test suite includes an end-to-end run with a mock LM Studio server. A manual
runner validates a real project layout:

```bash
npm run build
node test/manual/run-fixture.mjs /path/to/project
```

CI is defined in `.github/workflows/ci.yml` and runs typecheck, tests, build, the
CLI smoke check and `npm pack --dry-run`.

## Roadmap

- Additional spec adapters (`gherkin`, `markdown`/RFC, `adr`).
- `specdrift <format> init` / `list` / `diff` commands.
- SARIF output for code-scanning integrations.
- Optional auto-fix proposals (still report-only by default).

## Limitations (v1)

- Report-only: it reports explicit violations but never edits code or specs.
- Only the OpenSpec adapter is implemented.
- Targets `openspec/specs/**`; the `changes/` proposal workflow is not covered.
- Model quality and context budget affect accuracy; truncated or omitted files
  are marked in the prompt.
- The published package has no runtime audit advisories. Dev tooling
  (Vitest 2/Vite) currently reports audit advisories that do not ship to
  consumers; a Vitest upgrade is planned.

## License

MIT — see [LICENSE](./LICENSE).
