#!/usr/bin/env node

import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

import { compileWorkflow } from "./workflow/compiler.js";
import { syncWorkflowCatalog } from "./workflow/catalog.js";
import {
  cancelWorkflowRun,
  continueWorkflowRun,
  startWorkflowRun,
  type StepResult,
} from "./workflow/runtime.js";
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
  io.stderr(
    "用法：harness-next <doctor|validate|diagram|image|sync|start|continue|cancel> [...args]",
  );
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
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

async function syncCommand(check: boolean, io: CliIo): Promise<number> {
  try {
    const result = await syncWorkflowCatalog({ rootDir: io.cwd, check });
    io.stdout(
      check
        ? "Workflow Catalog：已是最新"
        : result.changed
          ? "Workflow Catalog：已同步"
          : "Workflow Catalog：无需更新",
    );
    return 0;
  } catch (error: unknown) {
    io.stderr(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

async function startCommand(
  workflowPath: string,
  executionKey: string,
  inputPath: string,
  io: CliIo,
): Promise<number> {
  try {
    const response = await startWorkflowRun({
      rootDir: io.cwd,
      workflowPath,
      executionKey,
      input: await readJson(resolve(io.cwd, inputPath)),
    });
    io.stdout(JSON.stringify(response));
    return 0;
  } catch (error: unknown) {
    io.stderr(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

async function continueCommand(
  runId: string,
  resultPath: string | undefined,
  io: CliIo,
): Promise<number> {
  try {
    const result =
      resultPath === undefined
        ? undefined
        : ((await readJson(resolve(io.cwd, resultPath))) as StepResult);
    const response = await continueWorkflowRun({
      rootDir: io.cwd,
      runId,
      ...(result === undefined ? {} : { result }),
    });
    io.stdout(JSON.stringify(response));
    return 0;
  } catch (error: unknown) {
    io.stderr(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

async function cancelCommand(runId: string, reason: string, io: CliIo): Promise<number> {
  try {
    const response = await cancelWorkflowRun({ rootDir: io.cwd, runId, reason });
    io.stdout(JSON.stringify(response));
    return 0;
  } catch (error: unknown) {
    io.stderr(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

export async function main(argv: string[], io: CliIo): Promise<number> {
  const [command, firstArgument, secondArgument, thirdArgument] = argv;

  if (command === "doctor") {
    return doctor(io);
  }
  if (command === "validate" || command === "diagram") {
    if (firstArgument === undefined) {
      printUsage(io);
      return 2;
    }
    return compileCommand(command, firstArgument, io);
  }
  if (command === "image") {
    if (firstArgument === undefined) {
      printUsage(io);
      return 2;
    }
    return imageCommand(firstArgument, secondArgument, io);
  }
  if (command === "sync") {
    return syncCommand(firstArgument === "--check", io);
  }
  if (command === "start") {
    if (firstArgument === undefined || secondArgument === undefined || thirdArgument === undefined) {
      printUsage(io);
      return 2;
    }
    return startCommand(firstArgument, secondArgument, thirdArgument, io);
  }
  if (command === "continue") {
    if (firstArgument === undefined) {
      printUsage(io);
      return 2;
    }
    return continueCommand(firstArgument, secondArgument, io);
  }
  if (command === "cancel") {
    if (firstArgument === undefined || secondArgument === undefined) {
      printUsage(io);
      return 2;
    }
    return cancelCommand(firstArgument, secondArgument, io);
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
