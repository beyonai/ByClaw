# 租户任务状态查询

租户开通和删除不再发送持久 Hook。V0.6.0 不创建事件原件/投递表，业务事务与重试不依赖通知服务；原任务、步骤及人工恢复回执继续持久保存。

## 调用流程

1. HACU 用原 sourceSystem/requestId 查询 `GET /internal/v1/commands/by-request`。明确未受理才提交开通；响应丢失仍查询原请求，不换编号。
2. 受理后持久保存 enterpriseId/commandId，由原申请 Worker 定时查询 `GET /internal/v1/tenants/{enterpriseId}/runtime`，需要时再查 `GET /internal/v1/commands/{commandId}`。
3. PENDING/RUNNING/RETRY_WAIT 等待后重查；MANUAL_REQUIRED 展示失败阶段和错误并走原申请恢复；SUCCEEDED 仍需结合原租户技术 READY 和对应策略确认推进商业激活，不能仅凭任意任务成功激活。
4. 网络失败不等于远端未执行，查询失败不重新创建；HACU 重启后继续读取数据库中的待处理申请，由持久队列恢复轮询。

HACU TenantOperationWorker 使用 `hacu.tenant.poll-delay-ms`（默认 5000ms）调度 due 申请，各申请仍按 next_attempt_at/重试规则领取，不是每五秒查询全部历史任务。人工阻塞申请仍须修复后恢复，不能把轮询变成盲目重试资源创建。

## 删除与通用 Hook

删除任务在 tenant_task 中保存 PENDING/RETRY_WAIT/MANUAL_REQUIRED/SUCCEEDED，管理页面继续查询实际任务/租户删除状态。移除通知不省略资源核验、清理、技术关闭或原任务执行权保护。

普通用户注册/工作组创建的 best-effort Hook 保留。HACU 旧事件接收端可接收切换前在途请求，但新开通/删除不再发布这些事件，也不依赖 Inbox 唤醒。

删除旧 `byclaw.hooks.durable.*` 部署配置；通用 Hook 的配置绑定为严格模式，不再支持该已移除配置段。按用户安排由 V0.6.0 主脚本重建相关表，本次不执行数据库操作。
