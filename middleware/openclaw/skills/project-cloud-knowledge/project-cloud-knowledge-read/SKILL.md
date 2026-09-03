---
name: project-cloud-knowledge-read
description: "只读浏览 ByClaw 知识库或项目云盘。用于列出目录、查询文件构建状态、下载文件或目录，以及按行读取文件。"
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

把 `pending` 或处理中状态表述为仍在构建；`unsupported` 表示文件已入库但格式不支持知识构建。

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
