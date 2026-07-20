# Check

每个 Check 使用独立目录：

```text
harness/checks/<check-id>/CHECK.md
```

Workflow 使用 `metadata.harness.checks` 按 Check ID 引用。固定流转的 Skill Step 可以没有 Check；Skill Step 进入 `switch` 前必须绑定至少一个 Check。

Check 必须说明检查对象、通过条件、失败条件，并返回统一格式：

```yaml
status: passed | needs_changes | blocked
evidence:
  - 可核对的依据
data: {} # 可选业务数据
```

能够稳定程序化判断的规则优先写成代码测试。需要 Agent 判断的 Check 不能只给出模糊结论。

## 确定性命令

需要 Runtime 执行命令时，在 `CHECK.md` Front Matter 中使用结构化声明：

```yaml
---
commands:
  - command: npm
    args: [run, typecheck]
  - command: git
    args: [diff, --check]
---
```

禁止写 `npm run lint && npm test` 等 Shell 字符串。Runtime 使用 `shell: false` 执行，只保存退出码、耗时和输出 Digest。
