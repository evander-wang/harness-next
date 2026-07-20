# Check

每个 Check 使用独立目录：

```text
harness/checks/<check-id>/CHECK.md
```

Workflow 使用 `metadata.harness.checks` 按 Check ID 引用。Check 必须说明检查对象、通过条件、失败条件和需要提供的证据。

能够稳定程序化判断的规则优先写成代码测试。需要 Agent 判断的 Check 必须返回明确状态和可核对证据，不能只给出模糊结论。
