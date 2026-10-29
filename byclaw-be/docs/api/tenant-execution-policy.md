# 租户商业规则读取与技术确认

HACU 数据库是权益权威，HACU 既有发布任务将完整运行快照写入共享 Redis。ByClaw 不再创建 tenant_access_rule，不保存第二份规则正文/有效期/限额，不把规则搬进 tenant_operation_state。SharedQuotaReader.readRequired 使用现有 hash、摘要校验与 Cluster 同槽键；商业执行遇到快照缺失、损坏、Redis 故障或 UNLIMITED 标记均拒绝，不使用普通兼容路径的放行策略。

## 开通和生效顺序

1. ByClaw 受理原开通请求，同事务保存企业、OWNER、tenant_task、技术占用；initialPolicy 仅校验原请求，不存独立规则表。不可变原任务请求快照仍用于幂等和审计，不作为运行准入来源。
2. 返回企业编号后，HACU 原申请保存 PREPARED 权益并排队发布 Redis。ByClaw 创建资源前读取共享快照；尚未发布或 Redis 故障时保存原任务 RETRY_WAIT，延后重查，不能因发布延迟进入人工阻塞或分配新企业。
3. PREPARED/ENABLED 且有效期合法才允许技术步骤。READ_ONLY/SUSPENDED 拒绝继续。仅 SharedQuotaUnavailableException 允许发布等待；Provider 自己的 503/未知创建结果仍走原人工核验，不盲目重试。
4. 技术完成读取当前共享版本，记录主服务技术确认及 generation，再将原任务保存 SUCCEEDED/READY。HACU 观察原任务 READY 后保存 ENABLED 权益并通过既有发布任务写 Redis；runtime.policy 直接读取 Redis，因此看到同版本 ENABLED 后可完成首次商业激活，不需要先调用另一个接口存一份规则。

运行检查只允许 ENABLED 和明确有效区间；HACU 变更、到期、停用以 Redis 快照为准，不等待 ByClaw SQL 同步。Redis 必须由 HACU 持久权益重建；没有快照不能当成商业租户不限额。旧非托管租户及部署豁免沿用原兼容约定。

## 接口兼容及确认

PUT execution-policy 继续接受原请求用于兼容：只确认 HACU 已发布的同版本、状态、时间和已有共享限额字段，更新技术确认版本，不发布 Redis 或保存商业规则；发布未到返回 503，参数冲突拒绝。共享快照目前只包含 member/group/groupMember/agent 限额，不能据此宣称 storage/parallelTask 限额已落地。runtime 的 desiredRevision/accessMode/effectiveFrom/effectiveUntil 均来自同一次共享快照，generation 来自技术状态；fullyApplied 与 capabilities 不虚构已实现消费者。

主服务最新确认仍在 tenant_operation_state 的 applied_rule_revision/applied_runtime_generation/rule_applied_at，同版本代次确认幂等，不保存历史 ACK。policy_revision 仅技术确认记录，不是独立商业权威版本。

## 删除与边界

ByClaw 管理员删除属于技术生命周期：持久 DELETING/DELETE_FAILED/DELETED 禁止 Java 执行与继续开通，取消原任务执行权并清理资源；不生成另一套 SUSPENDED 规则，也不向 Redis 写商业状态。HACU 停用通过原权益发布流程处理。正在运行的 Node 在资源关闭前仍依赖 HACU Redis 快照，不因 Java 本地 DELETING 自动获得商业停用通知；本轮不宣称跨服务即时停用或在途操作撤回。

主 DDL 直接 CREATE TABLE，由用户重建；没有自动迁移、重建或线上数据库操作。需要配套新的 ByClaw 程序和现有 HACU Redis 发布 Worker 运行，真实环境仍需验证开通/停用/Redis 故障与恢复。
