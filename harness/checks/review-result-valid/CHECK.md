# review-result-valid

确认审核结果包含明确的 `status`、可核对的 `evidence`，以及在 `needs_changes` 时存在具体 `issues`。

结构完整且需求可以进入实现时返回 `passed`；需要补充时返回 `needs_changes`；缺少外部条件而无法继续时返回 `blocked`。
