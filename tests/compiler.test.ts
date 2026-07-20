import { mkdtemp, mkdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import { compileWorkflow } from "../src/workflow/compiler.js";

async function createValidProject(): Promise<{ rootDir: string; workflowPath: string }> {
  const rootDir = await mkdtemp(join(tmpdir(), "harness-next-"));
  const workflowPath = join(rootDir, "harness/workflows/feature-development/workflow.yaml");

  await mkdir(join(rootDir, "harness/workflows/feature-development"), { recursive: true });
  await mkdir(join(rootDir, "harness/checks/requirement-complete"), { recursive: true });
  await mkdir(join(rootDir, "skills/clarify-requirement"), { recursive: true });
  await writeFile(join(rootDir, "harness/checks/requirement-complete/CHECK.md"), "# 验收\n");
  await writeFile(join(rootDir, "skills/clarify-requirement/SKILL.md"), "# 澄清需求\n");
  await writeFile(
    workflowPath,
    `document:
  dsl: "1.0.3"
  namespace: harness-next
  name: feature-development
  version: "0.1.0"
do:
  - clarify-requirement:
      call: clarify-requirement
      metadata:
        harness:
          checks:
            - requirement-complete
      then: end
`,
  );

  return { rootDir, workflowPath };
}

describe("compileWorkflow", () => {
  test("读取标准 Workflow 并生成 Mermaid", async () => {
    const project = await createValidProject();

    const result = await compileWorkflow(project);

    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([]);
    expect(result.mermaid).toContain("clarify-requirement");
  });

  test("报告不存在的 Skill 和 Check", async () => {
    const project = await createValidProject();
    await unlink(join(project.rootDir, "skills/clarify-requirement/SKILL.md"));
    await unlink(join(project.rootDir, "harness/checks/requirement-complete/CHECK.md"));

    const result = await compileWorkflow(project);

    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "skill.not-found",
      "check.not-found",
    ]);
  });

  test("报告从起点无法到达的 Step", async () => {
    const project = await createValidProject();
    await writeFile(
      project.workflowPath,
      `document:
  dsl: "1.0.3"
  namespace: harness-next
  name: unreachable-step
  version: "0.1.0"
do:
  - start:
      call: clarify-requirement
      metadata:
        harness:
          checks: [requirement-complete]
      then: end
  - never-runs:
      call: clarify-requirement
      metadata:
        harness:
          checks: [requirement-complete]
`,
    );

    const result = await compileWorkflow(project);

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual({
      code: "workflow.unreachable-step",
      message: "Step 'never-runs' 无法从 Workflow 起点到达。",
    });
  });

  test("报告无法到达结束节点的 Cycle", async () => {
    const project = await createValidProject();
    await writeFile(
      project.workflowPath,
      `document:
  dsl: "1.0.3"
  namespace: harness-next
  name: no-terminal-path
  version: "0.1.0"
do:
  - revise:
      call: clarify-requirement
      metadata:
        harness:
          checks: [requirement-complete]
      then: review
  - review:
      call: clarify-requirement
      metadata:
        harness:
          checks: [requirement-complete]
      then: revise
`,
    );

    const result = await compileWorkflow(project);

    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "workflow.no-terminal-path",
    );
  });

  test("本地 Skill Step 必须绑定至少一个 Check", async () => {
    const project = await createValidProject();
    await writeFile(
      project.workflowPath,
      `document:
  dsl: "1.0.3"
  namespace: harness-next
  name: missing-check
  version: "0.1.0"
do:
  - clarify-requirement:
      call: clarify-requirement
      then: end
`,
    );

    const result = await compileWorkflow(project);

    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain("check.required");
  });

  test("拒绝远程调用 Task", async () => {
    const project = await createValidProject();
    await writeFile(
      project.workflowPath,
      `document:
  dsl: "1.0.3"
  namespace: harness-next
  name: remote-call
  version: "0.1.0"
do:
  - fetch-remote:
      call: http
      with:
        method: get
        endpoint: https://example.com
      then: end
`,
    );

    const result = await compileWorkflow(project);

    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain("task.unsupported");
  });

  test("允许带退出路径的分支和回改 Cycle", async () => {
    const project = await createValidProject();
    await writeFile(
      project.workflowPath,
      `document:
  dsl: "1.0.3"
  namespace: harness-next
  name: review-cycle
  version: "0.1.0"
do:
  - prepare:
      call: clarify-requirement
      metadata:
        harness:
          checks: [requirement-complete]
  - decide:
      switch:
        - passed:
            when: .status == "passed"
            then: finish
        - needs-changes:
            then: revise
  - revise:
      call: clarify-requirement
      metadata:
        harness:
          checks: [requirement-complete]
      then: decide
  - finish:
      call: clarify-requirement
      metadata:
        harness:
          checks: [requirement-complete]
      then: end
`,
    );

    const result = await compileWorkflow(project);

    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([]);
  });

  test("拒绝定时调度配置", async () => {
    const project = await createValidProject();
    await writeFile(
      project.workflowPath,
      `document:
  dsl: "1.0.3"
  namespace: harness-next
  name: scheduled-workflow
  version: "0.1.0"
schedule:
  cron: 0 0 * * *
do:
  - run:
      call: clarify-requirement
      metadata:
        harness:
          checks: [requirement-complete]
      then: end
`,
    );

    const result = await compileWorkflow(project);

    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "workflow.unsupported-feature",
    );
  });

  test("拒绝首版没有执行语义的 Task 类型", async () => {
    const project = await createValidProject();
    await writeFile(
      project.workflowPath,
      `document:
  dsl: "1.0.3"
  namespace: harness-next
  name: unsupported-task
  version: "0.1.0"
do:
  - assign-value:
      set:
        status: ready
      then: end
`,
    );

    const result = await compileWorkflow(project);

    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain("task.unsupported");
  });
});
