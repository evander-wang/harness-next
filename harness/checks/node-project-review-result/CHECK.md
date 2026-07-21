# node-project-review-result

检查实际配置是否满足已通过的 `NodeProjectProfile`。

通过必须同时满足：

- 确定性质量门禁已经通过；
- npm、Yarn 或 pnpm 声明与唯一根 Lockfile 一致；
- Node.js Major、scripts、TypeScript、ESLint、测试、构建、README 和 CI 相互一致；
- 新项目具备 clean install 所需的清单和 Lockfile；
- 已有项目没有未经授权的迁移、功能删除或范围外重构；
- 没有新增被 Git 跟踪的 Secret、真实凭据或本机绝对路径；
- 可选能力只在需求或已有结构需要时存在；
- Review Finding 包含文件、位置和证据，不使用笼统结论。

可修复问题返回 `needs_changes`；必须由用户或外部环境处理的问题返回 `blocked`。
