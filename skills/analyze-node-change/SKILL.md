---
name: analyze-node-change
description: 分析 Node.js TypeScript 变更的目标、范围、依赖、风险和验证方式。
---

# 分析 Node.js TypeScript 变更

完整阅读相关模块、项目约束、配置和测试，不依赖搜索片段做大范围判断。

涉及外部库时检查当前安装版本的导出、类型声明和官方用法，不猜测 Interface。

输出目标、范围内事项、范围外事项、预计修改文件、兼容性影响、风险和验证命令。只分析，不修改代码。
