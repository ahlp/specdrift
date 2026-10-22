# Plan: `sdd` — Semantic OpenSpec Validation CLI

> **Note:** this project was implemented and later renamed to **`specdrift`**.
> The original `sdd` name is kept in this historical plan.
>
> Status: draft (plan only — no code changes yet)
> Repository: `ahlp/sdd`
> Reference implementation/fixture: `ahlp/flood-status-recife`

---

## 1. Goal

Build an npm library + CLI named **`sdd`** that adds a **semantic** validation
layer on top of the OpenSpec format. Given a repository that contains an
`openspec/` directory, `sdd` compares each OpenSpec requirement/scenario against
the **actual repository source code** and reports whether the code matches the
spec — using an AI model as the reasoning engine.

The CLI exposes:

```
sdd openspec              # openspec command group (help / entrypoint)
sdd openspec validate     # semantic validation of openspec vs repo content
```

The existing `@fission-ai/openspec` tool already provides _structural_ validation
(`openspec validate --specs`). `sdd` complements it with _semantic_ validation:
it detects drift between spec and code, which structural validation cannot.

---

## 2. Reference format (OpenSpec)

From `flood-status-recife`, the layout is:

```
openspec/
├── config.yaml                     # schema: spec-driven (+ optional context/rules)
└── specs/
    ├── decision-display/
    │   └── spec.md
    ├── geo-location/spec.md
    └── ...
```

Each `spec.md` follows this shape:

```markdown
## Purpose

One-paragraph description of the capability.

## Requirements

### Requirement: <Title>

The system SHALL ...

#### Scenario: <Title>

- **GIVEN** ...
- **WHEN** ...
- **THEN** ...
```

Important real-world details to handle:

- Specs may be written in **English, Portuguese, or mixed** (the fixture mixes
  "The system SHALL" requirement text with Portuguese scenario steps).
- `openspec/config.yaml` uses `schema: spec-driven` and may carry optional
  `context`, `rules`, and `operations` guidance — these should be fed into the
  AI prompt as project context.
- The repository may also contain `openspec/changes/` (proposal workflow). For
  v1, validation targets `openspec/specs/**` only; `changes/` is out of scope.

---

## 3. CLI surface

### 3.1 Command tree

```
sdd openspec
sdd openspec validate
```

`openspec` alone prints help for the group. `openspec validate` performs the
semantic comparison. (Room to add `sdd openspec init`, `list`, `diff`, etc.
later.)

### 3.2 Flags for `sdd openspec validate`

| Flag                 | Description                                              | Default            |
| -------------------- | -------------------------------------------------------- | ------------------ |
| `--specs-dir <path>` | Directory containing `openspec/`                         | `./openspec`       |
| `--root <path>`      | Repository root to scan                                  | `process.cwd()`    |
| `--provider <name>`  | `lmstudio` \| `ollama` \| `deepseek`                     | auto-detect        |
| `--model <id>`       | Model id/name override                                   | provider default   |
| `--base-url <url>`   | Override provider endpoint                               | provider default   |
| `--api-key <key>`    | API key (DeepSeek) — prefer env var                      | `DEEPSEEK_API_KEY` |
| `--format <fmt>`     | `markdown` \| `json` \| `text`                           | `markdown`         |
| `--output <file>`    | Write report to file instead of stdout                   | `-` (stdout)       |
| `--fail-on <level>`  | Exit non-zero at `error` \| `warning` \| `non-compliant` | `non-compliant`    |
| `--include <glob>`   | Restrict source files scanned                            | `**/*`             |
| `--exclude <glob>`   | Extra ignore globs (gitignore is always honored)         | none               |
| `--max-tokens <n>`   | Cap per-request output tokens                            | provider default   |
| `--verbose`          | Debug: print prompts, timing, raw responses              | off                |
| `--concurrency <n>`  | Parallel AI requests per spec                            | `2`                |

### 3.3 Exit codes (CI-friendly)

| Code | Meaning                                                    |
| ---- | ---------------------------------------------------------- |
| `0`  | All requirements compliant                                 |
| `1`  | Validation ran; ≥1 non-compliant finding (see `--fail-on`) |
| `2`  | Usage/argument error                                       |
| `3`  | No `openspec/` found / parse error                         |
| `4`  | AI provider unreachable or returned malformed output       |

---

## 4. Architecture

```
sdd/
├── package.json                 # bin: sdd
├── tsconfig.json
├── src/
│   ├── cli/
│   │   ├── index.ts             # argv parsing, command dispatch
│   │   ├── commands/
│   │   │   ├── openspec.ts      # openspec group
│   │   │   └── validate.ts      # validate command orchestration
│   │   └── options.ts           # flag/option definitions & env resolution
│   ├── config/
│   │   ├── load.ts              # .sddrc / openspec/config.yaml / env
│   │   └── schema.ts            # zod schema for config
│   ├── openspec/
│   │   ├── discover.ts          # find specs, config.yaml, changes/
│   │   ├── parse.ts             # parse spec.md -> typed AST
│   │   └── types.ts             # Spec, Requirement, Scenario types
│   ├── repo/
│   │   ├── scan.ts              # walk repo, honor .gitignore
│   │   ├── read.ts              # read + truncate source files
│   │   └── index.ts             # build repo context (file map)
│   ├── ai/
│   │   ├── provider.ts          # Provider interface
│   │   ├── lmstudio.ts          # OpenAI-compatible local server
│   │   ├── ollama.ts            # local Ollama
│   │   ├── deepseek.ts          # DeepSeek cloud API
│   │   ├── detect.ts            # auto-detect reachable provider
│   │   └── prompt.ts            # prompt + JSON schema construction
│   ├── validate/
│   │   ├── run.ts               # per-spec orchestration + concurrency
│   │   ├── result.ts            # finding types, classification
│   │   └── aggregate.ts         # merge findings into report
│   ├── report/
│   │   ├── markdown.ts
│   │   ├── json.ts
│   │   ├── text.ts
│   │   └── themes.ts            # colored console output
│   └── index.ts                 # public API (programmatic use)
└── test/
    ├── fixtures/
    └── *.test.ts
```

### 4.1 Two usage modes

1. **CLI** — `sdd openspec validate` (primary, described above).
2. **Programmatic** — export a public API so `sdd` can also be consumed as a
   library (`import { validate } from 'sdd'`), matching the "npm lib" goal.

---

## 5. OpenSpec parsing (`src/openspec`)

Parsing is **deliberately lightweight and resilient** (specs are Markdown, not
code):

1. Discover `specs/**/*.md` plus `config.yaml`.
2. Split each file into:
   - `purpose` — text under `## Purpose`.
   - `requirements[]` — blocks under `### Requirement:`.
   - `scenarios[]` — blocks under `#### Scenario:`, each with a list of
     `GIVEN` / `WHEN` / `THEN` steps.
3. Capture non-conforming content as warnings (e.g. a scenario missing
   `THEN`), rather than hard-failing, so semantic validation can still run.

The parser must be **language-agnostic** (no Portuguese/English assumptions):
it keys off the structural markers (`## Purpose`, `### Requirement:`,
`#### Scenario:`, bold `**GIVEN/WHEN/THEN**`).

---

## 6. Repository scanning (`src/repo`)

Build a **repository context** to send to the model:

- Walk the repo honoring `.gitignore` (and `--exclude`/`--include`).
- Skip binaries, `node_modules`, `.git`, lockfiles, and generated `dist/`
  (configurable; default matches the fixture layout where source lives in
  `backend/src`, `frontend/src`).
- Produce a compact map `{ relativePath: sourceText }` with per-file byte caps
  and a total budget, to stay within the model's context window.
- Include `openspec/config.yaml` context/rules in the prompt preamble.
- Optionally include test files (`*tests*`, `*.test.ts`) so the model can
  correlate scenarios with test evidence, mirroring the fixture's
  `spec-compliance-report.md`.

---

## 7. AI providers (`src/ai`)

A single `Provider` interface keeps the validation logic provider-agnostic:

```ts
interface Provider {
  id: "lmstudio" | "ollama" | "deepseek";
  chat(messages: ChatMessage[], opts: RequestOpts): Promise<string>;
  healthCheck(): Promise<boolean>;
}
```

### 7.1 LM Studio

- Endpoint: `http://localhost:1234/v1/chat/completions` (OpenAI-compatible).
- No API key required (local).
- Model default: configurable (`--model`), otherwise omit to use the loaded
  model.
- Env: `SDD_LMSTUDIO_BASE_URL` (default `http://localhost:1234/v1`).

### 7.2 Ollama

- Endpoint: `http://localhost:11434/api/chat` (native) **or** the
  OpenAI-compatible `http://localhost:11434/v1/chat/completions`. Prefer native
  `/api/chat` for simpler handling; fall back to `/v1`.
- No API key required (local).
- Env: `SDD_OLLAMA_BASE_URL` (default `http://localhost:11434`),
  `SDD_OLLAMA_MODEL` (default e.g. `llama3.1`).

### 7.3 DeepSeek

- Endpoint: `https://api.deepseek.com/v1/chat/completions`.
- Requires API key via `DEEPSEEK_API_KEY` env var (never hardcoded).
- Default model: `deepseek-chat`.
- Env: `SDD_DEEPSEEK_BASE_URL`, `SDD_DEEPSEEK_MODEL`.

### 7.4 Auto-detection (`--provider` omitted)

Order: explicit config → `SDD_PROVIDER` env → probe local hosts
(LM Studio `:1234`, Ollama `:11434`) with a short health check → fall back to
DeepSeek if a key is present → error with actionable message otherwise.

> Security note: local providers (LM Studio / Ollama) keep all repository code
> on-machine. DeepSeek uploads source to a third party — the CLI will print a
> one-line notice when a cloud provider is selected, so users are aware of the
> data-sharing implication.

---

## 8. Validation methodology (`src/validate`)

### 8.1 Overall flow

```
discover specs → parse → scan repo → for each spec:
    build prompt (config context + purpose + requirements + scenarios + repo map)
    → AI → parse structured JSON → classify findings
→ aggregate → render report → set exit code
```

### 8.2 Prompt design

For each **spec** (one capability = one request, so the model has full context):

- **System prompt**: role ("You are a strict spec-compliance reviewer"),
  the OpenSpec taxonomy below, and the required JSON output schema.
- **User content**: `config.yaml` context, the full `spec.md`, and the repo
  source map (relevant files prioritized first, with truncation markers).

### 8.3 Structured output contract (JSON)

The model is asked to return JSON (with a strict `zod` schema on our side to
guard against hallucinated/malformed output):

```jsonc
{
  "spec": "decision-display",
  "findings": [
    {
      "requirement": "Exibir Decisão do Dia Centralizada",
      "scenario": "Decisão SIM exibida corretamente com tema alerta",
      "status": "compliant", // compliant | partial | non-compliant | not-implemented | inconclusive
      "classification": "D", // A..G taxonomy (see below), or null
      "evidence": {
        "files": ["frontend/src/components/DecisionDisplay.tsx"],
        "note": "Renders 48px+ with #ff4d00 and 0.3s transition",
      },
      "fix": "Update RISK_THRESHOLD from 65 to 60 in riskEngine.ts", // suggested action
    },
  ],
}
```

`zod` validates every response; invalid JSON triggers one retry with a
corrective message, then marks the spec `inconclusive` with the raw output
preserved under `--verbose`.

### 8.4 Drift taxonomy (from the benchmark fixture)

Adopt the fixture's classification so `sdd` output maps to the research
benchmark (`openspec-benchmark-cases.md`):

| Class | Name                     | Meaning                                                              |
| ----- | ------------------------ | -------------------------------------------------------------------- |
| **A** | Spec drift               | Code changed legitimately; spec is stale → update spec               |
| **B** | Code drift               | Spec changed; code is stale → fix code                               |
| **C** | Green-field              | New spec, no implementation → plan modules                           |
| **D** | Regression/bug           | Code change violates GIVEN/WHEN/THEN → fix bug                       |
| **E** | Orphan/dead code         | Requirement removed from spec; code remains → flag dead code         |
| **F** | Contract/schema mismatch | Subtle payload/HTTP/unit/type mismatch                               |
| **G** | Split-brain              | Spec and code both changed, conflicting premises → human arbitration |

### 8.5 Per-scenario granularity

Validate at **scenario** level (one finding per scenario), then roll up to
requirements and spec status. Scenario granularity matches how OpenSpec is
written and how the benchmark cases are defined.

---

## 9. Report output (`src/report`)

Mirror the structure of the fixture's `spec-compliance-report.md`:

- **markdown** (default): one section per capability with a compliance table,
  evidence file paths, and a summary (e.g. `5/6 compliant`).
- **json**: machine-readable, including `classification` and `status` enums —
  suitable for the benchmark CSV in the fixture.
- **text**: compact colorized terminal output.

Report always includes: spec name, requirement, scenario, status, taxonomy
class, evidence files, and suggested fix.

---

## 10. Configuration (`src/config`)

Precedence (highest first):

1. CLI flags.
2. Environment variables (`SDD_*`, plus `DEEPSEEK_API_KEY`).
3. `.sddrc` (JSON/YAML) in the repo root.
4. `openspec/config.yaml` (read for context/rules only, not for provider config).
5. Built-in defaults.

Config keys: `provider`, `model`, `baseUrl`, `specsDir`, `include`, `exclude`,
`failOn`, `format`, `concurrency`.

---

## 11. Dependencies

| Package                            | Purpose                                   |
| ---------------------------------- | ----------------------------------------- |
| `commander` (or `yargs`)           | CLI parsing                               |
| `yaml`                             | Parse `config.yaml` / `.sddrc`            |
| `zod`                              | Validate config + AI JSON output          |
| `ignore` (or `fast-glob` + custom) | `.gitignore`-aware file scan              |
| `chalk`                            | Colored terminal output                   |
| `undici`/`fetch`                   | HTTP to providers (Node 18+ native fetch) |

Minimal dependencies; keep the parser dependency-free (hand-rolled Markdown
section parser) to avoid heavy Markdown libraries.

---

## 12. Testing strategy

- **Unit tests**:
  - OpenSpec parser against real fixture specs (bilingual, mixed markers).
  - `.gitignore` scan/truncation logic.
  - Provider adapters with mocked HTTP (no live server in unit tests).
  - JSON schema validation of AI responses (valid, malformed, truncated).
  - Report renderers.
- **Integration tests** (optional, opt-in): run against a **mock AI provider**
  that returns canned findings, so the full pipeline is deterministic without
  network.
- **Benchmark corpus**: reuse `flood-status-recife` as a fixture. Its
  `openspec-benchmark-cases.md` (20+ PR cases across taxonomy A–G) is the
  acceptance suite for measuring detection accuracy.
- **CI**: lint (`tsc --noEmit`), unit tests (`vitest`), and a `sdd openspec
validate --provider mock` smoke run.

---

## 13. Implementation phases

1. **Scaffold** — `package.json` (`bin: sdd`, `type: module`), TypeScript,
   build, minimal CLI skeleton with `sdd openspec` + `sdd openspec validate`
   stubs.
2. **OpenSpec parsing** — discover + parse `spec.md` into typed model, with
   unit tests on the fixture.
3. **Repo scanning** — `.gitignore`-aware walk, file caps, repo context map.
4. **AI provider layer** — `Provider` interface + LM Studio, Ollama, DeepSeek
   adapters + auto-detect + `zod` output schema.
5. **Validation core** — prompt construction, request/retry loop, finding
   classification (A–G), aggregation.
6. **Reporting** — markdown/json/text renderers + exit codes.
7. **Config & polish** — `.sddrc`/env resolution, `--verbose`, concurrency,
   cloud-provider notice.
8. **Hardening** — unit + integration tests, run against
   `flood-status-recife`, tune prompts against benchmark cases.
9. **Docs** — rewrite `README.md` (currently the GitLab template) with install,
   usage, provider setup, and output examples.

---

## 14. Open questions / decisions to confirm

1. **`sdd openspec` (no subcommand)** — should it alias to `validate` or just
   print help? (Plan assumes help.)
2. **Test files in the repo context** — include by default or opt-in via
   `--include-tests`? (Fixture correlates tests↔scenarios, so default-on is
   recommended but adds tokens.)
3. **Output JSON schema** — should it emit the benchmark-compatible CSV too?
   (Fixture already has `openspec-benchmark-branches.csv`.)
4. **Scoring** — do we report a percentage/"grade" per capability, or only
   per-scenario statuses?
5. **Provider defaults** — which local model IDs to assume for LM Studio/Ollama?

---

## 15. Out of scope (v1)

- Structural validation (already covered by `@fission-ai/openspec`).
- `openspec/changes/` proposal workflow (apply/archive).
- Auto-fixing code or specs (report-only; suggest fixes, never edit).
- Streaming responses / interactive mode.
