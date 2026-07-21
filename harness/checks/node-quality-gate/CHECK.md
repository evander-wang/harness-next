---
commands:
  - command: node
    args: [dist/cli.js, project-check]
    cwd: harness
  - command: git
    args: [diff, --check]
    cwd: workspace
---

# node-quality-gate

`project-check` 自动识别 npm、Yarn 或 pnpm，并依次执行目标项目的 Typecheck、Lint、Test 和 Build。全部退出码为 `0` 时保留 Agent 的检查状态；任一命令失败时，Runtime 将当前结果视为 `needs_changes` 并返回实现 Step。

状态记录只保存命令、参数、退出码、耗时和输出 Digest，不保存完整输出。
