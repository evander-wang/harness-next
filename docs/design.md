# Harness Next 设计

## 设计目标

让标准 `workflow.yaml` 成为本地 Agent 流程的唯一事实源。贡献者修改流程时只需要找到对应 Step、Skill、Check 或 Model，不需要理解一套自研调度系统。

## 核心决定

1. Workflow 完全采用 Open Workflow Specification，不维护第二套流程格式。
2. 自定义 `call` 映射本地 Skill，`metadata.harness.checks` 绑定本地 Check。
3. Open Workflow SDK 只作为内部实现依赖，不把 SDK 类型扩散到 CLI 和目录约定。
4. 所有 Workflow、Skill、Check 和 Model 都从当前工作区读取，不访问远程执行目标。

## 模块结构

```text
workflow.yaml
      │
      ▼
compileWorkflow()
├── Open Workflow 标准校验
├── Harness 本地约束校验
├── 有向图静态检查
└── Mermaid 生成
      │
      ├── diagnostics
      ├── workflow
      ├── graph
      └── mermaid
            │
            ▼
  renderWorkflowSvg(graph)
            │
            ▼
           SVG
```

`compileWorkflow()` 是主要 Interface。调用方不需要分别理解 YAML 解析、SDK、图算法和本地路径约定。

Mermaid 和 SVG Renderer 使用同一个 `FlatGraph`。SVG 使用 Dagre 在本地完成布局，不依赖浏览器或远程渲染服务。

## 校验顺序

1. 解析 YAML 或 JSON。
2. 使用 SDK 校验 Open Workflow `1.0.3` 结构。
3. 拒绝 `schedule` 和远程调用 Task。
4. 校验自定义 `call` 对应的 Skill 是否存在。
5. 校验每个 Skill Step 是否绑定 Check，以及 Check 是否存在。
6. 构建有向图。
7. 检查不可达 Step。
8. 从结束节点反向检查每条执行路径是否可以结束。

Cycle 是合法结构。只有整个 Cycle 没有任何结束路径时才报错。

## 数据结构

Workflow 和 Step 的输入输出遵循 Open Workflow 的 `input.schema`、`output.schema`。项目内外部 Schema 使用 `harness://models/` URI，并固定解析到当前仓库的 `harness/models/`。

这种 URI 不包含机器绝对路径，不访问网络，也不能逃逸到 `harness/models/` 之外。

## 当前执行范围

首版支持：

- 自定义 `call`；
- `switch`；
- 声明顺序；
- `then` 跳转和回改 Cycle；
- Workflow 输入输出 JSON Schema 校验。

首版不支持：

- `schedule`；
- HTTP、gRPC、OpenAPI、AsyncAPI、MCP、A2A；
- `listen`、`emit` 等事件 Task；
- `for`、`fork`、`try` 的本地执行；
- Agent 调用、Skill 执行和运行时表达式求值。

只有出现明确本地使用场景、执行语义和测试后，才扩大允许的标准 Task 子集。
