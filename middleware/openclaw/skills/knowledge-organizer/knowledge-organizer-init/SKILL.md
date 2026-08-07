---
name: knowledge-organizer-init
description: Use when a knowledge-organizer task needs a fresh authorized ODS/ADS object snapshot or a user has restricted the object scope before ingestion or organization.
allowed-tools: read, exec
---

# 初始化知识整理任务

只负责创建任务状态和授权对象快照，不读取或写入用户文档，不抽取碎片，不提交构建。

## 前置条件

确认 `USER_CODE`、`BE_DOMAINNAME`、`DATACLOUD_DOMAINNAME` 已配置，当前上下文存在数字员工资源 ID，并生成全新的语义化任务目录。不得复用已有 `knowledge-organizer/state.json`。

## 执行

```bash
python3 <knowledge-organizer>/scripts/knowledge_organizer.py init \
  --task-dir "{完整任务目录}" \
  --digital-employee-resource-id "{数字员工资源ID}"
```

CLI 查询授权对象详情，仅保存 `objectCode`、`objectName`、`objectDesc`、`properties`，并按 `ods`/`ads` 域写入任务目录。授权对象缺失、对象详情失败、域缺失或未同时包含 ODS 与 ADS 时立即终止。

## 完成标准

只有命令成功退出并生成 `knowledge-organizer/state.json`，且状态中同时存在 ODS、ADS 对象快照，才可进入 `knowledge-organizer-ingest` 或 `knowledge-organizer-organize`。失败只能报告原始错误。
