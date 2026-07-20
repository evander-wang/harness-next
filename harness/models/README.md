# Model

本目录保存需要稳定结构校验的 Workflow 或 Step 业务输入输出 JSON Schema Draft 2020-12 文件。没有结构化业务数据时不需要新增 Model。

```text
harness/models/<model-name>.schema.json
```

Workflow 中使用 `harness://models/<model-name>.schema.json` 引用。该 URI 只解析当前仓库文件，不访问网络。

Model 只描述数据，不负责 Workflow 顺序、分支或 Skill 执行方式。只有实体关系无法从 JSON Schema 直接理解时，才补充 UML 文档。
