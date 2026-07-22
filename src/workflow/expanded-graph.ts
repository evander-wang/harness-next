import { relative, resolve } from "node:path";

import { GraphNodeType, type FlatGraph } from "@openworkflowspec/sdk";

import {
  buildWorkflowCatalog,
  type WorkflowCatalog,
  type WorkflowCatalogEntry,
} from "./catalog.js";
import { compileWorkflow } from "./compiler.js";

export type ExpandedWorkflowGraph = {
  graph: FlatGraph;
  mermaid: string;
  workflowName: string;
  title: string;
};

type WorkflowAnchors = {
  startNodeId: string;
  endNodeId: string;
};

type FlatNode = FlatGraph["nodes"][number];
type FlatEdge = FlatGraph["edges"][number];

function portablePath(rootDir: string, path: string): string {
  return relative(rootDir, path).split("\\").join("/");
}

function resolveWorkflowOrder(
  target: WorkflowCatalogEntry,
  catalog: WorkflowCatalog,
): WorkflowCatalogEntry[] {
  const byName = new Map(catalog.workflows.map((workflow) => [workflow.name, workflow]));
  const visited = new Set<string>();
  const ordered: WorkflowCatalogEntry[] = [];

  const visit = (workflow: WorkflowCatalogEntry): void => {
    if (visited.has(workflow.name)) {
      return;
    }
    visited.add(workflow.name);
    for (const prerequisiteName of workflow.prerequisites) {
      const prerequisite = byName.get(prerequisiteName);
      if (prerequisite === undefined) {
        throw new Error(
          `Workflow '${workflow.name}' 引用了不存在的前置 Workflow：${prerequisiteName}`,
        );
      }
      visit(prerequisite);
    }
    ordered.push(workflow);
  };

  visit(target);
  return ordered;
}

function displayNodeLabel(workflow: WorkflowCatalogEntry, node: FlatNode): string | undefined {
  if (node.type === GraphNodeType.Start) {
    return `${workflow.title} 开始`;
  }
  if (node.type === GraphNodeType.End) {
    return `${workflow.title} 结束`;
  }
  return node.label === undefined ? undefined : `[${workflow.name}] ${node.label}`;
}

function mermaidLabel(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("|", "&#124;");
}

function toMermaidNode(node: FlatNode): string {
  const label = mermaidLabel(node.label ?? node.type);
  if (node.type === GraphNodeType.Start) {
    return `  ${node.id}(("${label}"))`;
  }
  if (node.type === GraphNodeType.End) {
    return `  ${node.id}((("${label}")))`;
  }
  if (node.type === GraphNodeType.Switch) {
    return `  ${node.id}{"${label}"}`;
  }
  return `  ${node.id}["${label}"]`;
}

function toMermaid(graph: FlatGraph): string {
  const nodes = graph.nodes.map(toMermaidNode);
  const edges = graph.edges.map((edge) => {
    const label = edge.label === undefined || edge.label.length === 0 ? "" : `|${mermaidLabel(edge.label)}|`;
    return `  ${edge.sourceId} -->${label} ${edge.targetId}`;
  });
  return ["flowchart TD", ...nodes, ...edges].join("\n");
}

export async function expandWorkflowPrerequisites(options: {
  rootDir: string;
  workflowPath: string;
}): Promise<ExpandedWorkflowGraph> {
  const rootDir = resolve(options.rootDir);
  const requestedPath = portablePath(rootDir, resolve(options.workflowPath));
  const catalog = await buildWorkflowCatalog(rootDir);
  const target = catalog.workflows.find((workflow) => workflow.path === requestedPath);
  if (target === undefined) {
    throw new Error(`Workflow 不在 Catalog 中：${requestedPath}`);
  }

  const workflows = resolveWorkflowOrder(target, catalog);
  const nodes: FlatNode[] = [];
  const edges: FlatEdge[] = [];
  const anchors = new Map<string, WorkflowAnchors>();
  let nextNode = 0;
  let nextEdge = 0;

  for (const workflow of workflows) {
    const compiled = await compileWorkflow({
      rootDir,
      workflowPath: resolve(rootDir, workflow.path),
    });
    if (!compiled.ok || compiled.graph === null) {
      const diagnostics = compiled.diagnostics.map((diagnostic) => diagnostic.message).join("；");
      throw new Error(`Workflow 编译失败：${workflow.path}：${diagnostics}`);
    }

    const nodeIds = new Map<string, string>();
    let startNodeId: string | undefined;
    let endNodeId: string | undefined;
    for (const node of compiled.graph.nodes) {
      const nodeId = `node_${String(nextNode++)}`;
      nodeIds.set(node.id, nodeId);
      const label = displayNodeLabel(workflow, node);
      const expandedNode: FlatNode =
        label === undefined
          ? { id: nodeId, type: node.type }
          : { id: nodeId, type: node.type, label };
      nodes.push(expandedNode);
      if (node.type === GraphNodeType.Start) {
        startNodeId = nodeId;
      }
      if (node.type === GraphNodeType.End) {
        endNodeId = nodeId;
      }
    }
    if (startNodeId === undefined || endNodeId === undefined) {
      throw new Error(`Workflow 图缺少起止节点：${workflow.path}`);
    }
    anchors.set(workflow.name, { startNodeId, endNodeId });

    for (const edge of compiled.graph.edges) {
      const sourceId = nodeIds.get(edge.sourceId);
      const targetId = nodeIds.get(edge.targetId);
      if (sourceId === undefined || targetId === undefined) {
        throw new Error(`Workflow 图包含无效边：${workflow.path}`);
      }
      edges.push({
        id: `edge_${String(nextEdge++)}`,
        sourceId,
        targetId,
        ...(edge.label === undefined ? {} : { label: edge.label }),
      });
    }
  }

  for (const workflow of workflows) {
    const workflowAnchors = anchors.get(workflow.name);
    if (workflowAnchors === undefined) {
      continue;
    }
    for (const prerequisiteName of workflow.prerequisites) {
      const prerequisiteAnchors = anchors.get(prerequisiteName);
      if (prerequisiteAnchors === undefined) {
        throw new Error(`未展开前置 Workflow：${prerequisiteName}`);
      }
      edges.push({
        id: `edge_${String(nextEdge++)}`,
        sourceId: prerequisiteAnchors.endNodeId,
        targetId: workflowAnchors.startNodeId,
        label: "prerequisite",
      });
    }
  }

  const graph: FlatGraph = {
    id: `expanded-${target.name}`,
    type: GraphNodeType.Root,
    nodes,
    edges,
  };
  return {
    graph,
    mermaid: toMermaid(graph),
    workflowName: target.name,
    title: `${target.title}（含前置 Workflow）`,
  };
}
