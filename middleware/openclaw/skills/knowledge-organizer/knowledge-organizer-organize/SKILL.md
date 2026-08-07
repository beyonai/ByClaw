---
name: knowledge-organizer-organize
description: Use when initialized knowledge-organizer tasks contain successful ODS ingestions that must be converted into scoped, entity-linked ADS knowledge fragments.
allowed-tools: read, exec
---

# 整理 ADS 知识碎片

只处理 `state.json` 中成功入库的 ODS 文档：模型按允许的 ADS 对象定义抽取条目，检索或创建实体，创建碎片并记录关联。不得直接调用 HTTP/RPC 或手工创建对象、实体、碎片。

## 执行

```bash
python3 <knowledge-organizer>/scripts/knowledge_organizer.py organize \
  --task-dir "{完整任务目录}" \
  --object-code "{限定ADS对象编码1}" \
  --object-code "{限定ADS对象编码2}" \
  --user-intent "{可选的用户关注范围}"
```

用户限定对象时，逐一传入全部且仅匹配的 ADS `objectCode`；未限定时省略 `--object-code`。`--user-intent` 只收窄范围，不能替代对象白名单。默认最多并发 4 个文件，完成一个即更新状态。

中断或失败文件只能使用 CLI 恢复：

```bash
python3 <knowledge-organizer>/scripts/knowledge_organizer.py organize \
  --task-dir "{完整任务目录}" \
  --object-code "{原限定ADS对象编码1}" \
  --object-code "{原限定ADS对象编码2}" \
  --resume
```

恢复时会沿用已保存的用户意图和对象白名单；只有需要改变限定范围时才重新传入 `--object-code`。成功碎片使用 ADS `instanceId` 和 ODS `originInstanceId`。不得重复处理已成功文件或过滤合法碎片。
