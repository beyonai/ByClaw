---
name: knowledge-organizer-build
description: 在已初始化的知识整理任务中，为选定对象提交知识丰富与构建。适用于用户要求丰富、融合、整理或构建对象知识。
allowed-tools: read, exec
---

# 丰富对象知识

## 选择范围

只从初始化结果 `objects/ads/` 目录选择对象，不得使用 ODS 对象：

- 用户指定对象名称、编码或业务范围时，选择匹配的 ADS 对象；交互任务仍有实质歧义时再询问用户。
- 用户未指定任何范围时，选择当前获取到的**全部 ADS 对象**。
- 后台任务不要为对象范围逐项确认；按以上规则直接推进，并在最终汇报中列出实际提交的对象。

此操作不要求先登记文件或发现对象，也不能自动执行这些操作。

## 执行

用户指定范围时，每个所选 ADS 对象分别传入一个 `--object-code`：

```bash
python3 <技能目录>/scripts/knowledge_organizer.py build \
  --task-dir "<任务目录>" \
  --object-code "<对象编码1>" \
  --object-code "<对象编码2>"
```

用户未指定范围时省略 `--object-code`，由 CLI 提交当前全部 ADS 对象：

```bash
python3 <技能目录>/scripts/knowledge_organizer.py build \
  --task-dir "<任务目录>"
```

## 完成标准

只有命令确认受理时，才算提交成功。汇报所选对象，并明确说明知识丰富任务**已提交**。不要声称后台丰富已经完成。

- 后台任务未能成功提交时，使用 `knowledge-organizer-update-task-status` 将状态设置为 `failed`。
- 后台任务确认受理后，不得更新任务状态；后续状态由异步任务维护。
- 普通交互任务不得更新任务状态。
