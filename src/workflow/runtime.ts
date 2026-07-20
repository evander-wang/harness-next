import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import type { Specification } from "@openworkflowspec/sdk";

import {
  executeDeterministicChecks,
  type CheckCommandExecution,
} from "./checks.js";
import { compileWorkflow, validateWorkflowData } from "./compiler.js";

export type StepResultStatus = "passed" | "needs_changes" | "blocked";

export type StepResult = {
  runId: string;
  revision: number;
  stepId: string;
  status: StepResultStatus;
  evidence: string[];
  data?: unknown;
};

export type WorkflowStepDirective = {
  id: string;
  attempt: number;
  skillPath: string;
  checkPaths: string[];
};

export type WorkflowRunStatus =
  | "running"
  | "interrupted"
  | "blocked"
  | "completed"
  | "cancelled"
  | "failed";

export type WorkflowRuntimeResponse = {
  runId: string;
  status: WorkflowRunStatus;
  revision: number;
  step?: WorkflowStepDirective;
  evidence?: string[];
  output?: unknown;
  checkExecutions?: CheckCommandExecution[];
};

export type StartWorkflowRunOptions = {
  rootDir: string;
  workflowPath: string;
  executionKey: string;
  input: unknown;
};

export type ContinueWorkflowRunOptions = {
  rootDir: string;
  runId: string;
  result?: StepResult;
};

export type CancelWorkflowRunOptions = {
  rootDir: string;
  runId: string;
  reason: string;
};

type PersistedRunStatus = Exclude<WorkflowRunStatus, "interrupted">;

type CurrentStep = WorkflowStepDirective & {
  phase: "in_progress";
};

type WorkflowRunState = {
  schemaVersion: 1;
  runId: string;
  executionKey: string;
  workspaceRoot: string;
  workflowPath: string;
  workflowName: string;
  workflowVersion: string;
  workflowHash: string;
  inputDigest: string;
  status: PersistedRunStatus;
  revision: number;
  currentStep: CurrentStep | null;
  attempts: Record<string, number>;
  evidence: string[];
  checkExecutions: CheckCommandExecution[];
  createdAt: string;
  updatedAt: string;
  output?: unknown;
};

type TaskEntry = {
  id: string;
  task: unknown;
  index: number;
};

type LoadedWorkflow = {
  workflow: Specification.Workflow;
  workflowPath: string;
  workflowHash: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function digest(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function isInsideWorkspace(rootDir: string, path: string): boolean {
  return path === rootDir || path.startsWith(`${rootDir}${sep}`);
}

function portablePath(rootDir: string, path: string): string {
  return relative(rootDir, path).split("\\").join("/");
}

function runDirectory(rootDir: string, runId: string): string {
  if (!/^[a-zA-Z0-9-]+$/u.test(runId)) {
    throw new Error("Workflow Run ID 非法。");
  }
  return join(rootDir, ".harness/runs", runId);
}

function statePath(rootDir: string, runId: string): string {
  return join(runDirectory(rootDir, runId), "state.json");
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

async function withRuntimeLock<T>(rootDir: string, operation: () => Promise<T>): Promise<T> {
  const harnessRoot = join(rootDir, ".harness");
  const lockPath = join(harnessRoot, "runtime.lock");
  const ownerPath = join(lockPath, "owner.json");
  await mkdir(harnessRoot, { recursive: true });

  let acquired = false;
  for (let attempt = 0; attempt < 500; attempt += 1) {
    try {
      await mkdir(lockPath);
      await writeFile(ownerPath, `${JSON.stringify({ pid: process.pid })}\n`, "utf8");
      acquired = true;
      break;
    } catch (error: unknown) {
      if (!isNodeError(error) || error.code !== "EEXIST") {
        throw error;
      }
      try {
        const owner = JSON.parse(await readFile(ownerPath, "utf8")) as unknown;
        const pid = asRecord(owner)?.pid;
        if (typeof pid === "number" && Number.isInteger(pid)) {
          let ownerIsAlive = true;
          try {
            process.kill(pid, 0);
          } catch (processError: unknown) {
            ownerIsAlive = !isNodeError(processError) || processError.code !== "ESRCH";
          }
          if (!ownerIsAlive) {
            await rm(lockPath, { recursive: true, force: true });
            continue;
          }
        }
      } catch (ownerError: unknown) {
        if (isNodeError(ownerError) && ownerError.code === "ENOENT") {
          await delay(10);
          continue;
        }
        if (ownerError instanceof SyntaxError) {
          await rm(lockPath, { recursive: true, force: true });
          continue;
        }
        throw ownerError;
      }
      await delay(10);
    }
  }
  if (!acquired) {
    throw new Error("Workflow Runtime 正忙，请稍后重试。");
  }

  try {
    return await operation();
  } finally {
    await rm(lockPath, { recursive: true, force: true });
  }
}

async function writeState(rootDir: string, state: WorkflowRunState): Promise<void> {
  const path = statePath(rootDir, state.runId);
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(temporaryPath, path);
}

async function readState(rootDir: string, runId: string): Promise<WorkflowRunState> {
  return JSON.parse(await readFile(statePath(rootDir, runId), "utf8")) as WorkflowRunState;
}

async function readAllStates(rootDir: string): Promise<WorkflowRunState[]> {
  const runsRoot = join(rootDir, ".harness/runs");
  let entries: string[];
  try {
    entries = await readdir(runsRoot);
  } catch {
    return [];
  }
  const states: WorkflowRunState[] = [];
  for (const runId of entries) {
    try {
      states.push(await readState(rootDir, runId));
    } catch {
      continue;
    }
  }
  return states;
}

async function loadWorkflow(rootDir: string, workflowPath: string): Promise<LoadedWorkflow> {
  const resolvedPath = resolve(rootDir, workflowPath);
  if (!isInsideWorkspace(rootDir, resolvedPath)) {
    throw new Error("Workflow 路径必须位于当前 Worktree 内。");
  }
  const source = await readFile(resolvedPath, "utf8");
  const result = await compileWorkflow({ rootDir, workflowPath: resolvedPath });
  if (!result.ok || result.workflow === null) {
    const messages = result.diagnostics.map((diagnostic) => diagnostic.message).join("；");
    throw new Error(`Workflow 编译失败：${messages}`);
  }
  return {
    workflow: result.workflow,
    workflowPath: portablePath(rootDir, resolvedPath),
    workflowHash: digest(source),
  };
}

function taskEntries(workflow: Specification.Workflow): TaskEntry[] {
  return workflow.do.flatMap((item, index) => {
    const entry = Object.entries(item)[0];
    return entry === undefined ? [] : [{ id: entry[0], task: entry[1], index }];
  });
}

function getChecks(task: unknown): string[] {
  const metadata = asRecord(asRecord(task)?.metadata);
  const harness = asRecord(metadata?.harness);
  const checks = harness?.checks;
  return Array.isArray(checks)
    ? checks.filter((check): check is string => typeof check === "string")
    : [];
}

function maxStepAttempts(workflow: Specification.Workflow): number {
  const metadata = asRecord(workflow.document.metadata);
  const harness = asRecord(metadata?.harness);
  const execution = asRecord(harness?.execution);
  const configured = execution?.maxStepAttempts;
  return typeof configured === "number" && Number.isInteger(configured) && configured > 0
    ? configured
    : 3;
}

function directiveFor(rootDir: string, entry: TaskEntry, attempt: number): WorkflowStepDirective {
  const call = asRecord(entry.task)?.call;
  if (typeof call !== "string") {
    throw new Error(`Step '${entry.id}' 不是可执行的本地 Skill。`);
  }
  const checks = getChecks(entry.task);
  return {
    id: entry.id,
    attempt,
    skillPath: portablePath(rootDir, join(rootDir, "skills", call, "SKILL.md")),
    checkPaths: checks.map((check) =>
      portablePath(rootDir, join(rootDir, "harness/checks", check, "CHECK.md")),
    ),
  };
}

function responseFromState(
  state: WorkflowRunState,
  status: WorkflowRunStatus = state.status,
  checkExecutions?: CheckCommandExecution[],
): WorkflowRuntimeResponse {
  return {
    runId: state.runId,
    status,
    revision: state.revision,
    ...(state.currentStep === null
      ? {}
      : {
          step: {
            id: state.currentStep.id,
            attempt: state.currentStep.attempt,
            skillPath: state.currentStep.skillPath,
            checkPaths: state.currentStep.checkPaths,
          },
        }),
    ...(state.evidence.length === 0 ? {} : { evidence: state.evidence }),
    ...(state.output === undefined ? {} : { output: state.output }),
    ...(checkExecutions === undefined || checkExecutions.length === 0
      ? {}
      : { checkExecutions }),
  };
}

function findTask(entries: TaskEntry[], stepId: string): TaskEntry {
  const entry = entries.find((candidate) => candidate.id === stepId);
  if (entry === undefined) {
    throw new Error(`Workflow 中不存在 Step '${stepId}'。`);
  }
  return entry;
}

function conditionMatches(condition: string, status: StepResultStatus): boolean {
  const match = /^\.status\s*==\s*["'](passed|needs_changes|blocked)["']$/u.exec(condition);
  if (match === null) {
    throw new Error(`Runtime 不支持 switch 条件：${condition}`);
  }
  return match[1] === status;
}

function switchTarget(task: unknown, status: StepResultStatus): string | undefined {
  const branches = asRecord(task)?.switch;
  if (!Array.isArray(branches)) {
    throw new Error("目标 Step 不是 switch。");
  }
  let defaultTarget: string | undefined;
  for (const branchItem of branches) {
    const branchEntry = Object.entries(asRecord(branchItem) ?? {})[0];
    if (branchEntry === undefined) {
      continue;
    }
    const branch = asRecord(branchEntry[1]);
    const when = branch?.when;
    const then = branch?.then;
    if (typeof then !== "string") {
      continue;
    }
    if (typeof when === "string" && conditionMatches(when, status)) {
      return then;
    }
    if (when === undefined) {
      defaultTarget = then;
    }
  }
  return defaultTarget;
}

function resolveNextStep(
  workflow: Specification.Workflow,
  currentStepId: string,
  status: StepResultStatus,
): TaskEntry | null {
  const entries = taskEntries(workflow);
  const current = findTask(entries, currentStepId);
  const currentTask = asRecord(current.task);
  let target = currentTask?.then;
  let nextIndex = current.index + 1;

  if (status === "needs_changes" && target === undefined) {
    const sequential = entries[nextIndex];
    if (sequential === undefined || !Array.isArray(asRecord(sequential.task)?.switch)) {
      return current;
    }
  }

  for (let hops = 0; hops <= entries.length; hops += 1) {
    if (target === "end" || target === "exit") {
      return null;
    }
    let candidate: TaskEntry | undefined;
    if (target === undefined || target === "continue") {
      candidate = entries[nextIndex];
    } else if (typeof target === "string") {
      candidate = entries.find((entry) => entry.id === target);
    }
    if (candidate === undefined) {
      return null;
    }
    const candidateTask = asRecord(candidate.task);
    if (typeof candidateTask?.call === "string") {
      return candidate;
    }
    if (Array.isArray(candidateTask?.switch)) {
      target = switchTarget(candidate.task, status);
      nextIndex = candidate.index + 1;
      continue;
    }
    throw new Error(`Step '${candidate.id}' 不是 Runtime 支持的 Task。`);
  }
  throw new Error("Workflow Transition 超过最大解析深度。");
}

function startStep(
  rootDir: string,
  state: WorkflowRunState,
  workflow: Specification.Workflow,
  entry: TaskEntry,
): { response: WorkflowRuntimeResponse; state: WorkflowRunState } {
  const attempt = (state.attempts[entry.id] ?? 0) + 1;
  const maximum = maxStepAttempts(workflow);
  if (attempt > maximum) {
    const evidence = `Step '${entry.id}' 超过最大尝试次数 ${String(maximum)}。`;
    const blockedState: WorkflowRunState = {
      ...state,
      status: "blocked",
      currentStep: null,
      evidence: [...state.evidence, evidence],
    };
    return { state: blockedState, response: responseFromState(blockedState) };
  }
  const directive = directiveFor(rootDir, entry, attempt);
  const runningState: WorkflowRunState = {
    ...state,
    status: "running",
    currentStep: { ...directive, phase: "in_progress" },
    attempts: { ...state.attempts, [entry.id]: attempt },
  };
  return { state: runningState, response: responseFromState(runningState) };
}

function assertStepResult(state: WorkflowRunState, result: StepResult): void {
  if (state.status !== "running" || state.currentStep === null) {
    throw new Error(`Workflow Run 已结束：${state.status}`);
  }
  if (result.runId !== state.runId) {
    throw new Error("Step Result 的 runId 不匹配。");
  }
  if (result.revision !== state.revision) {
    throw new Error("Step Result Revision 已过期。");
  }
  if (result.stepId !== state.currentStep.id) {
    throw new Error("Step Result 的 stepId 不是当前 Step。");
  }
  if (
    !Array.isArray(result.evidence) ||
    result.evidence.length === 0 ||
    result.evidence.some((item) => typeof item !== "string" || item.length === 0)
  ) {
    throw new Error("Step Result evidence 必须是非空字符串数组。");
  }
  if (!new Set<StepResultStatus>(["passed", "needs_changes", "blocked"]).has(result.status)) {
    throw new Error("Step Result status 非法。");
  }
}

async function startWorkflowRunUnlocked(
  options: StartWorkflowRunOptions,
): Promise<WorkflowRuntimeResponse> {
  const rootDir = resolve(options.rootDir);
  if (options.executionKey.trim().length === 0) {
    throw new Error("executionKey 不能为空。");
  }
  const loaded = await loadWorkflow(rootDir, options.workflowPath);
  const inputDiagnostics = await validateWorkflowData({
    rootDir,
    workflow: loaded.workflow,
    target: "input",
    data: options.input,
  });
  if (inputDiagnostics.length > 0) {
    throw new Error(`Workflow input 不符合 JSON Schema：${inputDiagnostics[0]?.message ?? "未知错误"}`);
  }
  const inputDigest = digest(JSON.stringify(options.input));
  const existingStates = await readAllStates(rootDir);
  const sameExecution = existingStates
    .filter((state) => state.executionKey === options.executionKey)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
  if (sameExecution !== undefined) {
    if (
      sameExecution.workflowPath !== loaded.workflowPath ||
      sameExecution.workflowHash !== loaded.workflowHash ||
      sameExecution.inputDigest !== inputDigest
    ) {
      throw new Error("executionKey 已绑定到不同的 Workflow 或输入。");
    }
    return responseFromState(
      sameExecution,
      sameExecution.status === "running" ? "interrupted" : sameExecution.status,
    );
  }
  if (existingStates.some((state) => state.status === "running")) {
    throw new Error("当前 Worktree 已存在运行中的 Workflow。");
  }

  const first = taskEntries(loaded.workflow)[0];
  if (first === undefined || typeof asRecord(first.task)?.call !== "string") {
    throw new Error("Workflow 起点必须是本地 Skill Step。");
  }

  const now = new Date().toISOString();
  const runId = randomUUID();
  const baseState: WorkflowRunState = {
    schemaVersion: 1,
    runId,
    executionKey: options.executionKey,
    workspaceRoot: rootDir,
    workflowPath: loaded.workflowPath,
    workflowName: loaded.workflow.document.name,
    workflowVersion: loaded.workflow.document.version,
    workflowHash: loaded.workflowHash,
    inputDigest,
    status: "running",
    revision: 1,
    currentStep: null,
    attempts: {},
    evidence: [],
    checkExecutions: [],
    createdAt: now,
    updatedAt: now,
  };
  const started = startStep(rootDir, baseState, loaded.workflow, first);
  await writeState(rootDir, started.state);
  return started.response;
}

export async function startWorkflowRun(
  options: StartWorkflowRunOptions,
): Promise<WorkflowRuntimeResponse> {
  const rootDir = resolve(options.rootDir);
  return withRuntimeLock(rootDir, () => startWorkflowRunUnlocked(options));
}

async function continueWorkflowRunUnlocked(
  options: ContinueWorkflowRunOptions,
): Promise<WorkflowRuntimeResponse> {
  const rootDir = resolve(options.rootDir);
  const state = await readState(rootDir, options.runId);
  if (options.result === undefined) {
    return responseFromState(state, state.status === "running" ? "interrupted" : state.status);
  }
  assertStepResult(state, options.result);

  const loaded = await loadWorkflow(rootDir, state.workflowPath);
  if (loaded.workflowHash !== state.workflowHash) {
    throw new Error("Workflow 文件已在运行期间改变，当前 Run 已停止推进。");
  }
  const currentTask = findTask(taskEntries(loaded.workflow), options.result.stepId);
  const checkIds = getChecks(currentTask.task);
  let checkExecutions: CheckCommandExecution[] = [];
  let effectiveStatus = options.result.status;
  if (effectiveStatus === "passed" && checkIds.length > 0) {
    try {
      checkExecutions = await executeDeterministicChecks({ rootDir, checkIds });
    } catch (error: unknown) {
      const failedState: WorkflowRunState = {
        ...state,
        status: "failed",
        revision: state.revision + 1,
        currentStep: null,
        evidence: [
          ...state.evidence,
          error instanceof Error ? error.message : String(error),
        ],
        updatedAt: new Date().toISOString(),
      };
      await writeState(rootDir, failedState);
      return responseFromState(failedState);
    }
    if (checkExecutions.some((execution) => execution.exitCode !== 0)) {
      effectiveStatus = "needs_changes";
    }
  }

  const commandEvidence = checkExecutions.map(
    (execution) =>
      `${execution.checkId}: ${execution.command} ${execution.args.join(" ")} -> ${String(execution.exitCode)}`,
  );
  const nextRevision = state.revision + 1;
  const evidence = [...state.evidence, ...options.result.evidence, ...commandEvidence];
  const baseState: WorkflowRunState = {
    ...state,
    revision: nextRevision,
    currentStep: null,
    evidence,
    checkExecutions: [...state.checkExecutions, ...checkExecutions],
    updatedAt: new Date().toISOString(),
  };

  if (effectiveStatus === "blocked") {
    const blockedState: WorkflowRunState = { ...baseState, status: "blocked" };
    await writeState(rootDir, blockedState);
    return responseFromState(blockedState, "blocked", checkExecutions);
  }

  const nextStep = resolveNextStep(loaded.workflow, options.result.stepId, effectiveStatus);
  if (nextStep === null) {
    const outputDiagnostics = await validateWorkflowData({
      rootDir,
      workflow: loaded.workflow,
      target: "output",
      data: options.result.data,
    });
    if (outputDiagnostics.length > 0) {
      throw new Error(`Workflow output 不符合 JSON Schema：${outputDiagnostics[0]?.message ?? "未知错误"}`);
    }
    const completedState: WorkflowRunState = {
      ...baseState,
      status: "completed",
      ...(options.result.data === undefined ? {} : { output: options.result.data }),
    };
    await writeState(rootDir, completedState);
    return responseFromState(completedState, "completed", checkExecutions);
  }

  const advanced = startStep(rootDir, baseState, loaded.workflow, nextStep);
  await writeState(rootDir, advanced.state);
  return {
    ...advanced.response,
    ...(checkExecutions.length === 0 ? {} : { checkExecutions }),
  };
}

export async function continueWorkflowRun(
  options: ContinueWorkflowRunOptions,
): Promise<WorkflowRuntimeResponse> {
  const rootDir = resolve(options.rootDir);
  return withRuntimeLock(rootDir, () => continueWorkflowRunUnlocked(options));
}

async function cancelWorkflowRunUnlocked(
  options: CancelWorkflowRunOptions,
): Promise<WorkflowRuntimeResponse> {
  const rootDir = resolve(options.rootDir);
  const state = await readState(rootDir, options.runId);
  if (state.status === "completed" || state.status === "cancelled" || state.status === "failed") {
    throw new Error(`Workflow Run 已结束：${state.status}`);
  }
  const cancelledState: WorkflowRunState = {
    ...state,
    status: "cancelled",
    revision: state.revision + 1,
    currentStep: null,
    evidence: [...state.evidence, options.reason],
    updatedAt: new Date().toISOString(),
  };
  await writeState(rootDir, cancelledState);
  return responseFromState(cancelledState);
}

export async function cancelWorkflowRun(
  options: CancelWorkflowRunOptions,
): Promise<WorkflowRuntimeResponse> {
  const rootDir = resolve(options.rootDir);
  return withRuntimeLock(rootDir, () => cancelWorkflowRunUnlocked(options));
}
