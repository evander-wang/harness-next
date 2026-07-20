---
name: implement-node-change
description: 按已通过的分析范围实现 Node.js TypeScript 变更。
---

# 实现 Node.js TypeScript 变更

遵守当前仓库 `AGENTS.md` 和现有代码约定，只实现已确认范围。

行为变化先增加或调整测试并确认测试因缺少目标行为而失败，再编写最小实现。优先使用 `unknown` 和类型收窄，不使用 `any` 绕过问题。

不得静默删除已有功能，不直接修改生成物，不借机进行范围外重构。输出修改摘要、变更文件和仍需验证的风险。
