# Post-processing

本流程与具体执行器无关。来源执行器只负责采集；采集编排器 `knowledge-collection` 统一负责持久化、预览、选择和收尾。

## 持久化与预览

采集开始后自动持久化到：

`/by/.sessions/<sessionId>/<collectionRunName>/<timestamp>/`

若该位置不可写，则回退到当前工作区的 `.by-sessions/<sessionId>/<collectionRunName>/<timestamp>/`，并在
`sanitized/metadata.json` 中记录 `storageFallback: true`；正常路径记录 `storageFallback: false`。

列表结果全部落盘，但最多预存 10 个正文。向用户返回每项的可点击预览文件链接，并明确展示完整、
`partial` 或失败状态；预览不得掩盖缺失正文。

## 唯一后处理选择

采集完成或达到可预览的 `partial` 状态后，只询问一次：`入库 / 知识整理 / 跳过`。入库与知识整理互斥，
同一批结果只能选择其一；跳过不触发任何下游处理。

若网站执行器返回 `adapterCandidate`，采集编排器只把它作为完成摘要中的非阻塞建议，不得追加第二个选择问题，
也不得让它替代或打断唯一的 `入库 / 知识整理 / 跳过` 选择。用户后续明确要求保存 Adapter 时，再委派 `bycli` 执行。

若用户选中的条目缺少正文，通过该条目的原始执行器补采所选正文，再继续后处理。补采不得擅自切换来源
执行器或改变用户筛选条件。

- 入库：展示目标、条目和产物范围并取得入库确认，确认后再调用知识库入库能力。
- 知识整理：将规范化产物及用户要求交给 `knowledge-organizer`，由其完成整理。
- 跳过：保留本次会话产物并结束。

## 清理

后处理成功后清理临时会话目录；当 `audit_required=true` 或用户要求保留时不得清理。失败或跳过时保留
全部会话产物，供恢复、审计或后续重试。
