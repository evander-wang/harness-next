---
version: "1.0.0"
scope:
  includeDirectories: [src]
  excludeDirectories: [node_modules, dist, coverage, test, tests, __tests__]
limits:
  maxLineLength: 120
  maxFunctionLines: 80
  maxFileLines: 600
  maxCyclomaticComplexity: 10
---

# Node.js TypeScript 开发规范

## 强制约束

1. 模块按单一变化原因组织；业务规则不得直接依赖 HTTP、数据库、文件系统或队列。
2. 只有存在真实可替换需求时才定义 Interface 和 Adapter；禁止为模式而模式。
3. 外部输入必须在边界处完成运行时校验；核心业务规则应保持可单测。
4. 禁止 `any`、无依据的类型断言、吞没异常和未处理的 Promise。
5. 行宽不得超过 120 个字符；函数不得超过 80 行；生产文件不得超过 600 行；圈复杂度不得超过 10。
6. 行为变化必须先有失败测试，再完成最小实现并保留回归测试。

## 例外

超出行数或复杂度上限时，必须先拆分；确有必要时在最小作用域留下原因和后续拆分计划。
