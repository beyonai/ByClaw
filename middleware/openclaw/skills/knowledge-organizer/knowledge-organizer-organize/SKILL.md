---
name: knowledge-organizer-organize
description: 在已初始化的知识整理任务中，为选定对象提交文档对象发现。适用于用户要求识别、提取或发现文档所表达的知识对象。
allowed-tools: read, exec
---

# 发现文档对象

## 选择来源和目标

分别确定发现来源和发现目标：

- 发现来源只从 `objects/ods/` 选择，表示从哪些原始对象中提取。
- 发现目标只从 `objects/ads/` 选择，表示要发现哪些目标对象。
- 用户指定来源、目标或业务范围时，选择对应对象；交互任务仍有实质歧义时再询问用户。
- 用户未指定某一侧范围时，该侧使用当前获取到的全部对象：全部 ODS 来源或全部 ADS 目标。
- 后台任务不要逐项确认；按以上规则直接推进，并在最终汇报中分别列出实际提交的来源和目标。

此操作不要求先登记文件，也不能自动执行 `ingest`。

## 执行

用户指定范围时，来源使用 `--source-object-code`，目标使用 `--object-code`；多个对象分别重复传入参数：

```bash
python3 <技能目录>/scripts/knowledge_organizer.py organize \
  --task-dir "<任务目录>" \
  --source-object-code "<ODS来源对象编码>" \
  --object-code "<ADS目标对象编码>"
```

某一侧未指定范围时，省略该侧参数，由 CLI 使用当前全部对应对象。两侧均未指定时：

```bash
python3 <技能目录>/scripts/knowledge_organizer.py organize \
  --task-dir "<任务目录>"
```

## 完成标准

只有命令确认受理时，才算提交成功。分别汇报来源对象和目标对象，并明确说明发现任务**已提交**。不要声称后台发现已经完成，也不要自动执行知识丰富。
