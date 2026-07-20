import {
  Graph,
  layout,
  type EdgeLabel,
  type GraphLabel,
  type NodeLabel,
  type Point,
} from "@dagrejs/dagre";
import { GraphNodeType, type FlatGraph } from "@openworkflowspec/sdk";

type RenderNode = NodeLabel & {
  label: string;
  type: GraphNodeType;
};

type RenderEdge = EdgeLabel & {
  label?: string;
  points?: Point[];
};

const NODE_HEIGHT = 52;
const MIN_NODE_WIDTH = 156;
const HORIZONTAL_PADDING = 36;
const TITLE_HEIGHT = 52;

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function formatNumber(value: number): string {
  return String(Math.round(value * 100) / 100);
}

function nodeLabel(type: GraphNodeType, label: string | undefined): string {
  if (label !== undefined) {
    return label;
  }
  if (type === GraphNodeType.Start) {
    return "开始";
  }
  if (type === GraphNodeType.End) {
    return "结束";
  }
  return type;
}

function nodeWidth(label: string, type: GraphNodeType): number {
  if (type === GraphNodeType.Start || type === GraphNodeType.End) {
    return 44;
  }
  return Math.max(MIN_NODE_WIDTH, label.length * 9 + HORIZONTAL_PADDING);
}

function createLayoutGraph(graph: FlatGraph): Graph<GraphLabel, RenderNode, RenderEdge> {
  const layoutGraph = new Graph<GraphLabel, RenderNode, RenderEdge>({
    directed: true,
    multigraph: true,
  });
  layoutGraph.setGraph({
    rankdir: "TB",
    nodesep: 42,
    edgesep: 24,
    ranksep: 72,
    marginx: 28,
    marginy: 28,
  });
  layoutGraph.setDefaultEdgeLabel(() => ({}));

  for (const node of graph.nodes) {
    const label = nodeLabel(node.type, node.label);
    layoutGraph.setNode(node.id, {
      label,
      type: node.type,
      width: nodeWidth(label, node.type),
      height: node.type === GraphNodeType.Switch ? 72 : NODE_HEIGHT,
    });
  }

  for (const edge of graph.edges) {
    const edgeLabel: RenderEdge = {
      width: edge.label === undefined ? 0 : edge.label.length * 8 + 16,
      height: edge.label === undefined ? 0 : 24,
    };
    if (edge.label !== undefined) {
      edgeLabel.label = edge.label;
    }
    layoutGraph.setEdge(
      edge.sourceId,
      edge.targetId,
      edgeLabel,
      edge.id,
    );
  }

  layout(layoutGraph);
  return layoutGraph;
}

function renderNode(node: RenderNode): string {
  const x = node.x ?? 0;
  const y = node.y ?? 0;
  const width = node.width;
  const height = node.height;
  const label = escapeXml(node.label);

  if (node.type === GraphNodeType.Start) {
    return `<g class="node start"><circle cx="${formatNumber(x)}" cy="${formatNumber(y)}" r="12"/><text x="${formatNumber(x)}" y="${formatNumber(y + 29)}" text-anchor="middle">${label}</text></g>`;
  }
  if (node.type === GraphNodeType.End) {
    return `<g class="node end"><circle cx="${formatNumber(x)}" cy="${formatNumber(y)}" r="15"/><circle cx="${formatNumber(x)}" cy="${formatNumber(y)}" r="10"/><text x="${formatNumber(x)}" y="${formatNumber(y + 32)}" text-anchor="middle">${label}</text></g>`;
  }
  if (node.type === GraphNodeType.Switch) {
    const points = [
      `${formatNumber(x)},${formatNumber(y - height / 2)}`,
      `${formatNumber(x + width / 2)},${formatNumber(y)}`,
      `${formatNumber(x)},${formatNumber(y + height / 2)}`,
      `${formatNumber(x - width / 2)},${formatNumber(y)}`,
    ].join(" ");
    return `<g class="node switch"><polygon points="${points}"/><text x="${formatNumber(x)}" y="${formatNumber(y + 5)}" text-anchor="middle">${label}</text></g>`;
  }

  return `<g class="node task"><rect x="${formatNumber(x - width / 2)}" y="${formatNumber(y - height / 2)}" width="${formatNumber(width)}" height="${formatNumber(height)}" rx="6"/><text x="${formatNumber(x)}" y="${formatNumber(y + 5)}" text-anchor="middle">${label}</text></g>`;
}

function renderEdge(edge: RenderEdge): string {
  const points = edge.points ?? [];
  const path = points
    .map(
      (point, index) =>
        `${index === 0 ? "M" : "L"} ${formatNumber(point.x)} ${formatNumber(point.y)}`,
    )
    .join(" ");
  const label = edge.label;
  const labelSvg =
    label === undefined
      ? ""
      : `<text class="edge-label" x="${formatNumber(edge.x ?? 0)}" y="${formatNumber((edge.y ?? 0) + 4)}" text-anchor="middle">${escapeXml(label)}</text>`;
  return `<g class="edge"><path d="${path}" marker-end="url(#arrow)"/>${labelSvg}</g>`;
}

export function renderWorkflowSvg(graph: FlatGraph, title: string): string {
  const layoutGraph = createLayoutGraph(graph);
  const width = Math.max(320, (layoutGraph.graph().width ?? 0) + 24);
  const graphHeight = layoutGraph.graph().height ?? 0;
  const height = Math.max(220, graphHeight + TITLE_HEIGHT + 24);
  const edges = layoutGraph.edges().map((edge) => renderEdge(layoutGraph.edge(edge))).join("\n    ");
  const nodes = layoutGraph.nodes().map((id) => renderNode(layoutGraph.node(id))).join("\n    ");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${formatNumber(width)}" height="${formatNumber(height)}" viewBox="0 0 ${formatNumber(width)} ${formatNumber(height)}" role="img" aria-labelledby="workflow-title">
  <title id="workflow-title">${escapeXml(title)}</title>
  <defs>
    <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z"/>
    </marker>
    <style>
      text { font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 14px; fill: #17202a; }
      .workflow-heading { font-size: 19px; font-weight: 700; }
      .node.task rect { fill: #f8fafc; stroke: #334155; stroke-width: 1.5; }
      .node.switch polygon { fill: #fff7ed; stroke: #c2410c; stroke-width: 1.5; }
      .node.start circle { fill: #166534; stroke: #14532d; }
      .node.end circle:first-child { fill: #ffffff; stroke: #991b1b; stroke-width: 2; }
      .node.end circle:nth-child(2) { fill: #991b1b; stroke: #991b1b; }
      .edge path { fill: none; stroke: #64748b; stroke-width: 1.5; }
      .edge-label { font-size: 12px; fill: #475569; paint-order: stroke; stroke: #ffffff; stroke-width: 5px; }
      #arrow path { fill: #64748b; }
    </style>
  </defs>
  <text class="workflow-heading" x="24" y="32">${escapeXml(title)}</text>
  <g transform="translate(0 ${formatNumber(TITLE_HEIGHT)})">
    ${edges}
    ${nodes}
  </g>
</svg>
`;
}
