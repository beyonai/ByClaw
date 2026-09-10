---
name: project-cloud-knowledge-read
description: "只读浏览 ByClaw 知识库或项目云盘。用于列出目录、查询文件构建状态和引用关系、下载文件或目录，以及按行读取文件。"
---

# 读取知识库内容

使用父 Skill 的 Python CLI 执行只读操作。

## 浏览目录

先列出目录，再决定需要读取、下载或变更的目标：

```bash
python3 <project-cloud-knowledge目录>/scripts/project_cloud_knowledge.py list \
  --resource-id RESOURCE_ID \
  --directory-path /
```

结果中的 `fileName` 已包含远端路径，不要自行拼接重复目录。

## 查询构建状态

```bash
python3 <project-cloud-knowledge目录>/scripts/project_cloud_knowledge.py build-status \
  --resource-id RESOURCE_ID \
  --file-path /产品资料/a.md
```

`build-status` 按文件查询，不支持目录或整批状态；目录批量构建后不能用单个文件状态代表全部文件。把 `pending` 表述为“排队中”，处理中状态表述为“构建中”；`unsupported` 表示文件已入库但格式不支持知识构建。

## 查询引用关系

使用 `references` 查询一个文件被哪些文件引用（入站）以及它引用了哪些文件（出站）：

```bash
python3 <project-cloud-knowledge目录>/scripts/project_cloud_knowledge.py references \
  --resource-id RESOURCE_ID \
  --file-path /产品资料/a.md
```

默认返回双向关系；需要单向查询时传 `--direction inbound` 或 `--direction outbound`。输出只包含 `inbound`、`outbound` 两个数组，其中每项仅有相关文件的 `filePath` 与引用状态 `status`（`valid` 或 `invalid`）。

## 下载内容

下载单个文件：

```bash
python3 <project-cloud-knowledge目录>/scripts/project_cloud_knowledge.py download \
  --resource-id RESOURCE_ID \
  --file-path /产品资料/a.md \
  --output /tmp/a.md
```

下载目录压缩包：

```bash
python3 <project-cloud-knowledge目录>/scripts/project_cloud_knowledge.py download \
  --resource-id RESOURCE_ID \
  --directory-path /产品资料 \
  --output /tmp/产品资料.zip
```

`--file-path` 与 `--directory-path` 只能传一个。

## 按行读取文件

```bash
python3 <project-cloud-knowledge目录>/scripts/project_cloud_knowledge.py read-file \
  --resource-id RESOURCE_ID \
  --file-path /产品资料/a.md \
  --start-line 1 \
  --end-line 80
```

检索命中后，围绕命中行范围扩大阅读窗口。汇报内容时保留文件路径和行号。
