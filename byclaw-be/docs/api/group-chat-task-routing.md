# 群聊任务的租户路由

`/group-chat/tasks/{taskId}` 下的 detail、pending-publication（GET/POST）、delivery-status、complete、cancel 统一由 `TenantGroupTaskRoutingAspect` 分流。

- 使用 `TenantModeService.isSharedDataTenant(enterpriseId)` 判断公共数据租户，复用 `tenant_config.TENANT_MODE=TRIAL` 的现有约定以及默认企业规则。此类租户没有独立 Node，请求继续执行原 Controller，使用公共库任务服务。
- 标准租户仍转发到所属 Node；Node 未就绪时仍返回原错误，不能因服务不可用降级读取公共库。
- 无 Header 的登记任务先校验登记的用户身份，再通过 `TenantContextService.validate` 校验租户成员关系，之后才按相同规则分流。

走公共库不代表跳过权限校验：原业务服务仍校验群成员、任务发起人及具体操作权限，投递查询执行 `GroupChatTaskDeliveryService.current`，不直接调用跳过授权的 `currentAuthorized`。

回归用例位于 `TenantGroupTaskRoutingAspectTest`：覆盖公共数据租户的六类操作、登记任务恢复身份及标准租户的 Node 查询授权路径。

## 任务内继续对话

“确认完成并发布到群聊”等输入会先经过普通聊天链，而不只是上述任务 Controller。`AssistantChatService` 的会话读取/创建、协调校验和模型选择同样通过 `TenantModeService.isSharedDataTenant` 区分公共库与 Node。

`ScriptService.prepareParams` 的 `ChatProcessContext.tenantContext` 专用于选择 Node 镜像和消息存储分支，公共数据租户不设置该字段，继续执行公共库的任务轮次准入和持久化。原 `TenantRequestContextHolder` 保持完整，不清空租户身份；个人额度判断仍按原请求身份区分，不能把试用租户误当个人空间。

对应回归位于 `AssistantChatServiceTest` 和 `ScriptTaskTurnAdmissionTest`，验证试用任务使用公共会话与任务轮次、保留请求身份，以及标准任务仍访问 Node。
