# Harness Next 关键词

项目只要求贡献者理解五个核心关键词。

## Workflow

一个完整流程，对应一个标准 `workflow.yaml`：

```text
Workflow
├── document
├── input
├── do
└── output
```

`document.dsl` 是 Open Workflow DSL 版本，`document.version` 是当前业务流程版本。

## Step

`do` 中的每个具名 Task 都是一个 Step：

```yaml
do:
  - clarify-requirement:
      call: clarify-requirement
      metadata:
        harness:
          checks:
            - requirement-complete
```

首版 Step 只有两种形式：

- 自定义 `call`：执行本地 Skill；
- `switch`：根据当前数据选择后续 Step。

## Transition

Step 之间的连接方式：

- 没有 `then` 时，进入声明列表中的下一个 Step；
- `then: <step-id>` 时，进入指定 Step；
- `then: end` 时，结束 Workflow；
- `switch` 根据条件选择不同的 `then`。

回到前面的 Step 就形成 Cycle。Cycle 必须至少存在一条可以到达结束节点的路径。

## Skill

自定义 `call` 的值就是 Skill ID：

```yaml
call: clarify-requirement
```

它固定解析到：

```text
skills/clarify-requirement/SKILL.md
```

Skill 只完成当前 Step，不决定后续流程。

## Check

本地 Agent Step 必须在 `metadata.harness.checks` 中绑定至少一个 Check：

```yaml
metadata:
  harness:
    checks:
      - requirement-complete
```

它固定解析到：

```text
harness/checks/requirement-complete/CHECK.md
```

Check 必须输出明确状态和可核对证据。

## 输入和输出

Workflow 输入输出使用 JSON Schema。项目内 Schema 使用可移植 URI：

```yaml
input:
  schema:
    resource:
      endpoint: harness://models/feature-request.schema.json
```

该 URI 固定解析到 `harness/models/feature-request.schema.json`，不会访问网络。

## 命名规范

| 对象 | 格式 | 示例 |
| --- | --- | --- |
| Workflow、Step、Skill、Check ID | `kebab-case` | `review-requirement` |
| JSON 字段名 | `lowerCamelCase` | `maxAttempts` |
| Check 状态 | `snake_case` | `needs_changes` |
