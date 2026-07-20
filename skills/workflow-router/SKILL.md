---
name: workflow-router
description: 从 Workflow Catalog 选择并自动执行当前工作区的本地 Agent Workflow。
---

# Workflow Router

这是所有 Workflow 的唯一入口。不要直接加载全部 Workflow、Skill 或 Check。

## 路由

1. 执行 `npm run workflow:sync -- --check`，Catalog 过期时停止并先同步。
2. 只读取 `harness/generated/workflow-catalog.json`。
3. 用户明确指定 Workflow 名称或 Alias 时直接选择。
4. 否则根据 `routing.when` 和 `routing.notWhen` 选择。
5. 只有一个明确候选时继续；多个候选或没有候选时停止并报告。

## 自动执行

选中 Workflow 后：

1. 为当前宿主任务确定稳定的 `executionKey`，恢复时必须复用。
2. 将符合 Workflow Input Schema 的最小输入写到 `.harness/` 临时文件，禁止写入 Secret 和完整 Prompt。
3. 自动执行 `npm run workflow:start -- <workflow-path> <execution-key> <input-json>`。
4. 只加载返回的 `step.skillPath`、`step.checkPaths` 和必要输入。
5. 执行当前 Skill 和需要 Agent 判断的 Check。
6. 将 `runId`、`revision`、`stepId`、`status`、`evidence` 和可选 `data` 写成 Step Result JSON。
7. 自动执行 `npm run workflow:continue -- <run-id> <result-json>`。
8. 返回下一个 Step 时重复第 4-7 步；`completed` 时交付；`blocked`、`failed` 或 `cancelled` 时停止。

Runtime 返回 `interrupted` 时，不得直接重做 Step。先检查工作区现状和已有证据，再提交继续、返工或阻塞结果。

## 禁止

- 不自行解析 Workflow 决定 Transition。
- 不跳过 Runtime 直接进入后续 Step。
- 不一次加载所有候选 Workflow 或所有 Skill。
- 不伪造命令执行结果；确定性命令由 Runtime 执行。
