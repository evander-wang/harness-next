import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import { syncWorkflowCatalog } from "../src/workflow/catalog.js";

async function writeWorkflow(
  rootDir: string,
  directory: string,
  options: {
    name: string;
    title: string;
    aliases?: string[];
    when?: string[];
    notWhen?: string[];
  },
): Promise<void> {
  const workflowDirectory = join(rootDir, "harness/workflows", directory);
  await mkdir(workflowDirectory, { recursive: true });
  await mkdir(join(rootDir, "skills/run-example"), { recursive: true });
  await writeFile(join(rootDir, "skills/run-example/SKILL.md"), "# 执行\n");
  await writeFile(
    join(workflowDirectory, "workflow.yaml"),
    `document:
  dsl: "1.0.3"
  namespace: harness-next
  name: ${options.name}
  version: "0.1.0"
  title: ${options.title}
  summary: ${options.title}流程。
  metadata:
    harness:
      routing:
        aliases: ${JSON.stringify(options.aliases ?? [])}
        when: ${JSON.stringify(options.when ?? [])}
        notWhen: ${JSON.stringify(options.notWhen ?? [])}
do:
  - run-example:
      call: run-example
      then: end
`,
  );
}

describe("syncWorkflowCatalog", () => {
  test("扫描 Workflow 并生成稳定排序的 Catalog", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "harness-catalog-"));
    await writeWorkflow(rootDir, "second", {
      name: "second-workflow",
      title: "第二流程",
      aliases: ["second"],
      when: ["执行第二类任务"],
    });
    await writeWorkflow(rootDir, "first", {
      name: "first-workflow",
      title: "第一流程",
      aliases: ["first"],
      when: ["执行第一类任务"],
      notWhen: ["只读分析"],
    });

    const result = await syncWorkflowCatalog({ rootDir });
    const catalogPath = join(rootDir, "harness/generated/workflow-catalog.json");
    const persisted = JSON.parse(await readFile(catalogPath, "utf8")) as unknown;

    expect(result.changed).toBe(true);
    expect(result.catalog.workflows.map((workflow) => workflow.name)).toEqual([
      "first-workflow",
      "second-workflow",
    ]);
    expect(result.catalog.workflows[0]).toMatchObject({
      name: "first-workflow",
      path: "harness/workflows/first/workflow.yaml",
      title: "第一流程",
      routing: {
        aliases: ["first"],
        when: ["执行第一类任务"],
        notWhen: ["只读分析"],
      },
    });
    expect(result.catalog.workflows[0]?.sourceHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(persisted).toEqual(result.catalog);
  });

  test("拒绝重复的 Workflow 名称和 Alias", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "harness-catalog-"));
    await writeWorkflow(rootDir, "one", {
      name: "workflow-one",
      title: "流程一",
      aliases: ["shared"],
    });
    await writeWorkflow(rootDir, "two", {
      name: "workflow-two",
      title: "流程二",
      aliases: ["shared"],
    });

    await expect(syncWorkflowCatalog({ rootDir })).rejects.toThrow(
      "Workflow 路由名称或 Alias 重复：shared",
    );
  });

  test("check 模式在 Catalog 过期时失败且不写文件", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "harness-catalog-"));
    await writeWorkflow(rootDir, "example", {
      name: "example-workflow",
      title: "示例流程",
    });
    const catalogPath = join(rootDir, "harness/generated/workflow-catalog.json");

    await expect(syncWorkflowCatalog({ rootDir, check: true })).rejects.toThrow(
      "Workflow Catalog 已过期",
    );
    await expect(readFile(catalogPath, "utf8")).rejects.toThrow();
  });
});
