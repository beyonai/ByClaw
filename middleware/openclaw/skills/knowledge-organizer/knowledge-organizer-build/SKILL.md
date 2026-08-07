---
name: knowledge-organizer-build
description: Use when knowledge-organizer organization has produced successful ADS fragments and the related object instances must receive an asynchronous document-build submission.
allowed-tools: read, exec
---

# 构建相关 ADS 对象文档

只提交当前任务成功碎片关联的 ADS 实例，不等待异步任务完成，不重复提交已记录的实例，不处理新的文档或碎片。

## 执行

```bash
python3 <knowledge-organizer>/scripts/knowledge_organizer.py build \
  --task-dir "{完整任务目录}"
```

CLI 按最多 100 个实例分批提交；每批必须返回 `accepted` 或 `queued` 才记录成功。任务状态损坏或未初始化时停止。批次失败由 CLI 写入失败记录，Agent 只能报告失败原因，不能直调构建接口或伪造状态。

## 完成标准

以命令输出和 `state.json` 中的 `builds` 记录为准。只报告已确认接受的批次；不要把异步构建“已提交”表述为“已完成”。
