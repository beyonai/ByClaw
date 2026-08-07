---
name: knowledge-organizer-organize
description: 在已初始化的知识整理任务中，为选定对象提交文档对象发现。适用于用户要求识别、提取或发现文档所表达的知识对象。
allowed-tools: read, exec
---

# 发现文档对象

## 选择范围

只从初始化结果 `objects/ads/` 目录选择对象，不得使用 ODS 对象：

- 用户指定对象名称、编码或业务范围时，选择匹配的 ADS 对象；交互任务仍有实质歧义时再询问用户。
- 用户未指定任何范围时，选择当前获取到的**全部 ADS 对象**。
- 后台任务不要为对象范围逐项确认；按以上规则直接推进，并在最终汇报中列出实际提交的对象。

此操作不要求先登记文件，也不能自动执行 `ingest`。

## 执行

用户指定范围时，每个所选 ADS 对象分别传入一个 `--object-code`：

```bash
python3 <技能目录>/scripts/knowledge_organizer.py organize \
  --task-dir "<任务目录>" \
  --object-code "<对象编码1>" \
  --object-code "<对象编码2>"
```

用户未指定范围时省略 `--object-code`，由 CLI 提交当前全部 ADS 对象：

```bash
python3 <技能目录>/scripts/knowledge_organizer.py organize \
  --task-dir "<任务目录>"
```

## 完成标准

只有命令确认受理时，才算提交成功。汇报所选对象，并明确说明发现任务**已提交**。不要声称后台发现已经完成，也不要自动执行知识丰富。
