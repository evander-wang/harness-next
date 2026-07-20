# Skill

每个 Skill 使用独立目录：

```text
skills/<skill-id>/SKILL.md
```

Workflow 中的自定义 `call` 值就是 Skill ID。Agent 执行当前 Step 时只加载对应 `SKILL.md`、可选的 Check 和必要输入。

Skill 的业务输入和输出都可以省略。没有 Check 的固定流转 Step 在 Skill 正常完成后视为 `passed`，并记录执行证据；配置 Check 时由 Check 返回 `passed`、`needs_changes` 或 `blocked`。

Skill 不得自行决定或执行后续 Step。

## Workflow 入口

`skills/workflow-router/SKILL.md` 是唯一 Workflow 入口。它只读取生成的 Catalog，选择一个 Workflow，并自动调用本地 Runtime。

普通 Step Skill 不对用户承诺完整流程，也不得绕过 Runtime 加载后续 Skill。
