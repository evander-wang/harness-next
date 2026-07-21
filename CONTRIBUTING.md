# Harness Next 贡献指南

## 修改前

```bash
npm install
npm run project:check
npm run check:all
npm run doctor
```

依次阅读 `README.md`、`keywords.md`、`docs/design.md` 和目标 Workflow。

## 新增 Workflow

1. 需要稳定业务输入输出时，在 `harness/models/` 新增 JSON Schema；没有业务数据时省略。
2. 创建 `harness/workflows/<workflow-name>/workflow.yaml`。
3. 使用 Open Workflow Specification `1.0.3` 声明 `document` 和 `do`，按需声明 `input`、`output`。
4. 在 `document.metadata.harness.routing` 声明 Alias、适用场景和排除场景。
5. 使用自定义 `call` 绑定本地 Skill。
6. 固定流转可以不绑定 Check；进入 `switch` 前必须在 `metadata.harness.checks` 中绑定 Check。
7. 使用声明顺序、`then` 和 `switch` 表达流程；`when` 只允许比较标准 Check 状态。
8. 为主流程、所有分支、回改 Cycle 和错误声明添加测试。
9. 执行 `npm run workflow:sync` 更新 Catalog。
10. 执行 `workflow:validate`、`workflow:diagram` 和 `workflow:image` 检查结果。

初始化或规范化 Node.js TypeScript 工程时参考 `node-project-configuration/workflow.yaml`。Input 的 `projectRoot` 指定本地目标目录，默认为当前目录；`project-check` 自动识别 npm、Yarn 或 pnpm。

以 `harness/workflows/feature-development/workflow.yaml` 为最小参考，不要复制一套新的 DSL。

## 修改位置

| 修改内容 | 修改位置 |
| --- | --- |
| Workflow 输入输出 | `harness/models/` |
| Step 和 Transition | 对应的 `workflow.yaml` |
| Step 执行方法 | `skills/<skill-id>/SKILL.md` |
| Step 验收规则 | `harness/checks/<check-id>/CHECK.md` |
| Workflow 路由索引 | 执行 `npm run workflow:sync`，禁止手工修改 Catalog |
| 本地运行状态和跳转 | `src/workflow/runtime.ts` |
| Check 命令执行 | `src/workflow/checks.ts` |
| 包管理器识别和 Node.js 项目门禁 | `src/node-project/` |
| 标准解析和本地校验 | `src/workflow/compiler.ts` |
| CLI | `src/cli.ts` |

Open Workflow 的标准 Schema 由 `@openworkflowspec/sdk` 提供，禁止复制后手工维护。

## 开发要求

- 生产行为修改前先写失败测试，并确认失败原因正确。
- 所有 TypeScript 必须通过严格类型检查。
- 不使用 `any` 绕过模型问题。
- 不在多个文件复制同一条流程规则。
- 生成的 Mermaid 和 SVG 只用于展示，不能反向成为事实源。

## 完成验证

```bash
npm run check:all
npm run doctor
npm run workflow:sync
npm run workflow:validate -- harness/workflows/feature-development/workflow.yaml
npm run workflow:validate -- harness/workflows/node-typescript-development/workflow.yaml
npm run workflow:validate -- harness/workflows/node-project-configuration/workflow.yaml
npm run workflow:diagram -- harness/workflows/feature-development/workflow.yaml
npm run workflow:image -- harness/workflows/node-typescript-development/workflow.yaml
npm run workflow:image -- harness/workflows/node-project-configuration/workflow.yaml
```
