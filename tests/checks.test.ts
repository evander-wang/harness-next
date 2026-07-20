import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import {
  executeDeterministicChecks,
  loadCheckDefinition,
} from "../src/workflow/checks.js";

async function writeCheck(rootDir: string, id: string, source: string): Promise<void> {
  const directory = join(rootDir, "harness/checks", id);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "CHECK.md"), source);
}

describe("Check definitions", () => {
  test("读取结构化确定性命令", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "harness-check-"));
    await writeCheck(
      rootDir,
      "quality-gate",
      `---
commands:
  - command: npm
    args: [run, lint]
  - command: git
    args: [diff, --check]
---
# Quality Gate
`,
    );

    const definition = await loadCheckDefinition({ rootDir, checkId: "quality-gate" });

    expect(definition.commands).toEqual([
      { command: "npm", args: ["run", "lint"] },
      { command: "git", args: ["diff", "--check"] },
    ]);
  });

  test("拒绝 Shell 字符串和非法参数", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "harness-check-"));
    await writeCheck(
      rootDir,
      "unsafe-command",
      `---
commands:
  - npm run lint && npm test
---
# Unsafe
`,
    );

    await expect(
      loadCheckDefinition({ rootDir, checkId: "unsafe-command" }),
    ).rejects.toThrow("Check 'unsafe-command' 的 commands 必须使用 command 和 args 结构。");
  });

  test("执行命令并只返回退出码、耗时和输出 Digest", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "harness-check-"));
    await writeCheck(
      rootDir,
      "node-command",
      `---
commands:
  - command: node
    args: ["-e", "process.stdout.write('check-output')"]
---
# Node Command
`,
    );

    const results = await executeDeterministicChecks({
      rootDir,
      checkIds: ["node-command"],
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      checkId: "node-command",
      command: "node",
      args: ["-e", "process.stdout.write('check-output')"],
      exitCode: 0,
    });
    expect(results[0]?.durationMs).toBeGreaterThanOrEqual(0);
    expect(results[0]?.outputDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(results[0]).not.toHaveProperty("stdout");
    expect(results[0]).not.toHaveProperty("stderr");
  });
});
