import { mkdtemp, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { describe, expect, test } from "vitest";

import { main } from "../src/cli.js";

async function createProject(): Promise<string> {
  const rootDir = await mkdtemp(join(tmpdir(), "harness-next-cli-"));
  await mkdir(join(rootDir, "harness/workflows/example"), { recursive: true });
  await mkdir(join(rootDir, "harness/checks/done"), { recursive: true });
  await mkdir(join(rootDir, "harness/models"), { recursive: true });
  await mkdir(join(rootDir, "harness/schemas"), { recursive: true });
  await mkdir(join(rootDir, "skills/run-example"), { recursive: true });
  await writeFile(join(rootDir, "AGENTS.md"), "# 约束\n");
  await writeFile(join(rootDir, "README.md"), "# 项目\n");
  await writeFile(join(rootDir, "keywords.md"), "# 关键词\n");
  await writeFile(join(rootDir, "CONTRIBUTING.md"), "# 贡献\n");
  await writeFile(join(rootDir, "package.json"), "{}\n");
  await writeFile(join(rootDir, "package-lock.json"), "{}\n");
  await writeFile(join(rootDir, "tsconfig.json"), "{}\n");
  await writeFile(join(rootDir, "harness/checks/done/CHECK.md"), "# 检查\n");
  await writeFile(join(rootDir, "skills/run-example/SKILL.md"), "# 执行\n");
  await writeFile(
    join(rootDir, "harness/workflows/example/workflow.yaml"),
    `document:
  dsl: "1.0.3"
  namespace: harness-next
  name: cli-example
  version: "0.1.0"
do:
  - run-example:
      call: run-example
      metadata:
        harness:
          checks: [done]
      then: end
`,
  );
  return rootDir;
}

describe("CLI", () => {
  test("validate 校验 Workflow，diagram 输出 Mermaid", async () => {
    const rootDir = await createProject();
    const output: string[] = [];
    const io = {
      cwd: rootDir,
      stdout: (message: string) => output.push(message),
      stderr: (message: string) => output.push(message),
    };

    const validateCode = await main(
      ["validate", "harness/workflows/example/workflow.yaml"],
      io,
    );
    const diagramCode = await main(
      ["diagram", "harness/workflows/example/workflow.yaml"],
      io,
    );

    expect(validateCode).toBe(0);
    expect(diagramCode).toBe(0);
    expect(output).toContain("Workflow：通过");
    expect(output.some((message) => message.includes("flowchart"))).toBe(true);
  });

  test("doctor 检查必要目录", async () => {
    const rootDir = await createProject();
    const output: string[] = [];

    const code = await main(["doctor"], {
      cwd: rootDir,
      stdout: (message) => output.push(message),
      stderr: (message) => output.push(message),
    });

    expect(code).toBe(0);
    expect(output).toEqual(["仓库结构：通过"]);
  });

  test("doctor 报告缺失的 Node.js 项目文件", async () => {
    const rootDir = await createProject();
    await unlink(join(rootDir, "package-lock.json"));
    const output: string[] = [];

    const code = await main(["doctor"], {
      cwd: rootDir,
      stdout: (message) => output.push(message),
      stderr: (message) => output.push(message),
    });

    expect(code).toBe(1);
    expect(output).toContain("- 缺失：package-lock.json");
  });

  test("image 将 Workflow 有向图写入本地 SVG", async () => {
    const rootDir = await createProject();
    const output: string[] = [];

    const code = await main(["image", "harness/workflows/example/workflow.yaml"], {
      cwd: rootDir,
      stdout: (message) => output.push(message),
      stderr: (message) => output.push(message),
    });
    const svg = await readFile(join(rootDir, "harness/generated/cli-example.svg"), "utf8");

    expect(code).toBe(0);
    expect(output).toContain("图片已生成：harness/generated/cli-example.svg");
    expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain("run-example");
  });

  test("image 支持指定工作区内的输出路径", async () => {
    const rootDir = await createProject();

    const code = await main(
      ["image", "harness/workflows/example/workflow.yaml", "docs/workflow.svg"],
      {
        cwd: rootDir,
        stdout: () => undefined,
        stderr: () => undefined,
      },
    );
    const svg = await readFile(join(rootDir, "docs/workflow.svg"), "utf8");

    expect(code).toBe(0);
    expect(svg).toContain("cli-example");
  });

  test("image 拒绝写入当前工作区之外", async () => {
    const rootDir = await createProject();
    const outsideName = `${basename(rootDir)}-outside.svg`;
    const output: string[] = [];

    const code = await main(
      ["image", "harness/workflows/example/workflow.yaml", `../${outsideName}`],
      {
        cwd: rootDir,
        stdout: (message) => output.push(message),
        stderr: (message) => output.push(message),
      },
    );

    expect(code).toBe(2);
    expect(output).toContain("图片输出路径必须位于当前工作区内。");
    await expect(readFile(join(rootDir, "..", outsideName), "utf8")).rejects.toThrow();
  });

  test("sync 生成 Workflow Catalog", async () => {
    const rootDir = await createProject();
    const output: string[] = [];

    const code = await main(["sync"], {
      cwd: rootDir,
      stdout: (message) => output.push(message),
      stderr: (message) => output.push(message),
    });
    const catalog = JSON.parse(
      await readFile(join(rootDir, "harness/generated/workflow-catalog.json"), "utf8"),
    ) as { workflows: Array<{ name: string }> };

    expect(code).toBe(0);
    expect(output).toEqual(["Workflow Catalog：已同步"]);
    expect(catalog.workflows.map((workflow) => workflow.name)).toEqual(["cli-example"]);
  });

  test("start、continue 和 cancel 管理本地 Workflow Run", async () => {
    const rootDir = await createProject();
    const inputPath = join(rootDir, "input.json");
    await writeFile(inputPath, "{}\n");
    const startOutput: string[] = [];

    const startCode = await main(
      ["start", "harness/workflows/example/workflow.yaml", "cli-task", "input.json"],
      {
        cwd: rootDir,
        stdout: (message) => startOutput.push(message),
        stderr: (message) => startOutput.push(message),
      },
    );
    const started = JSON.parse(startOutput[0] ?? "{}") as {
      runId: string;
      revision: number;
      step: { id: string };
    };

    expect(startCode).toBe(0);
    expect(started.step.id).toBe("run-example");

    const resultPath = join(rootDir, "result.json");
    await writeFile(
      resultPath,
      `${JSON.stringify({
        runId: started.runId,
        revision: started.revision,
        stepId: started.step.id,
        status: "blocked",
        evidence: ["等待外部输入"],
      })}\n`,
    );
    const continueOutput: string[] = [];
    const continueCode = await main(["continue", started.runId, "result.json"], {
      cwd: rootDir,
      stdout: (message) => continueOutput.push(message),
      stderr: (message) => continueOutput.push(message),
    });
    const blocked = JSON.parse(continueOutput[0] ?? "{}") as { status: string };

    expect(continueCode).toBe(0);
    expect(blocked.status).toBe("blocked");

    const cancelOutput: string[] = [];
    const cancelCode = await main(["cancel", started.runId, "用户停止"], {
      cwd: rootDir,
      stdout: (message) => cancelOutput.push(message),
      stderr: (message) => cancelOutput.push(message),
    });
    const cancelled = JSON.parse(cancelOutput[0] ?? "{}") as { status: string };

    expect(cancelCode).toBe(0);
    expect(cancelled.status).toBe("cancelled");
  });
});
