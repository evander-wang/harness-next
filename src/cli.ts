#!/usr/bin/env node

import { access, mkdir, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

import { compileWorkflow } from "./workflow/compiler.js";
import { renderWorkflowSvg } from "./workflow/svg-renderer.js";

export type CliIo = {
  cwd: string;
  stdout: (message: string) => void;
  stderr: (message: string) => void;
};

const REQUIRED_PATHS = [
  "AGENTS.md",
  "README.md",
  "keywords.md",
  "CONTRIBUTING.md",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "harness/schemas",
  "harness/models",
  "harness/checks",
  "harness/workflows",
  "skills",
];

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function printUsage(io: CliIo): void {
  io.stderr("用法：harness-next <doctor|validate|diagram|image> [workflow.yaml] [output.svg]");
}

async function doctor(io: CliIo): Promise<number> {
  const missing: string[] = [];
  for (const path of REQUIRED_PATHS) {
    if (!(await exists(resolve(io.cwd, path)))) {
      missing.push(path);
    }
  }

  if (missing.length === 0) {
    io.stdout("仓库结构：通过");
    return 0;
  }

  io.stderr("仓库结构：未通过");
  for (const path of missing) {
    io.stderr(`- 缺失：${path}`);
  }
  return 1;
}

async function compileCommand(command: "validate" | "diagram", path: string, io: CliIo): Promise<number> {
  const result = await compileWorkflow({
    rootDir: io.cwd,
    workflowPath: resolve(io.cwd, path),
  });

  if (!result.ok) {
    for (const diagnostic of result.diagnostics) {
      io.stderr(`[${diagnostic.code}] ${diagnostic.message}`);
    }
    return 1;
  }

  if (command === "validate") {
    io.stdout("Workflow：通过");
  } else if (result.mermaid !== null) {
    io.stdout(result.mermaid);
  }
  return 0;
}

function isInsideWorkspace(rootDir: string, path: string): boolean {
  return path === rootDir || path.startsWith(`${rootDir}${sep}`);
}

async function imageCommand(
  workflowPath: string,
  requestedOutputPath: string | undefined,
  io: CliIo,
): Promise<number> {
  const result = await compileWorkflow({
    rootDir: io.cwd,
    workflowPath: resolve(io.cwd, workflowPath),
  });
  if (!result.ok || result.graph === null || result.workflow === null) {
    for (const diagnostic of result.diagnostics) {
      io.stderr(`[${diagnostic.code}] ${diagnostic.message}`);
    }
    return 1;
  }

  const workflowName = result.workflow.document.name;
  const title = result.workflow.document.title ?? workflowName;
  const rootDir = resolve(io.cwd);
  const outputPath = resolve(
    rootDir,
    requestedOutputPath ?? `harness/generated/${workflowName}.svg`,
  );
  if (!isInsideWorkspace(rootDir, outputPath)) {
    io.stderr("图片输出路径必须位于当前工作区内。");
    return 2;
  }

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, renderWorkflowSvg(result.graph, title), "utf8");
  io.stdout(`图片已生成：${relative(rootDir, outputPath)}`);
  return 0;
}

export async function main(argv: string[], io: CliIo): Promise<number> {
  const [command, workflowPath, outputPath] = argv;

  if (command === "doctor") {
    return doctor(io);
  }
  if (command === "validate" || command === "diagram") {
    if (workflowPath === undefined) {
      printUsage(io);
      return 2;
    }
    return compileCommand(command, workflowPath, io);
  }
  if (command === "image") {
    if (workflowPath === undefined) {
      printUsage(io);
      return 2;
    }
    return imageCommand(workflowPath, outputPath, io);
  }

  printUsage(io);
  return 2;
}

const entryPath = process.argv[1];
if (entryPath !== undefined && import.meta.url === pathToFileURL(entryPath).href) {
  const code = await main(process.argv.slice(2), {
    cwd: process.cwd(),
    stdout: console.log,
    stderr: console.error,
  });
  process.exitCode = code;
}
