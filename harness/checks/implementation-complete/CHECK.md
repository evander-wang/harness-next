# implementation-complete

确认实现没有超出已审核范围，并包含与风险相称的测试、类型检查、Lint 和构建证据。

存在失败验证、遗漏范围或无法说明的改动时返回 `needs_changes`，无法继续时返回 `blocked`，其余情况返回 `passed`。结果必须包含 `evidence`。
