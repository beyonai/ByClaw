# 原商业租户开通命令恢复

恢复始终保留原 command、enterprise、购买申请、command step 的 provider_request_key，以及现有 provider adapter 由 userCode/serviceKey/resourceId 派生的幂等键。恢复不会替代商业策略 ACK，也不会重建已存在但无法证明身份的资源。

## 服务接口

- `GET /internal/v1/commands/{id}/recovery`：`tenant:read`，检查原命令的 source 和 tenant 授权。返回命令快照、`revision` 十进制字符串、`decision`、稳定 `reasonCode`、`capabilities:["RESUME"]`（不可恢复时为空数组） 和 `checkedAt`。
- `POST /internal/v1/commands/{id}/recoveries`：`tenant:provision`，仍校验 source 和 tenant。JSON 包含 `requestId`（规范 UUID）、`expectedRevision`（十进制字符串）、`actor:{type:"PLATFORM_ADMIN",id}`、非空 `reason`、`confirmNoInFlight` 布尔值。成功 HTTP 202，ResponseUtil.data 含 `requestId,commandId,enterpriseId,status:"ACCEPTED",commandRevision,decision`。
- `GET /internal/v1/commands/{id}/recovery-requests/{requestId}`：`tenant:read`，同样校验原命令 source/tenant。未找到为 HTTP 404、`RECOVERY_NOT_FOUND`。

同一 source/requestId 的相同 body 返回原持久回执，不受原命令后续状态变化影响。改变命令、revision、actor、reason 或确认值均返回 `RECOVERY_REQUEST_CONFLICT`。未知响应先查回执，再用原 requestId 和原 body 重试。

## 安全边界

- 仅 `MANUAL_REQUIRED` 的 PROVISION 命令可以恢复；运行中的命令返回 WAIT，成功命令返回 NOT_REQUIRED。命令 revision、step revision 和企业 runtime slot revision 的条件更新，与审计回执在同一事务中提交。恢复推进命令和 slot 围栏，不释放 operation slot。
- DB_CREATE/NODE_CREATE 使用专用完整查询，按 enterprise 拉取全部页；检查 `items`、`pagination.totalItems`、`pagination.hasNextPage`，核对可用页码、唯一 ID、稳定总数和明确末页。禁用、失败、裸数组、缺失分页、截断或重复页面均不代表零资源。
- 目前完整恢复查询支持直连 OpenSandbox adapter；OpenSandbox 可以部署在另一台主机，以配置的服务地址为准。Whale Agent 或远程 platform gateway 未提供可信完整查询时，返回 `PROVIDER_RECOVERY_QUERY_UNSUPPORTED`；需要在对应 Provider 端扩展查询契约后才能恢复，不能改查本机 Provider。
- 唯一现存资源须严格匹配 providerRequestKey、enterpriseId、TENANT ownerScope、serviceKey 和本地 recordId；本地记录还需 RUNNING、正确归属、原 sandboxId 和连接 endpoint，且保留原 DB 密码信封。缺失连接资料时返回人工处理，不调用创建来补资料。
- 完整查询确认零资源后，新版文件准备失败 `PROVIDER_NOT_CALLED_FILE_PREPARATION` 可 RETRY_SAFE；历史 STARTED/未知结果仅 RETRY_AFTER_CONFIRMATION，管理员必须确认无在途创建并填写原因。POST 自己重新查 Provider，不采用浏览器上一次检查结果。未绑定 provider ID 的本地 STARTING intent 以自身 lockVersion 退役，保留历史记录。
- DB_PROBE、CONFIG_PUBLISH、READY_PUBLISH 和 RESERVED 可安全接续。Schema 只承认同一原申请、数据库记录、generation、版本且 current/VERIFIED 的 INIT 审计；没有证明时返回 `SCHEMA_AUDIT_RECONCILIATION_REQUIRED`，不发新 audit、不跳过初始化。
- step 原记录不删除；审核事务将可重试的未完成 intent 标为 RETRY_READY，worker 原 guard 只消费一次后回到 STARTED。任何后续未知结果继续停在人工处理。
- 商业租户列表和 runtime 从原 PROVISION 命令读取 status/stage/errorCode，不再让旧 DB_CREATING 掩盖 MANUAL_REQUIRED。非商业租户沿用原投影；删除状态不被商业命令状态覆盖。

## 交付与验证状态

新增 `byai.tenant_task_recovery` 位于已授权 V0.6.0 DDL 的 `BEGIN BYCLAW TENANT COMMAND RECOVERY` 至 `END BYCLAW TENANT COMMAND RECOVERY` 事务区块；未运行迁移，未修改 initdb 或 .applied。已补充恢复幂等、确认、CAS 回滚、完整分页、身份匹配、权限边界、guard 单次恢复和旧状态展示的测试源码。按用户要求未执行测试、编译或构建；仅源码静态审阅和 diff 空白检查，不代表已验证真实 Provider 或完成线上恢复。

## 管理页面状态展示

ByClaw TenantMgr 将 MANUAL_REQUIRED 显示为中英文“待人工处理 / Manual action required”，暂停轮询，进度按独立 command stage 定位并显示暂停原因。商业人工处理状态不显示、不调用旧“重试开通”入口。进度摘要与标题允许窄屏换行；补充 360px/1280px 组件场景测试源码，但未执行测试，也未验证 Android/iOS/HarmonyOS、微信/钉钉内置浏览器或任何真机。

## 已完成重启的托管租户

原开通命令暂停在 DB_CREATE / STARTED、结果未知时，租户重启可能已经完成数据库、Node 和 schema 准备。管理员从原命令检查资源。如果普通请求键校验失败，恢复服务可核对同一企业的两个当前记录。此路径要求两个远端资源均缺少请求键，分别与本地 RUNNING 记录的类型、归属、沙箱编号、recordId 和连接信息相符。其他请求键不能作为本次重启的证据。

原请求 internal-{命令号} 必须有该数据库记录的当前 VERIFIED 初始化审计，并与 READY、generation 1 和持久配置相符。检查使用已存凭据读取数据库角色与库名，检查 Node 注册与业务就绪响应中的企业、generation、数据库记录。全部通过返回 ADOPT_EXISTING / RESTARTED_RESOURCES_VERIFIED，实时探测未通过返回 RESTARTED_RESOURCES_NOT_READY。管理员提交时重复检查，随后在同一事务核实原命令、操作槽、两条资源记录及原步骤版本，并登记数据库和 Node 的成功步骤。worker 重用这两条结果，继续探测和发布；用户侧最终状态仍以完成商业激活为准。
