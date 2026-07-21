import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import { detectPackageManager } from "../src/node-project/package-manager.js";

async function createProject(): Promise<string> {
  return mkdtemp(join(tmpdir(), "harness-package-manager-"));
}

async function writePackageJson(
  rootDir: string,
  packageManager?: string,
): Promise<void> {
  await writeFile(
    join(rootDir, "package.json"),
    `${JSON.stringify({ name: "example", ...(packageManager ? { packageManager } : {}) }, null, 2)}\n`,
  );
}

describe("detectPackageManager", () => {
  test("空目录按新项目处理并默认使用 npm", async () => {
    const rootDir = await createProject();

    const result = await detectPackageManager(rootDir);

    expect(result).toEqual({
      projectState: "new",
      status: "defaulted",
      manager: "npm",
      evidence: ["项目根目录不存在 package.json，按新项目默认使用 npm。"],
      conflicts: [],
    });
  });

  test.each([
    ["npm", "npm@10.8.2", "package-lock.json"],
    ["yarn", "yarn@1.22.22", "yarn.lock"],
    ["pnpm", "pnpm@10.13.1", "pnpm-lock.yaml"],
  ] as const)(
    "通过 packageManager 和根 Lockfile 确认 %s",
    async (manager, declaration, lockfile) => {
      const rootDir = await createProject();
      await writePackageJson(rootDir, declaration);
      await writeFile(join(rootDir, lockfile), "lock\n");

      const result = await detectPackageManager(rootDir);

      expect(result).toMatchObject({
        projectState: "existing",
        status: "confirmed",
        manager,
        version: declaration.split("@")[1],
        evidence: [
          `package.json#packageManager 声明 ${declaration}。`,
          `项目根目录存在 ${lockfile}。`,
        ],
        conflicts: [],
      });
    },
  );

  test("没有 packageManager 时根据唯一根 Lockfile 判断", async () => {
    const rootDir = await createProject();
    await writePackageJson(rootDir);
    await writeFile(join(rootDir, "yarn.lock"), "lock\n");

    const result = await detectPackageManager(rootDir);

    expect(result).toEqual({
      projectState: "existing",
      status: "inferred",
      manager: "yarn",
      evidence: ["项目根目录存在 yarn.lock。"],
      conflicts: [],
    });
  });

  test("忽略 node_modules 中的 package-lock.json", async () => {
    const rootDir = await createProject();
    await writePackageJson(rootDir, "yarn@1.22.22");
    await writeFile(join(rootDir, "yarn.lock"), "lock\n");
    await mkdir(join(rootDir, "node_modules"));
    await writeFile(join(rootDir, "node_modules/package-lock.json"), "{}\n");

    const result = await detectPackageManager(rootDir);

    expect(result.status).toBe("confirmed");
    expect(result.manager).toBe("yarn");
    expect(result.conflicts).toEqual([]);
  });

  test("已有项目没有包管理器证据时返回 unknown", async () => {
    const rootDir = await createProject();
    await writePackageJson(rootDir);

    const result = await detectPackageManager(rootDir);

    expect(result).toEqual({
      projectState: "existing",
      status: "unknown",
      evidence: [],
      conflicts: ["已有项目没有 packageManager 声明或根 Lockfile，无法确定包管理器。"],
    });
  });

  test("多个根 Lockfile 返回 conflict", async () => {
    const rootDir = await createProject();
    await writePackageJson(rootDir);
    await writeFile(join(rootDir, "package-lock.json"), "{}\n");
    await writeFile(join(rootDir, "yarn.lock"), "lock\n");

    const result = await detectPackageManager(rootDir);

    expect(result.status).toBe("conflict");
    expect(result.conflicts).toContain(
      "项目根目录同时存在多个 Lockfile：package-lock.json、yarn.lock。",
    );
  });

  test("packageManager 与 Lockfile 不一致时返回 conflict", async () => {
    const rootDir = await createProject();
    await writePackageJson(rootDir, "yarn@1.22.22");
    await writeFile(join(rootDir, "package-lock.json"), "{}\n");

    const result = await detectPackageManager(rootDir);

    expect(result.status).toBe("conflict");
    expect(result.conflicts).toContain(
      "package.json#packageManager 使用 yarn，但根 Lockfile 指向 npm。",
    );
  });

  test("非法 packageManager 声明返回 conflict", async () => {
    const rootDir = await createProject();
    await writePackageJson(rootDir, "bun@1.2.0");

    const result = await detectPackageManager(rootDir);

    expect(result.status).toBe("conflict");
    expect(result.conflicts).toEqual([
      "package.json#packageManager 无效：仅支持 npm、yarn 或 pnpm，并且必须包含版本。",
    ]);
  });
});
