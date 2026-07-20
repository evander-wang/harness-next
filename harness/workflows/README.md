# Workflow

每个 Workflow 使用一个独立目录：

```text
harness/workflows/<workflow-name>/workflow.yaml
```

`workflow.yaml` 必须符合 Open Workflow Specification `1.0.3`，它是流程的唯一事实源。

首版使用：

- `do` 声明 Step；
- 自定义 `call` 绑定本地 Skill；
- `metadata.harness.checks` 绑定 Check；
- 声明顺序、`then` 和 `switch` 表达 Transition。

参考 `feature-development/workflow.yaml`。流程图由 CLI 从该文件生成，禁止维护第二份手工流程图。
