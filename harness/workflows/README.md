# Workflow

每个 Workflow 使用一个独立目录：

```text
harness/workflows/<workflow-name>/workflow.yaml
```

`workflow.yaml` 必须符合 Open Workflow Specification `1.0.3`，它是流程的唯一事实源。

首版使用：

- `do` 声明 Step；
- 自定义 `call` 绑定本地 Skill；
- `metadata.harness.checks` 按需绑定 Check；
- 声明顺序、`then` 和 `switch` 表达 Transition。

固定流转的 Skill Step 可以没有业务输入输出和 Check。Skill Step 进入 `switch` 前必须绑定 Check，避免根据自由文本猜测分支。

需要 Router 自动选择的 Workflow 在 `document.metadata.harness.routing` 声明：

```yaml
metadata:
  harness:
    routing:
      aliases: [typescript-development]
      when: [修改 Node.js TypeScript 功能]
      notWhen: [只解释代码而不修改]
    execution:
      maxStepAttempts: 3
```

新增或修改 Workflow 后执行 `npm run workflow:sync`。Catalog 只用于路由，禁止手工编辑。

参考 `feature-development/workflow.yaml`。流程图由 CLI 从该文件生成，禁止维护第二份手工流程图。
