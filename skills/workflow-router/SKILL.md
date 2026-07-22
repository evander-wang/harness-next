---
name: workflow-router
description: 从 Workflow Catalog 选择并自动执行当前工作区的本地 Agent Workflow。
---

# Workflow Router

这是所有 Workflow 的唯一入口。不要直接加载全部 Workflow、Skill 或 Check。

## 路由

1. 执行 `npm run workflow:activate -- --check`，按当前 Catalog 的 `mode` 校验它是否过期；过期时停止并执行对应的生成命令。
2. 只读取 `harness/generated/workflow-catalog.json`。
3. 只从 Catalog 的 `entryWorkflows` 中选择 Workflow；`workflows` 中但不在 `entryWorkflows` 的项只能作为前置依赖，不能被用户直接选择。
4. 用户明确指定 Workflow 名称或 Alias 时直接选择。
5. 否则根据 `routing.when` 和 `routing.notWhen` 选择。
6. 只有一个明确候选时继续；多个候选或没有候选时停止并报告。

## 自动执行

选中 Workflow 后：

1. 从 Catalog 的 `prerequisites` 递归解析前置 Workflow，按依赖顺序去重后串行执行；不得并行启动。
2. 为当前宿主任务确定稳定的 `executionKey`，恢复时必须复用；前置 Workflow 使用派生 Key `<executionKey>:prerequisite:<workflow-name>`。
3. 先将每个前置 Workflow 执行到 `completed`。没有 `input` Schema 的前置 Workflow 使用 `{}` 作为输入；前置 Workflow 的 Skill 读取到的上下文保留在当前 Agent 任务中。任一前置 Workflow `blocked`、`failed` 或 `cancelled` 时停止，不启动目标 Workflow。
4. 将目标 Workflow Input Schema 要求的最小输入写到 `.harness/` 临时文件，禁止写入 Secret 和完整 Prompt。项目配置 Workflow 必须写入明确的 `projectRoot`，默认值为 `.`。
5. 自动执行 `npm run workflow:start -- <workflow-path> <execution-key> <input-json>`。
6. 只加载返回的 `step.skillPath`、`step.checkPaths` 和必要输入。
7. 执行当前 Skill 和需要 Agent 判断的 Check。
8. 将 `runId`、`revision`、`stepId`、`status`、`evidence` 和可选 `data` 写成 Step Result JSON。
9. 自动执行 `npm run workflow:continue -- <run-id> <result-json>`。
10. 返回下一个 Step 时重复第 6-9 步；`completed` 时交付；`blocked`、`failed` 或 `cancelled` 时停止。

Runtime 返回 `interrupted` 时，不得直接重做 Step。先检查工作区现状和已有证据，再提交继续、返工或阻塞结果。

恢复一个目标 Workflow 前，如其已完成的前置 Workflow 用于加载 Agent 上下文，必须重新读取该前置 Workflow 的上下文文件后再继续目标 Workflow。

`workflow:start` 会从 Input 的 `projectRoot` 固化目标项目目录。Skill 修改目标项目，Workflow、Skill、Check 和 Run 状态仍从 Harness 根目录加载；禁止在恢复时切换目标目录。

## 禁止

- 不自行解析 Workflow 决定 Transition。
- 不跳过 Runtime 直接进入后续 Step。
- 不一次加载所有候选 Workflow 或所有 Skill。
- 不伪造命令执行结果；确定性命令由 Runtime 执行。
