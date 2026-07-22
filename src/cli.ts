#!/usr/bin/env node

import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { dirname, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

import { checkNodeProject } from "./node-project/project-check.js";
import { checkNodeTypeScriptPolicy } from "./node-project/node-typescript-policy.js";
import { compileWorkflow } from "./workflow/compiler.js";
import {
  activateWorkflowCatalog,
  checkWorkflowCatalog,
  syncWorkflowCatalog,
} from "./workflow/catalog.js";
import { expandWorkflowPrerequisites } from "./workflow/expanded-graph.js";
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
    "用法：harness-next " +
      "<doctor|project-check|node-policy-check|validate|diagram|image|sync|activate|start|continue|cancel> [...args]",
  );
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
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

async function projectCheckCommand(requestedRoot: string | undefined, io: CliIo): Promise<number> {
  const rootDir = resolve(
    io.cwd,
    requestedRoot ?? process.env.HARNESS_WORKSPACE_ROOT ?? ".",
  );
  const result = await checkNodeProject({ rootDir });
  io.stdout(JSON.stringify(result));
  return result.ok ? 0 : 1;
}

async function changedFiles(rootDir: string): Promise<string[]> {
  const output = await new Promise<string>((resolveOutput, reject) => {
    execFile(
      "git",
      ["status", "--porcelain=v1", "-z"],
      { cwd: rootDir, encoding: "utf8" },
      (error, stdout) => {
        if (error !== null) {
          reject(
            error instanceof Error ? error : new Error("无法读取 Git 变更列表。", { cause: error }),
          );
          return;
        }
        resolveOutput(stdout);
      },
    );
  });
  return output
    .split("\u0000")
    .filter((entry) => entry.length > 3 && entry[2] === " ")
    .map((entry) => entry.slice(3));
}

async function nodePolicyCheckCommand(
  firstArgument: string | undefined,
  secondArgument: string | undefined,
  io: CliIo,
): Promise<number> {
  try {
    const changedOnly = firstArgument === "--changed";
    const requestedRoot = changedOnly ? secondArgument : firstArgument;
    const rootDir = resolve(io.cwd, requestedRoot ?? process.env.HARNESS_WORKSPACE_ROOT ?? ".");
    const sourcePaths = changedOnly ? await changedFiles(rootDir) : undefined;
    const result = await checkNodeTypeScriptPolicy({
      rootDir,
      standardsPath: join(
        resolve(io.cwd),
        "harness/workflows/node-typescript-standards/STANDARDS.md",
      ),
      ...(sourcePaths === undefined ? {} : { sourcePaths }),
    });
    io.stdout(JSON.stringify(result));
    return result.ok ? 0 : 1;
  } catch (error: unknown) {
    io.stderr(error instanceof Error ? "无法读取 Git 变更列表。" : "Node.js TypeScript 规范检查失败。");
    return 1;
  }
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

async function diagramCommand(
  workflowPath: string,
  expandPrerequisites: boolean,
  io: CliIo,
): Promise<number> {
  if (!expandPrerequisites) {
    return compileCommand("diagram", workflowPath, io);
  }
  try {
    const expanded = await expandWorkflowPrerequisites({
      rootDir: io.cwd,
      workflowPath: resolve(io.cwd, workflowPath),
    });
    io.stdout(expanded.mermaid);
    return 0;
  } catch (error: unknown) {
    io.stderr(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

function isInsideWorkspace(rootDir: string, path: string): boolean {
  return path === rootDir || path.startsWith(`${rootDir}${sep}`);
}

async function imageCommand(
  workflowPath: string,
  requestedOutputPath: string | undefined,
  expandPrerequisites: boolean,
  io: CliIo,
): Promise<number> {
  let graph;
  let workflowName;
  let title;
  if (expandPrerequisites) {
    try {
      const expanded = await expandWorkflowPrerequisites({
        rootDir: io.cwd,
        workflowPath: resolve(io.cwd, workflowPath),
      });
      graph = expanded.graph;
      workflowName = `${expanded.workflowName}-expanded`;
      title = expanded.title;
    } catch (error: unknown) {
      io.stderr(error instanceof Error ? error.message : String(error));
      return 1;
    }
  } else {
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
    graph = result.graph;
    workflowName = result.workflow.document.name;
    title = result.workflow.document.title ?? workflowName;
  }
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
  await writeFile(outputPath, renderWorkflowSvg(graph, title), "utf8");
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

async function activateCommand(check: boolean, io: CliIo): Promise<number> {
  try {
    const result = check
      ? await checkWorkflowCatalog({ rootDir: io.cwd })
      : await activateWorkflowCatalog({ rootDir: io.cwd });
    io.stdout(
      check
        ? "Workflow Catalog：激活范围已是最新"
        : result.changed
          ? "Workflow Catalog：已激活"
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
    const input = await readJson(resolve(io.cwd, inputPath));
    const requestedWorkspaceRoot = asRecord(input)?.projectRoot;
    const response = await startWorkflowRun({
      rootDir: io.cwd,
      workflowPath,
      executionKey,
      input,
      ...(typeof requestedWorkspaceRoot === "string"
        ? { workspaceRoot: resolve(io.cwd, requestedWorkspaceRoot) }
        : {}),
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

function missingArguments(io: CliIo): number {
  printUsage(io);
  return 2;
}

type CommandHandler = (args: string[], io: CliIo) => Promise<number> | number;

const COMMAND_HANDLERS: Readonly<Record<string, CommandHandler>> = {
  doctor: (_args, io) => doctor(io),
  "project-check": ([requestedRoot], io) => projectCheckCommand(requestedRoot, io),
  "node-policy-check": ([firstArgument, secondArgument], io) =>
    nodePolicyCheckCommand(firstArgument, secondArgument, io),
  validate: ([path], io) =>
    path === undefined ? missingArguments(io) : compileCommand("validate", path, io),
  diagram: ([path, ...options], io) =>
    path === undefined
      ? missingArguments(io)
      : diagramCommand(path, options.includes("--expand-prerequisites"), io),
  image: ([path, ...options], io) => {
    if (path === undefined) {
      return missingArguments(io);
    }
    const expandPrerequisites = options.includes("--expand-prerequisites");
    const outputPath = options.find((option) => option !== "--expand-prerequisites");
    return imageCommand(path, outputPath, expandPrerequisites, io);
  },
  sync: ([option], io) => syncCommand(option === "--check", io),
  activate: ([option], io) => activateCommand(option === "--check", io),
  start: ([workflowPath, executionKey, inputPath], io) =>
    workflowPath === undefined || executionKey === undefined || inputPath === undefined
      ? missingArguments(io)
      : startCommand(workflowPath, executionKey, inputPath, io),
  continue: ([runId, resultPath], io) =>
    runId === undefined ? missingArguments(io) : continueCommand(runId, resultPath, io),
  cancel: ([runId, reason], io) =>
    runId === undefined || reason === undefined
      ? missingArguments(io)
      : cancelCommand(runId, reason, io),
};

export async function main(argv: string[], io: CliIo): Promise<number> {
  const [command, ...args] = argv;
  const handler = command === undefined ? undefined : COMMAND_HANDLERS[command];
  return handler === undefined ? missingArguments(io) : handler(args, io);
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
