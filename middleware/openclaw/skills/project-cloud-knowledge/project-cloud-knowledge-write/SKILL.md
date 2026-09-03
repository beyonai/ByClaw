---
name: project-cloud-knowledge-write
description: "变更 ByClaw 知识库或项目云盘目录和文件。用于创建、重命名或删除目录，检查上传冲突，上传或更新文件与 ZIP，触发构建，以及删除文件。"
---

# 变更知识库内容

使用父 Skill 的 Python CLI 执行变更。修改前列出目标或父目录；修改后再次列出并核对结果。

本子 Skill 的所有命令都支持可选参数 `--session-id SESSION_ID`。当前任务上下文存在会话 ID 时，必须显式传入 `--session-id`，不得省略，也不得依赖运行环境代为发现，以便向对应会话空间发送文件变更通知。只有当前任务上下文没有会话 ID 时才可省略；此时知识库变更照常执行，但不会发送 `X-CHAT-SESSION-ID`，也不会向会话空间发送文件变更通知。`--dry-run` 不发起变更请求。

## 控制变更风险

- 用户未明确授权时，在执行 `delete-dir`、`remove-file` 和 `update-file` 前取得确认。
- 参数或路径不确定时先加 `--dry-run`，确认计划后再执行真实请求。
- 允许上传任意文件类型；不支持构建的格式仍可入库。
- ZIP 上传表示后端批量导入，目标目录由 `--directory-path` 指定。

## 保护系统实体目录

禁止通过目录创建或重命名、文件上传或更新、ZIP 批量导入，把任何目录或文件保存到 `/KnowledgeEntity` 或其子目录。这个目录只存在系统整理出来的知识实体文件，普通资料和用户创建的目录不能混入。

Python CLI 会在请求后端前强制校验最终路径和 ZIP 内部条目，`--dry-run` 也不能绕过。校验失败时更换目标目录；不得绕过 CLI 调用其他接口写入。

## 管理目录

新建目录：

```bash
python3 <project-cloud-knowledge目录>/scripts/project_cloud_knowledge.py mkdir \
  --session-id SESSION_ID \
  --resource-id RESOURCE_ID \
  --directory-path / \
  --directory-name 产品资料
```

重命名目录：

```bash
python3 <project-cloud-knowledge目录>/scripts/project_cloud_knowledge.py rename-dir \
  --session-id SESSION_ID \
  --resource-id RESOURCE_ID \
  --directory-path /产品资料 \
  --directory-name 产品手册
```

删除目录：

```bash
python3 <project-cloud-knowledge目录>/scripts/project_cloud_knowledge.py delete-dir \
  --session-id SESSION_ID \
  --resource-id RESOURCE_ID \
  --directory-path /产品手册
```

## 上传新文件

需要预检同名文件时：

```bash
python3 <project-cloud-knowledge目录>/scripts/project_cloud_knowledge.py check-conflicts \
  --session-id SESSION_ID \
  --resource-id RESOURCE_ID \
  --directory-path /产品资料 \
  --file-name a.md
```

上传一个或多个文件时重复传入 `--file-path`：

```bash
python3 <project-cloud-knowledge目录>/scripts/project_cloud_knowledge.py upload \
  --session-id SESSION_ID \
  --resource-id RESOURCE_ID \
  --directory-path /产品资料 \
  --file-path /tmp/a.md \
  --file-path /tmp/b.pdf \
  --check-conflicts
```

上传 ZIP：

```bash
python3 <project-cloud-knowledge目录>/scripts/project_cloud_knowledge.py upload \
  --session-id SESSION_ID \
  --resource-id RESOURCE_ID \
  --directory-path /产品资料 \
  --file-path /tmp/docs.zip
```

上传成功后 CLI 会对后端返回的每个文件触发构建。

## 更新已有文件

`update-file` 只接受一个本地文件。本地文件名必须与待更新的远端文件名一致：

```bash
python3 <project-cloud-knowledge目录>/scripts/project_cloud_knowledge.py update-file \
  --session-id SESSION_ID \
  --resource-id RESOURCE_ID \
  --directory-path /产品资料 \
  --file-path /tmp/a.md
```

更新成功后 CLI 会重新触发构建。

## 构建或删除文件

触发构建：

```bash
python3 <project-cloud-knowledge目录>/scripts/project_cloud_knowledge.py build \
  --session-id SESSION_ID \
  --resource-id RESOURCE_ID \
  --file-path /产品资料/a.md
```

删除文件：

```bash
python3 <project-cloud-knowledge目录>/scripts/project_cloud_knowledge.py remove-file \
  --session-id SESSION_ID \
  --resource-id RESOURCE_ID \
  --file-path /产品资料/a.md
```

构建请求成功只表示异步任务已受理，不表示构建完成。需要确认就绪时读取只读子 Skill 并查询 `build-status`。
