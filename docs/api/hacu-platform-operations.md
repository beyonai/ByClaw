# HACU 平台运营适配

本适配为独立 HACU 平台运营前端提供真实沙箱与工作组查询，复用现有运行能力。
不增加沙箱或工作组的持续停用策略。

- BE 固定入口：`POST /internal/v1/platform-operations`，使用独立 `X-Hacu-Operations-Token`。
- 资源桥请求与响应固定使用 Jackson，支持 `JsonNode` 请求体及数值、布尔、数组响应；不经过普通页面接口的 Fastjson 转换。此序列化选择不授予调用权限，仍校验独立服务令牌。
- 企业成员移除预检和交接按目标企业读取 `TENANT_MODE`：`TRIAL` 使用同企业共享工作组数据，不要求独立 Node；其他独立租户缺失 Node 配置时继续拒绝。共享分支仍校验所有者、群成员快照、接任人、确认版本及交接事务，不把未知工作组状态当成零工作组。
- 配置 `HACU_OPERATIONS_TOKEN`（或 `hacu.operations.token`），长度 32 至 512 字符。与 HACU 后端保持一致。
- 未配置令牌时关闭入口；在匿名路由匹配前验证服务身份，Controller 再次校验。
- 请求包含可信的 `actor`、`requestId`、`resource`、`operation`、`payload`。
- `sandboxes` 支持 `list/detail/start/release/restart`；所有输出显式投影，不包含端点和网关凭据。
- 运行操作用现有乐观版本认领，不持有数据库事务等待网络。资源最新记录与状态决定可用操作。
- 用户实例通过现有 SandboxService 启动/释放；企业数据库和 Node 通过 TenantDbProvisioningService 异步重启。
- 启动服务返回空结果时以 `FAILED` 回执拒绝受理，HACU 显示启动失败并要求重读；不自动重试。
- 释放仅在执行服务确认成功后落库为 `RELEASED`；明确失败返回 `RELEASE_FAILED`，超时、空响应或未完成状态迁移返回 `UNKNOWN`，保留 `RELEASING` 交由既有状态协调处理。
- 运营桥释放后重新读取记录确认结果，避免未取得操作权时误报成功；已释放记录若仍存在运行、启动或释放中的实例，也不能再次启动。涉及核心释放逻辑的修复需部署到实际执行释放的 BE 实例。
- 列表支持 `RELEASING` 筛选，此状态不开放运行操作；用户启动能力按既有登录规则识别大小写锁定标记。
- OpenClaw 用户实例恢复时保留记录的 profileKey，通过既有 serviceKey 档位契约传递；正资源 ID 仍走资源路由。
- `groups` 支持 `list/detail/members/conversations`，必须指定企业；仅通过 TenantNodeClient 的运营只读路径白名单调用 Node。
- Node 路径为 `POST /internal/v1/operations/groups/query`、
  `GET /internal/v1/operations/groups/{id}`、
  `POST /internal/v1/operations/groups/{id}/members/query`、
  `POST /internal/v1/operations/groups/{id}/conversations/query`。
- 查询沿用服务认证、租户发现、READY、企业与代际校验，不伪造普通用户 actor。
- Node SQL 使用配置企业范围；只查询工作组、成员及关联会话元数据，不查询聊天正文。
- 关联会话按创建时间与 ID 倒序分页，查询范围与工作组详情的会话数量一致。
- 更新 BE 后还要升级已开通企业的 Node 镜像。HACU 端配置 BE 根地址，浏览器不直接调用内部接口。
- 运营桥应仅对 HACU 服务可达，无需通过公网反向代理开放。
- 本次没有生产数据库迁移。账户资料和状态更新由 HACU 后端在共享业务库完成并同事务审计。

新增测试位于 BE 的 `manager/domain/operations`、`gateway/sandbox/service/SandboxReleaseOutcomeTest` 与 Node 的 `operationsQueries/operationsRoutes`，覆盖释放失败、未知结果、完成状态以及历史记录和运行状态不一致的处理。
按用户约定，本次未执行测试、类型检查、编译或构建；部署和运行结果需联调验收。

