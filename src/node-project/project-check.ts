import { spawn } from "node:child_process";
import { access, readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

import { coerce, satisfies, validRange } from "semver";
import ts from "typescript";

import {
  detectPackageManager,
  type PackageManagerDetection,
  type SupportedPackageManager,
} from "./package-manager.js";

export type ProjectCommand = {
  command: string;
  args: string[];
};

export type ProjectCommandResult = {
  exitCode: number;
  durationMs: number;
};

export type ProjectCommandRunner = (
  command: ProjectCommand,
  rootDir: string,
) => Promise<ProjectCommandResult>;

export type ProjectCheckIssue = {
  code: string;
  message: string;
};

export type ProjectScriptExecution = ProjectCommand & ProjectCommandResult & {
  script: string;
};

export type ProjectCheckResult = {
  ok: boolean;
  packageManager: PackageManagerDetection;
  issues: ProjectCheckIssue[];
  executions: ProjectScriptExecution[];
};

export type CheckNodeProjectOptions = {
  rootDir: string;
  runCommand?: ProjectCommandRunner;
};

const REQUIRED_SCRIPTS = ["typecheck", "lint", "test", "build", "check:all"] as const;
const EXECUTED_SCRIPTS = ["typecheck", "lint", "test", "build"] as const;
const ESLINT_CONFIGS = [
  "eslint.config.js",
  "eslint.config.mjs",
  "eslint.config.cjs",
  "eslint.config.ts",
  "eslint.config.mts",
  "eslint.config.cts",
  ".eslintrc",
  ".eslintrc.json",
  ".eslintrc.js",
  ".eslintrc.cjs",
] as const;
const README_FILES = ["README.md", "README", "README.txt", "readme.md"] as const;
const LOCKFILES = ["package-lock.json", "npm-shrinkwrap.json", "yarn.lock", "pnpm-lock.yaml"] as const;

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function hasAnyFile(rootDir: string, names: readonly string[]): Promise<boolean> {
  for (const name of names) {
    if (await exists(join(rootDir, name))) {
      return true;
    }
  }
  return false;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

async function readPackageJson(rootDir: string): Promise<Record<string, unknown> | null> {
  try {
    return asRecord(JSON.parse(await readFile(join(rootDir, "package.json"), "utf8")) as unknown);
  } catch {
    return null;
  }
}

async function hasCiWorkflow(rootDir: string): Promise<boolean> {
  try {
    const entries = await readdir(join(rootDir, ".github/workflows"), { withFileTypes: true });
    return entries.some(
      (entry) => entry.isFile() && /\.ya?ml$/u.test(entry.name),
    );
  } catch {
    return false;
  }
}

async function readCiSources(rootDir: string): Promise<string[]> {
  const directory = join(rootDir, ".github/workflows");
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    const sources: string[] = [];
    for (const entry of entries) {
      if (entry.isFile() && /\.ya?ml$/u.test(entry.name)) {
        sources.push(await readFile(join(directory, entry.name), "utf8"));
      }
    }
    return sources;
  } catch {
    return [];
  }
}

function extractMajor(value: string): number | null {
  const match = /(?:^|[^0-9])([0-9]{1,3})(?:\.|[^0-9]|$)/u.exec(value);
  const major = match?.[1];
  return major === undefined ? null : Number.parseInt(major, 10);
}

async function collectFixedNodeMajors(
  rootDir: string,
): Promise<Array<{ source: string; major: number }>> {
  const versions: Array<{ source: string; major: number }> = [];
  const nvmrcPath = join(rootDir, ".nvmrc");
  if (await exists(nvmrcPath)) {
    const major = extractMajor(await readFile(nvmrcPath, "utf8"));
    if (major !== null) versions.push({ source: ".nvmrc", major });
  }

  const dockerfilePath = join(rootDir, "Dockerfile");
  if (await exists(dockerfilePath)) {
    const match = /^\s*FROM\s+node:([0-9]+)/imu.exec(await readFile(dockerfilePath, "utf8"));
    if (match?.[1] !== undefined) {
      versions.push({ source: "Dockerfile", major: Number.parseInt(match[1], 10) });
    }
  }

  for (const source of await readCiSources(rootDir)) {
    const match = /node-version\s*:\s*["']?([0-9]+)/iu.exec(source);
    if (match?.[1] !== undefined) {
      versions.push({ source: "CI", major: Number.parseInt(match[1], 10) });
      break;
    }
  }
  return versions;
}

async function nodeEngineIssues(
  rootDir: string,
  packageJson: Record<string, unknown> | null,
): Promise<ProjectCheckIssue[]> {
  const engines = asRecord(packageJson?.engines);
  const range = engines?.node;
  if (typeof range !== "string" || range.trim().length === 0) {
    return [];
  }
  if (validRange(range) === null) {
    return [{
      code: "node-version.engines-invalid",
      message: `package.json#engines.node 不是有效的 SemVer 范围：${range}。`,
    }];
  }
  const nvmrcPath = join(rootDir, ".nvmrc");
  if (!(await exists(nvmrcPath))) {
    return [];
  }
  const fixedVersion = coerce((await readFile(nvmrcPath, "utf8")).trim());
  if (fixedVersion === null) {
    return [{ code: "node-version.nvmrc-invalid", message: ".nvmrc 不是有效的 Node.js 版本。" }];
  }
  return satisfies(fixedVersion, range)
    ? []
    : [{
        code: "node-version.engine-mismatch",
        message: `固定 Node.js 版本 ${String(fixedVersion.major)} 不满足 package.json#engines.node：${range}。`,
      }];
}

function managerCommand(manager: SupportedPackageManager, script: string): ProjectCommand {
  if (manager === "yarn") {
    return { command: "yarn", args: [script] };
  }
  return {
    command: manager,
    args: ["run", script],
  };
}

async function defaultCommandRunner(
  command: ProjectCommand,
  rootDir: string,
): Promise<ProjectCommandResult> {
  const startedAt = Date.now();
  const exitCode = await new Promise<number>((resolveExit) => {
    const child = spawn(command.command, command.args, {
      cwd: rootDir,
      env: process.env,
      shell: false,
      stdio: "inherit",
    });
    child.once("error", () => {
      resolveExit(127);
    });
    child.once("close", (code) => {
      resolveExit(code ?? 1);
    });
  });
  return { exitCode, durationMs: Date.now() - startedAt };
}

function scriptIssues(packageJson: Record<string, unknown> | null): ProjectCheckIssue[] {
  if (packageJson === null) {
    return [];
  }
  const scripts = asRecord(packageJson.scripts) ?? {};
  return REQUIRED_SCRIPTS.flatMap((script) =>
    typeof scripts[script] === "string" && scripts[script].length > 0
      ? []
      : [{ code: "script.missing", message: `package.json 缺少 script：${script}。` }],
  );
}

function nodeEngineMissing(packageJson: Record<string, unknown> | null): boolean {
  const engines = asRecord(packageJson?.engines);
  return typeof engines?.node !== "string" || engines.node.trim().length === 0;
}

function checkStrictTypeScript(tsconfigPath: string): ProjectCheckIssue[] {
  const readResult = ts.readConfigFile(tsconfigPath, (path) => ts.sys.readFile(path));
  if (readResult.error !== undefined) {
    return [{ code: "typescript.config-invalid", message: "tsconfig.json 无法解析。" }];
  }
  const parsed = ts.parseJsonConfigFileContent(
    readResult.config as object,
    ts.sys,
    resolve(tsconfigPath, ".."),
    undefined,
    tsconfigPath,
  );
  return parsed.options.strict === true
    ? []
    : [{ code: "typescript.strict-disabled", message: "TypeScript 最终配置必须启用 strict。" }];
}

async function collectStaticIssues(
  rootDir: string,
  detection: PackageManagerDetection,
): Promise<{ issues: ProjectCheckIssue[]; packageJson: Record<string, unknown> | null }> {
  const issues: ProjectCheckIssue[] = [];
  const packageJsonExists = await exists(join(rootDir, "package.json"));
  const packageJson = packageJsonExists ? await readPackageJson(rootDir) : null;
  if (!packageJsonExists) {
    issues.push({ code: "package-json.missing", message: "项目根目录缺少 package.json。" });
  } else if (packageJson === null) {
    issues.push({ code: "package-json.invalid", message: "package.json 不是有效的 JSON Object。" });
  }

  if (!(await hasAnyFile(rootDir, LOCKFILES))) {
    issues.push({ code: "lockfile.missing", message: "项目根目录缺少 Lockfile。" });
  }

  const tsconfigPath = join(rootDir, "tsconfig.json");
  if (!(await exists(tsconfigPath))) {
    issues.push({ code: "typescript.config-missing", message: "项目根目录缺少 tsconfig.json。" });
  } else {
    issues.push(...checkStrictTypeScript(tsconfigPath));
  }

  if (!(await hasAnyFile(rootDir, ESLINT_CONFIGS))) {
    issues.push({ code: "eslint.config-missing", message: "项目根目录缺少 ESLint 配置。" });
  }
  if (!(await hasAnyFile(rootDir, README_FILES))) {
    issues.push({ code: "project.readme-missing", message: "项目根目录缺少 README。" });
  }
  if (!(await exists(join(rootDir, ".gitignore")))) {
    issues.push({ code: "project.gitignore-missing", message: "项目根目录缺少 .gitignore。" });
  }
  if (!(await hasCiWorkflow(rootDir))) {
    issues.push({ code: "ci.config-missing", message: "项目缺少 .github/workflows 下的 CI 配置。" });
  }
  if (nodeEngineMissing(packageJson)) {
    issues.push({ code: "node-version.engines-missing", message: "package.json 缺少 engines.node。" });
  }
  if (!(await exists(join(rootDir, ".nvmrc")))) {
    issues.push({ code: "node-version.nvmrc-missing", message: "项目根目录缺少 .nvmrc。" });
  }

  if (detection.projectState === "existing" && detection.status === "unknown") {
    issues.push({ code: "package-manager.unknown", message: detection.conflicts.join("；") });
  } else if (detection.status === "conflict") {
    issues.push({ code: "package-manager.conflict", message: detection.conflicts.join("；") });
  } else if (detection.projectState === "existing" && detection.version === undefined) {
    issues.push({
      code: "package-manager.declaration-missing",
      message: "package.json 必须声明包含版本的 packageManager。",
    });
  }

  issues.push(...scriptIssues(packageJson));
  issues.push(...(await nodeEngineIssues(rootDir, packageJson)));

  const nodeMajors = await collectFixedNodeMajors(rootDir);
  if (new Set(nodeMajors.map((item) => item.major)).size > 1) {
    issues.push({
      code: "node-version.conflict",
      message: `Node.js Major 不一致：${nodeMajors.map((item) => `${item.source}=${String(item.major)}`).join("，")}。`,
    });
  }
  return { issues, packageJson };
}

export async function checkNodeProject(
  options: CheckNodeProjectOptions,
): Promise<ProjectCheckResult> {
  const rootDir = resolve(options.rootDir);
  const packageManager = await detectPackageManager(rootDir);
  const { issues } = await collectStaticIssues(rootDir, packageManager);
  const executions: ProjectScriptExecution[] = [];
  if (issues.length > 0 || packageManager.manager === undefined) {
    return { ok: false, packageManager, issues, executions };
  }

  const runCommand = options.runCommand ?? defaultCommandRunner;
  for (const script of EXECUTED_SCRIPTS) {
    const command = managerCommand(packageManager.manager, script);
    const execution = await runCommand(command, rootDir);
    executions.push({ script, ...command, ...execution });
    if (execution.exitCode !== 0) {
      issues.push({
        code: "script.failed",
        message: `script '${script}' 执行失败，退出码 ${String(execution.exitCode)}。`,
      });
      break;
    }
  }

  return { ok: issues.length === 0, packageManager, issues, executions };
}
