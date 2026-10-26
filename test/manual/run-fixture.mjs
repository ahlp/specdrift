#!/usr/bin/env node
/**
 * Manual smoke run against a real OpenSpec project using a mock LM Studio
 * server. The mock returns "compliant" for every expected scenario, so this
 * exercises discovery, repository scanning, prompt construction, the provider
 * HTTP path, reconciliation and reporting without requiring a live model.
 *
 * Usage:
 *   npm run build
 *   node test/manual/run-fixture.mjs [path-to-project]
 */
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const fixtureRoot =
  process.argv[2] ?? resolve(repoRoot, "..", "flood-status-recife");

function extractExpectedScenarios(prompt) {
  const scenarios = [];
  const pattern = /- requirement: (".*?")\n\s*scenario: (".*?")/g;
  let match;

  while ((match = pattern.exec(prompt)) !== null) {
    scenarios.push({
      requirement: JSON.parse(match[1]),
      scenario: JSON.parse(match[2]),
    });
  }

  return scenarios;
}

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
      let userPrompt = "";
      try {
        const payload = JSON.parse(raw);
        userPrompt =
          payload.messages?.find((message) => message.role === "user")
            ?.content ?? "";
      } catch {
        // fall through with an empty prompt
      }

      const findings = extractExpectedScenarios(userPrompt).map(
        ({ requirement, scenario }) => ({
          requirement,
          scenario,
          status: "compliant",
          classification: null,
          evidence: { files: [], note: "mock provider" },
        }),
      );

      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({ findings }),
              },
            },
          ],
        }),
      );
    });
    return;
  }

  response.writeHead(404);
  response.end();
});

await new Promise((resolveListen) =>
  server.listen(0, "127.0.0.1", resolveListen),
);

const address = server.address();
if (!address || typeof address === "string") {
  throw new Error("mock server did not bind to a TCP port");
}

const child = spawn(
  process.execPath,
  [
    resolve(repoRoot, "dist", "cli", "index.js"),
    "openspec",
    "validate",
    "--root",
    fixtureRoot,
    "--specs-dir",
    resolve(fixtureRoot, "openspec"),
    "--provider",
    "lmstudio",
    "--base-url",
    `http://127.0.0.1:${address.port}/v1`,
    "--model",
    "mock-model",
    "--format",
    "text",
  ],
  { stdio: "inherit" },
);

child.on("exit", (code) => {
  server.closeAllConnections();
  server.close(() => process.exit(code ?? 0));
});
