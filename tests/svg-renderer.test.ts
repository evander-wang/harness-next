import { GraphNodeType, type FlatGraph } from "@openworkflowspec/sdk";
import { describe, expect, test } from "vitest";

import { renderWorkflowSvg } from "../src/workflow/svg-renderer.js";

describe("renderWorkflowSvg", () => {
  test("将 Workflow 有向图渲染为安全的 SVG", () => {
    const graph: FlatGraph = {
      id: "root",
      type: GraphNodeType.Root,
      nodes: [
        { id: "start", type: GraphNodeType.Start, label: "开始" },
        { id: "review", type: GraphNodeType.Call, label: "审核 A & B" },
        { id: "decision", type: GraphNodeType.Switch, label: "是否通过" },
        { id: "end", type: GraphNodeType.End, label: "结束" },
      ],
      edges: [
        { id: "start-review", sourceId: "start", targetId: "review" },
        { id: "review-decision", sourceId: "review", targetId: "decision" },
        {
          id: "decision-end",
          sourceId: "decision",
          targetId: "end",
          label: "passed <script>",
        },
      ],
    };

    const svg = renderWorkflowSvg(graph, "功能开发 <Workflow>");

    expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain("功能开发 &lt;Workflow&gt;");
    expect(svg).toContain("审核 A &amp; B");
    expect(svg).toContain("passed &lt;script&gt;");
    expect(svg).toContain('marker-end="url(#arrow)"');
    expect(svg).not.toContain("<script>");
  });
});
