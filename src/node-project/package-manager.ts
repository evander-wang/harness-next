import { access, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export type SupportedPackageManager = "npm" | "yarn" | "pnpm";
export type NodeProjectState = "new" | "existing";
export type PackageManagerDetectionStatus =
  | "defaulted"
  | "confirmed"
  | "inferred"
  | "unknown"
  | "conflict";

export type PackageManagerDetection = {
  projectState: NodeProjectState;
  status: PackageManagerDetectionStatus;
  manager?: SupportedPackageManager;
  version?: string;
  evidence: string[];
  conflicts: string[];
};

type PackageManagerDeclaration = {
  manager: SupportedPackageManager;
  version: string;
};

const LOCKFILES = [
  { name: "package-lock.json", manager: "npm" },
  { name: "npm-shrinkwrap.json", manager: "npm" },
  { name: "yarn.lock", manager: "yarn" },
  { name: "pnpm-lock.yaml", manager: "pnpm" },
] as const satisfies ReadonlyArray<{ name: string; manager: SupportedPackageManager }>;

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function parseDeclaration(value: unknown): PackageManagerDeclaration | null {
  if (typeof value !== "string") {
    return null;
  }
  const match = /^(npm|yarn|pnpm)@(.+)$/u.exec(value.trim());
  if (!match) {
    return null;
  }
  const manager = match[1];
  const version = match[2];
  if (manager === undefined || version === undefined || version.length === 0) {
    return null;
  }
  return { manager: manager as SupportedPackageManager, version };
}

async function readPackageManagerDeclaration(
  packageJsonPath: string,
): Promise<{ declaration?: PackageManagerDeclaration; invalid: boolean }> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(packageJsonPath, "utf8")) as unknown;
  } catch {
    return { invalid: true };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { invalid: true };
  }
  const value = (parsed as Record<string, unknown>).packageManager;
  if (value === undefined) {
    return { invalid: false };
  }
  const declaration = parseDeclaration(value);
  return declaration === null ? { invalid: true } : { declaration, invalid: false };
}

export async function detectPackageManager(rootDir: string): Promise<PackageManagerDetection> {
  const resolvedRoot = resolve(rootDir);
  const packageJsonPath = join(resolvedRoot, "package.json");
  if (!(await exists(packageJsonPath))) {
    return {
      projectState: "new",
      status: "defaulted",
      manager: "npm",
      evidence: ["项目根目录不存在 package.json，按新项目默认使用 npm。"],
      conflicts: [],
    };
  }

  const { declaration, invalid } = await readPackageManagerDeclaration(packageJsonPath);
  if (invalid) {
    return {
      projectState: "existing",
      status: "conflict",
      evidence: [],
      conflicts: [
        "package.json#packageManager 无效：仅支持 npm、yarn 或 pnpm，并且必须包含版本。",
      ],
    };
  }

  const foundLockfiles = [];
  for (const lockfile of LOCKFILES) {
    if (await exists(join(resolvedRoot, lockfile.name))) {
      foundLockfiles.push(lockfile);
    }
  }

  const evidence = declaration
    ? [`package.json#packageManager 声明 ${declaration.manager}@${declaration.version}。`]
    : [];
  evidence.push(...foundLockfiles.map((lockfile) => `项目根目录存在 ${lockfile.name}。`));

  if (foundLockfiles.length > 1) {
    return {
      projectState: "existing",
      status: "conflict",
      evidence,
      conflicts: [
        `项目根目录同时存在多个 Lockfile：${foundLockfiles.map((lockfile) => lockfile.name).join("、")}。`,
      ],
    };
  }

  const lockfile = foundLockfiles[0];
  if (declaration && lockfile && declaration.manager !== lockfile.manager) {
    return {
      projectState: "existing",
      status: "conflict",
      evidence,
      conflicts: [
        `package.json#packageManager 使用 ${declaration.manager}，但根 Lockfile 指向 ${lockfile.manager}。`,
      ],
    };
  }

  if (declaration) {
    return {
      projectState: "existing",
      status: lockfile ? "confirmed" : "inferred",
      manager: declaration.manager,
      version: declaration.version,
      evidence,
      conflicts: [],
    };
  }
  if (lockfile) {
    return {
      projectState: "existing",
      status: "inferred",
      manager: lockfile.manager,
      evidence,
      conflicts: [],
    };
  }
  return {
    projectState: "existing",
    status: "unknown",
    evidence: [],
    conflicts: ["已有项目没有 packageManager 声明或根 Lockfile，无法确定包管理器。"],
  };
}
