---
name: by-knowledge-manager
description: "仅通过 Python CLI 管理 ByClaw 知识库内容。用于浏览、新建、重命名或删除知识库目录，检查上传冲突，导入或更新知识库文件，触发或查询知识构建，下载、分行读取或删除文件，以及在一个或多个知识库资源 ID 中执行语义切片检索或文件检索。不用于管理本体对象库，也不处理本体、对象、对象类型或对象关系。"
---

# 管理 ByClaw 知识库

只通过本技能自带的 Python CLI 管理知识库目录、文件和检索结果。通过后端服务发现调用 `datasetController`，不得直接调用 ByQA 接口。

## 准备运行环境

使用已安装 `by-framework` 的 Python 3.12 运行环境。CLI 从 Redis 读取当前用户登录态，并通过 `BE_DOMAINNAME` 发现后端服务。

先读取实时命令清单，并把返回的 JSON 帮助视为命令语法的唯一依据：

```bash
python3 scripts/by_knowledge_manager.py help
```

统一使用以下调用形式：

```bash
python3 scripts/by_knowledge_manager.py <command> [options]
```

上传或更新本地文件时，传入运行环境能够读取的路径：

```bash
python3 scripts/by_knowledge_manager.py upload \
  --resource-id RESOURCE_ID \
  --directory-path /目标目录 \
  --file-path /tmp/local-file.md
```

## 遵守操作规则

- 操作前确定目标知识库。用户未指定时，先要求提供 `--resource-id`，不要猜测。
- `search` 和 `search-file` 的知识库范围不明确时，先确认搜索一个还是多个知识库；搜索多个知识库时重复传入 `--resource-id`。
- 探索阶段优先使用 `list`、`read-file`、`search`、`search-file`、`build-status` 和 `download` 等只读命令。
- 修改前需要校验路径或参数时，对可变更命令使用 `--dry-run`。
- 用户未明确授权时，在执行 `delete-dir`、`remove-file` 和 `update-file` 前取得确认。
- 执行 `mkdir`、`rename-dir`、`delete-dir`、`upload`、`update-file` 或 `remove-file` 后，对目标父目录执行 `list`，确认结果符合预期。
- 允许导入任意文件类型。无法构建的格式仍可入库，后续 `build-status` 会返回 `unsupported`。
- 把 `.zip` 上传视为后端批量导入；`--directory-path` 表示 ZIP 内容的目标目录，并对返回的每个成功文件触发构建。
- `update-file` 只接受一个本地文件。远端目标路径由目标目录和本地文件名组成，因此本地文件名必须与待更新文件名一致。
- 单资源请求会自动携带 `X-BYCLAW-RESOURCE-ID`。单知识库检索也会携带；多知识库检索没有唯一资源 ID，只在请求体中传递 `resourceIdList`。
- 原样保留知识库绝对路径，例如 `/`、`/产品资料`、`/产品资料/a.md`。
- 用自然语言汇报 CLI JSON 结果，重点说明 `ok`、`action`、目录或文件路径、冲突路径、构建状态、下载输出路径和检索命中项。

## 浏览目录

先列出目录，再进行上传、删除或重命名：

```bash
python3 scripts/by_knowledge_manager.py list --resource-id RESOURCE_ID --directory-path /
```

## 新建或重命名目录

新建目录：

```bash
python3 scripts/by_knowledge_manager.py mkdir \
  --resource-id RESOURCE_ID \
  --directory-path / \
  --directory-name 产品资料
```

重命名目录：

```bash
python3 scripts/by_knowledge_manager.py rename-dir \
  --resource-id RESOURCE_ID \
  --directory-path /产品资料 \
  --directory-name 产品手册
```

完成后列出父目录，确认新目录存在且旧名称已消失。

## 导入新文件

用户没有明确要求覆盖时，先检查同名冲突：

```bash
python3 scripts/by_knowledge_manager.py check-conflicts \
  --resource-id RESOURCE_ID \
  --directory-path /产品资料 \
  --file-name a.md
```

重复传入 `--file-path` 可一次上传多个文件。上传成功后，CLI 会对后端返回的成功文件自动触发构建：

```bash
python3 scripts/by_knowledge_manager.py upload \
  --resource-id RESOURCE_ID \
  --directory-path /产品资料 \
  --file-path /tmp/a.md \
  --check-conflicts
```

只在需要把 YAML 前置元数据当作普通正文保留时传入 `--process-front-matter false`。

导入 ZIP 并保留其中的目录结构：

```bash
python3 scripts/by_knowledge_manager.py upload \
  --resource-id RESOURCE_ID \
  --directory-path /产品资料 \
  --file-path /tmp/docs.zip
```

## 更新已有文件

只在明确替换已有文件时使用 `update-file`。CLI 调用后端专用更新接口，并在更新成功后重新触发构建：

```bash
python3 scripts/by_knowledge_manager.py update-file \
  --resource-id RESOURCE_ID \
  --directory-path /产品资料 \
  --file-path /tmp/a.md
```

完成后列出目标目录，确认文件仍存在。

## 构建并查询状态

触发指定文件的异步知识构建：

```bash
python3 scripts/by_knowledge_manager.py build \
  --resource-id RESOURCE_ID \
  --file-path /产品资料/a.md
```

查询构建状态：

```bash
python3 scripts/by_knowledge_manager.py build-status \
  --resource-id RESOURCE_ID \
  --file-path /产品资料/a.md
```

上传或更新后，如果用户关心检索是否就绪，继续查询构建状态。异步受理不能表述为构建已完成。

## 下载或读取文件

下载文件：

```bash
python3 scripts/by_knowledge_manager.py download \
  --resource-id RESOURCE_ID \
  --file-path /产品资料/a.md \
  --output /tmp/a.md
```

下载目录压缩包：

```bash
python3 scripts/by_knowledge_manager.py download \
  --resource-id RESOURCE_ID \
  --directory-path /产品资料 \
  --output /tmp/产品资料.zip
```

按行读取文件：

```bash
python3 scripts/by_knowledge_manager.py read-file \
  --resource-id RESOURCE_ID \
  --file-path /产品资料/a.md \
  --start-line 1 \
  --end-line 80
```

检索命中后，使用 `read-file` 扩大命中行附近的阅读范围。

## 执行语义切片检索

搜索一个知识库：

```bash
python3 scripts/by_knowledge_manager.py search \
  --resource-id RESOURCE_ID \
  --query "员工请假流程是什么" \
  --top-k 5
```

搜索多个知识库：

```bash
python3 scripts/by_knowledge_manager.py search \
  --resource-id RESOURCE_ID_A \
  --resource-id RESOURCE_ID_B \
  --query "员工请假流程是什么" \
  --top-k 10
```

把每个结果解释为切片命中，字段包括 `resourceId`、`filePath`、`chunkNo`、`chunkText`、`score`，以及可选的 `startLine`、`endLine` 和 `imagePath`。按文件路径和行范围引用或概述结果。

## 执行语义文件检索

只需要先找相关文件时使用 `search-file`：

```bash
python3 scripts/by_knowledge_manager.py search-file \
  --resource-id RESOURCE_ID \
  --query "故障" \
  --top-k 10
```

搜索多个知识库时重复传入 `--resource-id`。把结果解释为文件命中，字段包括 `resourceId`、`filePath`、`score` 和可选的 `metadata`；需要深入查看时继续使用 `read-file` 或 `download`。

## 删除内容

删除文件：

```bash
python3 scripts/by_knowledge_manager.py remove-file \
  --resource-id RESOURCE_ID \
  --file-path /产品资料/a.md
```

删除目录：

```bash
python3 scripts/by_knowledge_manager.py delete-dir \
  --resource-id RESOURCE_ID \
  --directory-path /产品资料
```

删除目录前先列出父目录并说明将删除的范围；删除后再次列出父目录，确认目标已消失。

## 处理故障

- CLI 返回 `{ "ok": false, "error": "..." }` 时，先修正路径、资源 ID、本地文件路径或认证环境；只在重试安全时再次执行。
- 提示本地文件不存在时，确认 `--file-path` 对当前运行环境可读。
- 上传或更新后检索不到内容时，先执行 `build-status`；文件可能仍在构建中。
- 服务发现或认证失败时，检查 `BE_DOMAINNAME`、`USER_CODE` 和 Redis 连接变量。不要改用直连 ByQA 或主机 URL 绕过服务发现。
