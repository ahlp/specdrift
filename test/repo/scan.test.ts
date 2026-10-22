import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scanRepository } from "../../src/repo/scan.js";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "specdrift-scan-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function put(path: string, content: string): Promise<void> {
  const absolute = join(root, path);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, content, "utf8");
}

describe("scanRepository", () => {
  it("honors .gitignore, built-in ignores and classifies files", async () => {
    await put(".gitignore", "ignored.txt\nsecret/\n");
    await put("src/app.ts", "export const app = 1;\n");
    await put("src/util.ts", "export const util = 1;\n");
    await put("tests/app.test.ts", 'test("app", () => {});\n');
    await put("README.md", "# Fixture\n");
    await put("package-lock.json", "{}\n");
    await put("node_modules/pkg/index.js", "module.exports = {};\n");
    await put("openspec/specs/x/spec.md", "## Purpose\n");
    await put("secret/hidden.ts", "export const hidden = 1;\n");
    await put("ignored.txt", "ignore me\n");
    await put("image.png", "not really a png");

    const context = await scanRepository({ root });
    const paths = context.files.map((file) => file.path);

    expect(paths).toContain("src/app.ts");
    expect(paths).toContain("src/util.ts");
    expect(paths).toContain("tests/app.test.ts");
    expect(paths).toContain("README.md");

    expect(paths).not.toContain("ignored.txt");
    expect(paths).not.toContain("secret/hidden.ts");
    expect(paths).not.toContain("node_modules/pkg/index.js");
    expect(paths).not.toContain("package-lock.json");
    expect(paths).not.toContain("openspec/specs/x/spec.md");
    expect(paths).not.toContain("image.png");

    const app = context.files.find((file) => file.path === "src/app.ts");
    expect(app).toMatchObject({
      kind: "source",
      language: "typescript",
      truncated: false,
    });

    expect(
      context.files.find((file) => file.path === "tests/app.test.ts")?.kind,
    ).toBe("test");
    expect(context.files.find((file) => file.path === "README.md")?.kind).toBe(
      "docs",
    );

    // Source files are prioritized ahead of config, tests and docs.
    expect(context.files[0]?.kind).toBe("source");
  });

  it("can exclude test files", async () => {
    await put("src/app.ts", "export const app = 1;\n");
    await put("tests/app.test.ts", 'test("app", () => {});\n');

    const context = await scanRepository({ root, includeTests: false });
    const paths = context.files.map((file) => file.path);

    expect(paths).toContain("src/app.ts");
    expect(paths).not.toContain("tests/app.test.ts");
  });

  it("applies an --include allowlist", async () => {
    await put("src/app.ts", "export const app = 1;\n");
    await put("src/util.ts", "export const util = 1;\n");
    await put("README.md", "# Fixture\n");

    const context = await scanRepository({
      root,
      include: ["src/**/*.ts"],
    });
    const paths = context.files.map((file) => file.path).sort();

    expect(paths).toEqual(["src/app.ts", "src/util.ts"]);
  });

  it("applies extra exclude patterns", async () => {
    await put("src/app.ts", "export const app = 1;\n");
    await put("src/util.ts", "export const util = 1;\n");

    const context = await scanRepository({
      root,
      exclude: ["src/util.ts"],
    });
    const paths = context.files.map((file) => file.path);

    expect(paths).toContain("src/app.ts");
    expect(paths).not.toContain("src/util.ts");
  });

  it("truncates files that exceed the per-file budget", async () => {
    await put("src/big.ts", "a".repeat(1000));

    const context = await scanRepository({ root, maxFileBytes: 100 });
    const big = context.files.find((file) => file.path === "src/big.ts");

    expect(big?.content).toHaveLength(100);
    expect(big?.bytes).toBe(1000);
    expect(big?.truncated).toBe(true);
  });

  it("stops at the total byte budget and records why", async () => {
    await put("src/a.ts", "a".repeat(100));
    await put("src/b.ts", "b".repeat(100));
    await put("src/c.ts", "c".repeat(100));

    const context = await scanRepository({ root, maxTotalBytes: 150 });

    expect(context.files).toHaveLength(2);
    expect(context.totalBytes).toBe(150);
    expect(context.files[1]?.truncated).toBe(true);
    expect(context.budgetExhausted).toBe(true);
    expect(
      context.skipped.some(
        (entry) => entry.reason === "total byte budget reached",
      ),
    ).toBe(true);
  });

  it("skips files that look binary", async () => {
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "src", "blob.ts"), Buffer.from([0, 1, 2, 3]));

    const context = await scanRepository({ root });

    expect(context.files).toHaveLength(0);
    expect(
      context.skipped.some((entry) => entry.reason === "binary content"),
    ).toBe(true);
  });
});
