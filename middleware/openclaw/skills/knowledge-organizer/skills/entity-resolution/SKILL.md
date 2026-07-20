---
name: entity-resolution
description: Use when resolving newly organized documents for one ontology object against knowledge-base candidates before deciding whether to create or merge instances.
---

# 实例消解

在 `knowledge-organizer` 的对象级子 agent 中使用。本 skill 一次只处理一个 `{对象名称}`，不得读取、修改或推断其他对象目录。

## 输入与边界

- 新建文档：`{任务目录}/新建对象/{对象名称}/`
- 候选文档：`{任务目录}/知识库候选/{对象名称}/`
- 融合输出由后续 `doc-fusion` 写入：`{任务目录}/融合结果/{对象名称}/`
- 所有知识库候选必须下载到“知识库候选”目录；不得写入“新建对象”或“融合结果”。

## 执行

1. 判定 identity 字段：依次使用 `businessKey=1` 字段、`name`、`title`、第一个必填字符串字段。
2. 对“新建对象”目录运行 `er_resolve.py`，传入对象类型、identity 字段、KB ID 与 resource ID。`<knowledge-organizer>` 在执行时解析为本父 skill 的目录：

   ```bash
   python3 <knowledge-organizer>/scripts/er_resolve.py \
     --doc-dir {任务目录}/新建对象/{对象名称} \
     --object-type {object_type} \
     --identity-fields {identity_fields} \
     --kb-id {kb_id} \
     --kb-resource-id {kb_resource_id}
   ```

   脚本完成批内去重、term/full-text 双路召回和 RRF 排序。
3. 对需要确认的候选，用 `by-knowledge-manager read-file` 下载完整正文到“知识库候选”目录，并结合 identity 与正文核心定义判断：
   - 同名且内容同义：标记为已确认融合；
   - 不同名但内容同义：标记为待用户确认；
   - 内容不同义或无候选：标记为新建。
4. 仅将“已确认融合”的文档对交给 `doc-fusion`；待确认与新建文档保留在“新建对象”目录，不得写入“融合结果”。

## 返回主流程

完成后在子 agent 最终回复中只返回主 skill Step 5.5 规定的 Markdown 表格，不得附加说明文字。表格使用 `object_name`、`result_status`、`result_type`、`current_source_path`、`candidate_source_path`、`output_path`、`detail` 七列；`result_type` 只允许为 `new` 或 `fusion`，每个结果项一行。不执行入库，不调用 `baiying_call`，不启动其他子 agent。
