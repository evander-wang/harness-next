import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import { checkNodeTypeScriptPolicy } from "../src/node-project/node-typescript-policy.js";

async function createProject(): Promise<string> {
  const rootDir = await mkdtemp(join(tmpdir(), "harness-node-policy-"));
  await mkdir(join(rootDir, "src"), { recursive: true });
  await mkdir(join(rootDir, "test"), { recursive: true });
  await mkdir(join(rootDir, "harness", "workflows", "node-typescript-standards"), {
    recursive: true,
  });
  await writeFile(
    join(rootDir, "harness", "workflows", "node-typescript-standards", "STANDARDS.md"),
    `---
version: "1.0.0"
scope:
  includeDirectories: [src]
  excludeDirectories: [node_modules, dist, coverage, test, tests, __tests__]
limits:
  maxLineLength: 120
  maxFunctionLines: 80
  maxFileLines: 600
  maxCyclomaticComplexity: 10
---

# Node.js TypeScript 开发规范
`,
    "utf8",
  );
  return rootDir;
}

describe("checkNodeTypeScriptPolicy", () => {
  test("报告生产代码中超过规范上限的行、函数、文件和复杂度", async () => {
    const rootDir = await createProject();
    const source = [
      "export function oversized(value: number): number {",
      ...Array.from({ length: 80 }, (_, index) => `  const value${String(index)} = ${String(index)};`),
      "  if (value > 0) return 1;",
      "  if (value > 1) return 2;",
      "  if (value > 2) return 3;",
      "  if (value > 3) return 4;",
      "  if (value > 4) return 5;",
      "  if (value > 5) return 6;",
      "  if (value > 6) return 7;",
      "  if (value > 7) return 8;",
      "  if (value > 8) return 9;",
      "  if (value > 9) return 10;",
      "  if (value > 10) return 11;",
      `  const message = "${"x".repeat(121)}";`,
      "  return message.length;",
      "}",
      ...Array.from({ length: 510 }, () => ""),
    ].join("\n");
    await writeFile(join(rootDir, "src", "oversized.ts"), `${source}\n`, "utf8");

    const result = await checkNodeTypeScriptPolicy({ rootDir });

    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "source.line-too-long",
        "source.function-too-long",
        "source.file-too-long",
        "source.function-too-complex",
      ]),
    );
  });

  test("忽略测试目录和构建产物", async () => {
    const rootDir = await createProject();
    await mkdir(join(rootDir, "dist"), { recursive: true });
    const oversized = `${"x".repeat(121)}\n`.repeat(700);
    await writeFile(join(rootDir, "test", "fixture.test.ts"), oversized, "utf8");
    await writeFile(join(rootDir, "dist", "bundle.ts"), oversized, "utf8");

    const result = await checkNodeTypeScriptPolicy({ rootDir });

    expect(result).toMatchObject({ ok: true, issues: [] });
  });

  test("只检查本次变更涉及的生产文件", async () => {
    const rootDir = await createProject();
    await writeFile(join(rootDir, "src", "legacy.ts"), `${"x".repeat(121)}\n`, "utf8");
    await writeFile(join(rootDir, "src", "changed.ts"), "export const value = 1;\n", "utf8");

    const result = await checkNodeTypeScriptPolicy({
      rootDir,
      sourcePaths: ["src/changed.ts"],
    });

    expect(result).toMatchObject({ ok: true, issues: [] });
  });
});
