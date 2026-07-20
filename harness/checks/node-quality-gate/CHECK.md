---
commands:
  - command: npm
    args: [run, lint]
  - command: npm
    args: [run, typecheck]
  - command: npm
    args: [test]
  - command: npm
    args: [run, build]
  - command: git
    args: [diff, --check]
---

# node-quality-gate

Runtime 按顺序执行 Front Matter 中的确定性命令。全部退出码为 `0` 时保留 Agent 的检查状态；任一命令失败时，Runtime 将当前结果视为 `needs_changes` 并返回实现 Step。

状态记录只保存命令、参数、退出码、耗时和输出 Digest，不保存完整输出。
