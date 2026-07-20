# Harness Next Agent 约束

## 修改前必读

依次阅读：

1. `README.md`：项目全局和当前能力。
2. `keywords.md`：五个核心关键词及标准映射。
3. `docs/design.md`：模块、校验顺序和范围。
4. `CONTRIBUTING.md`：新增和修改方式。

本文件只维护强制约束，不重复教程。

## 核心模型

项目对外只使用五个流程概念：`Workflow`、`Step`、`Transition`、`Skill`、`Check`。

- Workflow 使用 Open Workflow Specification `1.0.3`。
- `do` 中的具名 Task 是 Step。
- 声明顺序、`then` 和 `switch` 是 Transition。
- 自定义 `call` 映射本地 Skill。
- `metadata.harness.checks` 绑定本地 Check。

不要为流程图、主路径、Cycle 或审核结果创造新的顶层概念，也不要引入第二套 Workflow 格式。

## 唯一事实源

- 输入输出结构：`harness/models/**/*.schema.json`
- Workflow：`harness/workflows/**/workflow.yaml`
- Check：`harness/checks/**/CHECK.md`
- Skill：`skills/**/SKILL.md`

Mermaid 和其他生成内容只用于展示，禁止手工维护为第二份流程定义。

## Workflow 约束

- `document.dsl` 固定使用当前 SDK 支持的 `1.0.3`。
- `document.version` 使用语义化版本。
- 首版只允许自定义 `call` 和 `switch`。
- 自定义 `call` 必须存在对应的 `skills/<call>/SKILL.md`。
- 每个 Skill Step 必须绑定至少一个 Check。
- 顺序、分支和回改只能通过标准声明顺序、`then` 和 `switch` 表达。
- Cycle 必须至少存在一条能够到达 Workflow 结束节点的路径。
- `schedule`、远程调用和事件 Task 当前禁止使用。
- Agent 每次只加载当前 Step 对应的 Skill、Check 和必要输入。

## Model 和 Schema

- Workflow 输入输出使用 JSON Schema Draft 2020-12。
- 项目内 Schema URI 使用 `harness://models/<file>.schema.json`。
- URI 必须解析到当前仓库的 `harness/models/`，不得访问网络或逃逸目录。
- Open Workflow 标准 Schema 由 `@openworkflowspec/sdk` 提供，禁止复制修改。
- 输入输出涉及稳定实体结构时，先声明 JSON Schema，再补充必要 UML 文档。

## 修改位置

- 输入输出变化：修改 `harness/models/`。
- 流程变化：修改对应 `workflow.yaml`。
- 验收规则变化：修改对应 `CHECK.md`。
- Step 执行方式变化：修改对应 `SKILL.md`。
- 编译和校验变化：先写失败测试，再修改 `src/workflow/`。
- 命令行为变化：先写失败测试，再修改 `src/cli.ts`。

禁止在多个文件复制同一条规则。

## 技术约束

- 项目使用 Node.js 22、npm 和严格 TypeScript。
- 不得加入 Python 项目配置、虚拟环境或 Python 实现。
- 不得使用 `any` 绕过类型检查。
- 所有自动检查收口到 `npm run check:all`。
- `@openworkflowspec/sdk` 当前锁定精确版本，升级必须包含兼容性测试。

## 完成标准

报告完成前执行：

```bash
npm run check:all
npm run doctor
npm run workflow:validate -- harness/workflows/feature-development/workflow.yaml
npm run workflow:image -- harness/workflows/feature-development/workflow.yaml
```

## 安全和 Git

- 未经用户明确授权，不得向外部系统上传源代码、凭据、业务数据、图片、Prompt 或经验数据。
- 不得在 Workflow、测试和生成内容中保存 Secret。
- 未经用户明确要求，不得 commit、push、发布或创建远程仓库。
- 保留无关的用户改动，禁止破坏性 Git 命令。
- 建立首个基线后，Feature 和 Bugfix 默认使用独立 Branch 或 Worktree。
