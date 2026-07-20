import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

import { compileWorkflow } from "./compiler.js";

export type WorkflowRouting = {
  aliases: string[];
  when: string[];
  notWhen: string[];
};

export type WorkflowCatalogEntry = {
  name: string;
  namespace: string;
  version: string;
  title: string;
  summary: string;
  path: string;
  sourceHash: string;
  routing: WorkflowRouting;
};

export type WorkflowCatalog = {
  schemaVersion: 1;
  workflows: WorkflowCatalogEntry[];
};

export type SyncWorkflowCatalogOptions = {
  rootDir: string;
  check?: boolean;
};

export type SyncWorkflowCatalogResult = {
  catalog: WorkflowCatalog;
  changed: boolean;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function stringArray(value: unknown, field: string, workflowName: string): string[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`Workflow '${workflowName}' 的 routing.${field} 必须是字符串数组。`);
  }
  return value.map((item) => {
    if (typeof item !== "string") {
      throw new Error(`Workflow '${workflowName}' 的 routing.${field} 必须是字符串数组。`);
    }
    return item;
  });
}

function sourceHash(source: string): string {
  return `sha256:${createHash("sha256").update(source).digest("hex")}`;
}

function portablePath(rootDir: string, path: string): string {
  return relative(rootDir, path).split("\\").join("/");
}

async function findWorkflowPaths(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const paths: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      paths.push(...(await findWorkflowPaths(path)));
    } else if (entry.isFile() && entry.name === "workflow.yaml") {
      paths.push(path);
    }
  }
  return paths;
}

function readRouting(document: unknown, workflowName: string): WorkflowRouting {
  const metadata = asRecord(asRecord(document)?.metadata);
  const harness = asRecord(metadata?.harness);
  const routing = asRecord(harness?.routing);
  return {
    aliases: stringArray(routing?.aliases, "aliases", workflowName),
    when: stringArray(routing?.when, "when", workflowName),
    notWhen: stringArray(routing?.notWhen, "notWhen", workflowName),
  };
}

export async function buildWorkflowCatalog(rootDir: string): Promise<WorkflowCatalog> {
  const resolvedRoot = resolve(rootDir);
  const workflowsRoot = join(resolvedRoot, "harness/workflows");
  const workflowPaths = await findWorkflowPaths(workflowsRoot);
  const workflows: WorkflowCatalogEntry[] = [];

  for (const workflowPath of workflowPaths) {
    const result = await compileWorkflow({ rootDir: resolvedRoot, workflowPath });
    if (!result.ok || result.workflow === null) {
      const messages = result.diagnostics.map((diagnostic) => diagnostic.message).join("；");
      throw new Error(`Workflow 编译失败：${portablePath(resolvedRoot, workflowPath)}：${messages}`);
    }

    const source = await readFile(workflowPath, "utf8");
    const { document } = result.workflow;
    workflows.push({
      name: document.name,
      namespace: document.namespace,
      version: document.version,
      title: document.title ?? document.name,
      summary: document.summary ?? "",
      path: portablePath(resolvedRoot, workflowPath),
      sourceHash: sourceHash(source),
      routing: readRouting(document, document.name),
    });
  }

  workflows.sort((left, right) => left.name.localeCompare(right.name));
  const routeNames = new Map<string, string>();
  for (const workflow of workflows) {
    for (const routeName of [workflow.name, ...workflow.routing.aliases]) {
      const existing = routeNames.get(routeName);
      if (existing !== undefined) {
        throw new Error(`Workflow 路由名称或 Alias 重复：${routeName}`);
      }
      routeNames.set(routeName, workflow.name);
    }
  }

  return { schemaVersion: 1, workflows };
}

export async function syncWorkflowCatalog(
  options: SyncWorkflowCatalogOptions,
): Promise<SyncWorkflowCatalogResult> {
  const rootDir = resolve(options.rootDir);
  const catalog = await buildWorkflowCatalog(rootDir);
  const catalogPath = join(rootDir, "harness/generated/workflow-catalog.json");
  const serialized = `${JSON.stringify(catalog, null, 2)}\n`;
  let current: string | null = null;
  try {
    current = await readFile(catalogPath, "utf8");
  } catch {
    current = null;
  }
  const changed = current !== serialized;

  if (options.check === true) {
    if (changed) {
      throw new Error("Workflow Catalog 已过期，请执行 npm run workflow:sync。");
    }
    return { catalog, changed: false };
  }

  if (changed) {
    await mkdir(dirname(catalogPath), { recursive: true });
    const temporaryPath = `${catalogPath}.tmp`;
    await writeFile(temporaryPath, serialized, "utf8");
    await rename(temporaryPath, catalogPath);
  }
  return { catalog, changed };
}
