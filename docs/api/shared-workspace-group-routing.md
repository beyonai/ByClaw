# 共享工作区创建群组的路由

共享工作区由 `TenantContextService.isSharedWorkspace` 标识，没有独立租户 Node。请求仍须通过企业成员与上下文凭证校验，后续数量限制也使用原企业身份，不能清空 TenantRequestContext 来绕开路由。

创建入口 `TenantGroupChatRoutingAspect` 对共享工作区执行原公共 Controller；`GroupChatApplicationService` 保留工作组/初始成员准入，并调用项目初始化。项目初始化中的 `WorkgroupNameService.exists` 对共享工作区直接查询公共 `byai_session`，条件包含企业、创建人、群组名称、群组类型，排除已解散群；不能调用 `/internal/v1/group-chats/name-check`。

独立企业在正常运行环境下继续从自己的 Node 查询名称；Node 不可用不回退公共库。开发模式原有公共库路径保留。

回归入口：`WorkgroupNameServiceTest`、`TenantGroupChatRoutingAspectTest`。这些用例核对路由和查询范围，不替代真实数据库、Redis 限额、项目目录初始化以及浏览器端到端创建验收。
