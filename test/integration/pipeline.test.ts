import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveProvider } from "../../src/ai/detect.js";
import { loadConfig } from "../../src/config/load.js";
import { discoverOpenspec } from "../../src/openspec/discover.js";
import { renderReport } from "../../src/report/index.js";
import { scanRepository } from "../../src/repo/scan.js";
import { validateProject } from "../../src/validate/run.js";

const SPEC = [
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
].join("\n");

const CODE = 'export function DecisionDisplay() { return "SIM"; }\n';

const MODEL_RESPONSE = {
  spec: "decision-display",
  findings: [
    {
      requirement: "Display decision",
      scenario: "Render SIM",
      status: "compliant",
      classification: null,
      evidence: {
        files: ["src/DecisionDisplay.tsx"],
        note: "renders SIM",
      },
    },
    {
      requirement: "Display decision",
      scenario: "Render NAO",
      status: "non-compliant",
      classification: "D",
      evidence: {
        files: ["src/DecisionDisplay.tsx"],
        note: "theme is missing",
      },
    },
  ],
};

interface MockServer {
  server: Server;
  baseUrl: string;
  prompts: string[];
}

async function startMockServer(): Promise<MockServer> {
  const prompts: string[] = [];

  const server = createServer((request, response) => {
    response.setHeader("connection", "close");

    if (request.method === "GET" && request.url === "/v1/models") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ data: [{ id: "mock-model" }] }));
      return;
    }

    if (request.method === "POST" && request.url === "/v1/chat/completions") {
      let raw = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => {
        raw += chunk;
      });
      request.on("end", () => {
        prompts.push(raw);
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            choices: [{ message: { content: JSON.stringify(MODEL_RESPONSE) } }],
          }),
        );
      });
      return;
    }

    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "not found" }));
  });

  await new Promise<void>((resolveListen) =>
    server.listen(0, "127.0.0.1", resolveListen),
  );

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("mock server did not bind to a TCP port");
  }

  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    prompts,
  };
}

async function closeServer(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
}

async function makeRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "specdrift-e2e-"));
  await mkdir(join(root, "openspec", "specs", "decision-display"), {
    recursive: true,
  });
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(
    join(root, "openspec", "specs", "decision-display", "spec.md"),
    SPEC,
    "utf8",
  );
  await writeFile(join(root, "src", "DecisionDisplay.tsx"), CODE, "utf8");
  return root;
}

describe("end-to-end pipeline", () => {
  it("discovers, scans, calls the provider and renders a report", async () => {
    const root = await makeRepo();
    const mock = await startMockServer();

    try {
      const config = await loadConfig({
        root,
        env: {},
        file: false,
        overrides: {
          provider: "lmstudio",
          baseUrl: mock.baseUrl,
          model: "mock-model",
          format: "json",
          concurrency: 1,
        },
      });

      const project = await discoverOpenspec(resolve(root, config.specsDir));
      expect(project.specs).toHaveLength(1);

      const repo = await scanRepository({
        root,
        include: config.include,
        exclude: config.exclude,
        includeTests: config.includeTests,
        maxFileBytes: config.maxFileBytes,
        maxTotalBytes: config.maxTotalBytes,
      });
      expect(repo.files.map((file) => file.path)).toEqual([
        "src/DecisionDisplay.tsx",
      ]);

      const provider = await resolveProvider({
        provider: config.provider,
        baseUrl: config.baseUrl,
        model: config.model,
      });
      expect(provider.id).toBe("lmstudio");

      const report = await validateProject({
        project,
        repo,
        provider,
        model: config.model,
        concurrency: config.concurrency,
      });

      expect(report.provider).toBe("lmstudio");
      expect(report.specs[0]?.status).toBe("non-compliant");
      expect(report.totals).toMatchObject({
        compliant: 1,
        nonCompliant: 1,
        total: 2,
      });

      const json = renderReport("json", report);
      expect(JSON.parse(json)).toMatchObject({ schemaVersion: 1 });
      expect(json).toContain('"classification": "D"');

      expect(mock.prompts).toHaveLength(1);
      const payload = JSON.parse(mock.prompts[0] ?? "{}") as {
        messages?: Array<{ content: string }>;
      };
      const userPrompt = payload.messages?.[1]?.content ?? "";
      expect(userPrompt).toContain("# Capability: decision-display");
      expect(userPrompt).toContain("src/DecisionDisplay.tsx");
      expect(userPrompt).toContain("Render SIM");
    } finally {
      await closeServer(mock.server);
      await rm(root, { recursive: true, force: true });
    }
  });
});
