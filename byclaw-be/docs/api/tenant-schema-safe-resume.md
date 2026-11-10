# 进度检查触发的安全初始化续开

用户页面与 HACU 平台显式进度操作可通过服务身份请求原任务继续初始化。GET 命令与资源检查保持只读，不因打开页面或轮询而修改任务。

## 服务接口

`POST /internal/v1/commands/{id}/safe-resume`

HMAC 服务鉴权、`tenant:provision` scope，以及原命令 sourceSystem / enterpriseId 可见性均须通过。请求字段仅 `requestId`（UUID）和 `expectedRevision`（十进制字符串）。不接收客户端 actor、人工确认或资源参数。

响应 200 包含当前 command view（commandId、enterpriseId、status、stage、revision、errorCode 等）及 decision、reasonCode。不满足条件时返回原状态及检查原因；200 不代表开通成功。并发版本变化可能返回 409；同一个已受理 UUID 重放查询原命令当前状态，不再次恢复。回执复用 tenant_task_recovery，actor_type=SYSTEM_SERVICE，actor_id=原调用方系统；真实点击者在 HACU 操作审计中记录。

## 放行范围

只处理原 PROVISION 命令的 SCHEMA_INIT：

- 原请求、步骤稳定身份和企业操作槽仍匹配；有效执行租约不得被覆盖。
- 原初始化审计已 VERIFIED 且绑定原请求、数据库记录、generation=1 与当前目标版本时，采纳已完成结果。
- 首次下发重试须满足：步骤 STARTED、当前基线 ZIP 可读取解析、内部下发配置可用、企业所有初始化审计为零；Provider 对原 DB_CREATE、NODE_CREATE 请求身份的检查均 MATCHED，记录号与持久配置相同且 RUNNING。
- 任意已有未核清审计、资源身份不明、其它步骤均不自动重试。不会仅凭 PROVIDER_RESULT_UNKNOWN 放行，不清空已完成步骤，不重建数据库或 Node。

受理事务按原命令 revision/lease、操作槽 revision、步骤 revision 和两份资源观测版本作条件更新；在事务内再次检查未下发前提。原 SCHEMA_INIT 进入 RETRY_READY，后续 Worker 使用原命令和原请求身份执行。

## 防止旧线程迟到下发

持久化开通路径将审计 INSERT 放在 `guard.local` 短事务中：先以当前 worker lease/fencing token 更新命令行并核验操作槽，再提交审计。Node 上传发生在提交之后。恢复受理的 command CAS 与审计事务使用同一行更新互斥，失效 worker 不能在恢复后写审计并首次下发。存在任意审计即阻断自动首次重试。

旧 legacy 初始化接口保持原行为；不得使用它绕过受控恢复处理商业开通。此安全证明依赖所有正在执行商业开通的 BE 实例都采用新 fence 路径：部署时先更新全部 BE 并结束旧 worker，再更新 HACU 及前端启用入口，不能混用旧执行线程。

## 基线版本与交付验证

恢复按当时 BE 选择的基线（外部路径优先，否则最高数字版本），未固定为首次开通版本。新的 worker 仍执行包解析、下发、Node 校验及 VERIFIED 审计，资源运行不等于业务激活。

新增回归源码覆盖无审计首次重试、已有审计/包缺失阻断、失效 worker 拒绝写审计、原资源身份与版本变化、租约/步骤CAS、重复UUID及scope/source/tenant权限。按用户要求未运行测试、编译、构建或线上恢复；需部署前运行相关后端用例，并联调 HACU 三入口及成功/失败反馈。无需新增数据库字段或迁移。
