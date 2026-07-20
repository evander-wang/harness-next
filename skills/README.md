# Skill

每个 Skill 使用独立目录：

```text
skills/<skill-id>/SKILL.md
```

Workflow 中的自定义 `call` 值就是 Skill ID。Agent 执行当前 Step 时只加载对应 `SKILL.md`、绑定的 Check 和必要输入。

Skill 必须说明输入、当前 Step 的执行方法和输出，不得自行决定或执行后续 Step。
