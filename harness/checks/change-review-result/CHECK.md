# change-review-result

确认 Review 基于实际需求、Diff、测试和 Runtime 命令证据，并检查正确性、回归、范围、兼容性、依赖和生成物。

没有阻断性交付问题时返回 `passed`；存在可在当前范围修复的问题时返回 `needs_changes`；缺少用户决定或外部条件时返回 `blocked`。必须包含具体 `evidence`。
