import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import { compileWorkflow, validateWorkflowData } from "../src/workflow/compiler.js";

describe("validateWorkflowData", () => {
  test("使用外部 JSON Schema 校验 Workflow 输入和输出", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "harness-next-data-"));
    const workflowPath = join(rootDir, "harness/workflows/example/workflow.yaml");

    await mkdir(join(rootDir, "harness/workflows/example"), { recursive: true });
    await mkdir(join(rootDir, "harness/models"), { recursive: true });
    await mkdir(join(rootDir, "harness/checks/done"), { recursive: true });
    await mkdir(join(rootDir, "skills/run-example"), { recursive: true });
    await writeFile(join(rootDir, "harness/checks/done/CHECK.md"), "# 完成检查\n");
    await writeFile(join(rootDir, "skills/run-example/SKILL.md"), "# 执行示例\n");
    await writeFile(
      join(rootDir, "harness/models/request.schema.json"),
      JSON.stringify({
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
        required: ["title"],
        properties: { title: { type: "string", minLength: 1 } },
        additionalProperties: false,
      }),
    );
    await writeFile(
      join(rootDir, "harness/models/result.schema.json"),
      JSON.stringify({
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
        required: ["status"],
        properties: { status: { const: "done" } },
        additionalProperties: false,
      }),
    );
    await writeFile(
      workflowPath,
      `document:
  dsl: "1.0.3"
  namespace: harness-next
  name: data-validation
  version: "0.1.0"
input:
  schema:
    resource:
      endpoint: harness://models/request.schema.json
output:
  schema:
    resource:
      endpoint: harness://models/result.schema.json
do:
  - run-example:
      call: run-example
      metadata:
        harness:
          checks: [done]
      then: end
`,
    );

    const compiled = await compileWorkflow({ rootDir, workflowPath });
    expect(compiled.workflow).not.toBeNull();
    if (compiled.workflow === null) {
      throw new Error("测试 Workflow 编译失败");
    }

    const validInput = await validateWorkflowData({
      rootDir,
      workflow: compiled.workflow,
      target: "input",
      data: { title: "实现 Workflow" },
    });
    const invalidInput = await validateWorkflowData({
      rootDir,
      workflow: compiled.workflow,
      target: "input",
      data: {},
    });
    const invalidOutput = await validateWorkflowData({
      rootDir,
      workflow: compiled.workflow,
      target: "output",
      data: { status: "pending" },
    });

    expect(validInput).toEqual([]);
    expect(invalidInput.map((diagnostic) => diagnostic.code)).toEqual(["data.schema-invalid"]);
    expect(invalidOutput.map((diagnostic) => diagnostic.code)).toEqual(["data.schema-invalid"]);
  });
});
