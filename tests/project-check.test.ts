import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import {
  checkNodeProject,
  type ProjectCommand,
  type ProjectCommandRunner,
} from "../src/node-project/project-check.js";
import type { SupportedPackageManager } from "../src/node-project/package-manager.js";

const MANAGER_VERSIONS: Record<SupportedPackageManager, string> = {
  npm: "10.8.2",
  yarn: "1.22.22",
  pnpm: "10.13.1",
};

const LOCKFILES: Record<SupportedPackageManager, string> = {
  npm: "package-lock.json",
  yarn: "yarn.lock",
  pnpm: "pnpm-lock.yaml",
};

async function createRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "harness-project-check-"));
}

async function createConfiguredProject(
  manager: SupportedPackageManager,
): Promise<string> {
  const rootDir = await createRoot();
  await mkdir(join(rootDir, ".github/workflows"), { recursive: true });
  await writeFile(
    join(rootDir, "package.json"),
    `${JSON.stringify(
      {
        name: "example",
        packageManager: `${manager}@${MANAGER_VERSIONS[manager]}`,
        engines: { node: ">=22.0.0 <23" },
        scripts: {
          typecheck: "tsc --noEmit",
          lint: "eslint .",
          test: "vitest run",
          build: "tsc -p tsconfig.build.json",
          "check:all": "run all checks",
        },
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(join(rootDir, LOCKFILES[manager]), "lock\n");
  await writeFile(
    join(rootDir, "tsconfig.json"),
    `${JSON.stringify({ compilerOptions: { strict: true } }, null, 2)}\n`,
  );
  await writeFile(join(rootDir, "eslint.config.js"), "export default [];\n");
  await writeFile(join(rootDir, "README.md"), "# Example\n");
  await writeFile(join(rootDir, ".gitignore"), "node_modules\n");
  await writeFile(join(rootDir, ".nvmrc"), "22\n");
  await writeFile(
    join(rootDir, ".github/workflows/ci.yml"),
    "jobs:\n  check:\n    steps:\n      - uses: actions/setup-node@v4\n        with:\n          node-version: 22\n",
  );
  return rootDir;
}

function recordingRunner(
  commands: ProjectCommand[],
  exitCodeFor: (command: ProjectCommand) => number = () => 0,
): ProjectCommandRunner {
  return (command) => {
    commands.push(command);
    return Promise.resolve({ exitCode: exitCodeFor(command), durationMs: 1 });
  };
}

describe("checkNodeProject", () => {
  test("报告新目录缺失的工程基线", async () => {
    const rootDir = await createRoot();

    const result = await checkNodeProject({
      rootDir,
      runCommand: recordingRunner([]),
    });

    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual([
      "package-json.missing",
      "lockfile.missing",
      "typescript.config-missing",
      "eslint.config-missing",
      "project.readme-missing",
      "project.gitignore-missing",
      "ci.config-missing",
      "node-version.engines-missing",
      "node-version.nvmrc-missing",
    ]);
    expect(result.executions).toEqual([]);
  });

  test("报告缺失的标准 scripts", async () => {
    const rootDir = await createConfiguredProject("npm");
    await writeFile(
      join(rootDir, "package.json"),
      `${JSON.stringify(
        {
          name: "example",
          packageManager: "npm@10.8.2",
          engines: { node: ">=22.0.0 <23" },
          scripts: { test: "vitest run" },
        },
        null,
        2,
      )}\n`,
    );

    const result = await checkNodeProject({
      rootDir,
      runCommand: recordingRunner([]),
    });

    expect(result.issues).toEqual([
      { code: "script.missing", message: "package.json 缺少 script：typecheck。" },
      { code: "script.missing", message: "package.json 缺少 script：lint。" },
      { code: "script.missing", message: "package.json 缺少 script：build。" },
      { code: "script.missing", message: "package.json 缺少 script：check:all。" },
    ]);
  });

  test("要求 TypeScript 开启 strict", async () => {
    const rootDir = await createConfiguredProject("npm");
    await writeFile(
      join(rootDir, "tsconfig.json"),
      `${JSON.stringify({ compilerOptions: { strict: false } }, null, 2)}\n`,
    );

    const result = await checkNodeProject({
      rootDir,
      runCommand: recordingRunner([]),
    });

    expect(result.issues).toContainEqual({
      code: "typescript.strict-disabled",
      message: "TypeScript 最终配置必须启用 strict。",
    });
  });

  test("报告可识别的 Node.js Major 冲突", async () => {
    const rootDir = await createConfiguredProject("npm");
    await writeFile(join(rootDir, ".nvmrc"), "24\n");
    await writeFile(join(rootDir, "Dockerfile"), "FROM node:24-bookworm-slim\n");

    const result = await checkNodeProject({
      rootDir,
      runCommand: recordingRunner([]),
    });

    expect(result.issues).toContainEqual({
      code: "node-version.conflict",
      message: "Node.js Major 不一致：.nvmrc=24，Dockerfile=24，CI=22。",
    });
  });

  test("允许固定 Node.js 版本高于 engines 最低版本", async () => {
    const rootDir = await createConfiguredProject("npm");
    const packageJson = JSON.parse(
      await readFile(join(rootDir, "package.json"), "utf8"),
    ) as { engines: { node: string } };
    packageJson.engines.node = ">=22";
    await writeFile(join(rootDir, "package.json"), `${JSON.stringify(packageJson, null, 2)}\n`);
    await writeFile(join(rootDir, ".nvmrc"), "24\n");
    await writeFile(
      join(rootDir, ".github/workflows/ci.yml"),
      "jobs:\n  check:\n    steps:\n      - uses: actions/setup-node@v4\n        with:\n          node-version: 24\n",
    );

    const result = await checkNodeProject({
      rootDir,
      runCommand: recordingRunner([]),
    });

    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });

  test("固定 Node.js 版本不满足 engines 时失败", async () => {
    const rootDir = await createConfiguredProject("npm");
    const packageJson = JSON.parse(
      await readFile(join(rootDir, "package.json"), "utf8"),
    ) as { engines: { node: string } };
    packageJson.engines.node = ">=24";
    await writeFile(join(rootDir, "package.json"), `${JSON.stringify(packageJson, null, 2)}\n`);

    const result = await checkNodeProject({
      rootDir,
      runCommand: recordingRunner([]),
    });

    expect(result.issues).toContainEqual({
      code: "node-version.engine-mismatch",
      message: "固定 Node.js 版本 22 不满足 package.json#engines.node：>=24。",
    });
  });

  test.each([
    ["npm", "npm", ["run", "typecheck"]],
    ["yarn", "yarn", ["typecheck"]],
    ["pnpm", "pnpm", ["run", "typecheck"]],
  ] as const)("使用 %s 执行标准 scripts", async (manager, command, firstArgs) => {
    const rootDir = await createConfiguredProject(manager);
    const commands: ProjectCommand[] = [];

    const result = await checkNodeProject({
      rootDir,
      runCommand: recordingRunner(commands),
    });

    expect(result.ok).toBe(true);
    expect(commands[0]).toEqual({ command, args: firstArgs });
    expect(result.executions.map((execution) => execution.script)).toEqual([
      "typecheck",
      "lint",
      "test",
      "build",
    ]);
  });

  test("命令失败后停止后续 scripts 并返回问题", async () => {
    const rootDir = await createConfiguredProject("npm");
    const commands: ProjectCommand[] = [];

    const result = await checkNodeProject({
      rootDir,
      runCommand: recordingRunner(commands, (command) =>
        command.args.includes("lint") ? 2 : 0,
      ),
    });

    expect(commands).toEqual([
      { command: "npm", args: ["run", "typecheck"] },
      { command: "npm", args: ["run", "lint"] },
    ]);
    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual({
      code: "script.failed",
      message: "script 'lint' 执行失败，退出码 2。",
    });
  });
});
