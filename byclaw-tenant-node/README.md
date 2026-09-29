# byclaw-tenant-node

固定企业、固定代际的租户数据服务。使用 TypeScript、Fastify、TypeORM 的参数化 SQL 适配器及 by-framework Worker；不直接引用 BE/FE 源码，不创建数据库或平台账号，不负责 AI 执行。

本次按「多租户三人并行开发计划」修正 C1–C4。协议细节集中在本文和 `openapi.json`；方案中未给出字节级定义的部分（hash、manifest、KMS HTTP 适配器、业务命令）在下面明确列出，A/B 联调须采用同一约定。

## 审查顺序

| 入口                                         | 职责                                               |
| -------------------------------------------- | -------------------------------------------------- |
| `src/main.ts` / `src/bootstrap.ts`           | 启动、依赖组装、退出；不放业务判断                 |
| `src/application/connection-manager.ts`      | 固定身份、租约、凭证轮换和提交前校验               |
| `src/application/runtime.ts`                 | DB、Schema、Worker、服务发现与消费者就绪状态       |
| `src/application/schema/`                    | 持久受理、逐版执行、恢复、结果回报与清理           |
| `src/infrastructure/schema/`                 | ZIP/SQL 白名单、catalog 指纹、数据库执行和 BE 回调 |
| `src/application/command-service.ts`         | 命令幂等；业务写入和结果记录同一事务               |
| `src/infrastructure/persistence/*-writer.ts` | 会话、群成员、任务写入；复用既有表                 |
| `src/application/history/`                   | 权限、历史、群列表、话题、上下文投影；拆开原长文件 |
| `src/domain/mirror.ts`                       | delta/terminal/error/cancel 状态机与顺序判断       |
| `src/interfaces/stream/`                     | 固定流、分片租约、pending 恢复、提交后 ACK         |

源码单文件控制在 200 行以内。application/domain 不依赖 Fastify、Redis 或 ORM；适配器通过端口组合。旧裸 SQL/bootstrap 路由、旧自建 `tenant_*` 表模型和旧消息持久化消费者已移除。

## C1：连接与就绪

ENV 只固定 `ENTERPRISE_ID=TENANT_ID`、`TENANT_GENERATION`、`DB_SANDBOX_RECORD_ID` 和 Redis/TLS/KMS 配置，见 `.env.example`。没有 `DATABASE_URL`、引导账号或解密主密钥。

单次 `HMGET TENANT_CONFIG_<E>` 读取：

```text
DB_HOST DB_PORT DB_NAME DB_USER DB_PASSWORD
DB_SANDBOX_RECORD_ID DB_CREDENTIAL_VERSION PROVISION_STATE
```

库名严格为 `byclaw_t_<E>`，账号严格为 `bc_t_<E>_admin`。实例、代际、凭证版本、fencingToken 和 leaseUntil 都校验。支持 `PROVISION_STATE.status=PROVISIONING` 配合 `step=REDIS_PUBLISHED/NODE_CREATING/ADMIN_ONLY/SCHEMA_INIT/VERIFYING`，也支持对应的阶段状态；停用/降级不开放写入。版本下限以原子文件持久化，防止重启后的配置回退。

密码必须为 SM4-GCM JSON 信封 `{alg,keyId,nonce,ciphertext,tag}`，后三项使用规范带填充 Base64，nonce 12 字节、tag 16 字节。Node 通过配置的内部认证方式调用 KMS，AAD 为 UTF-8 `byclaw:tenant-db:v1:<E>:<db_name>`；主密钥不进入进程配置。此处 KMS HTTP **适配器约定**为：

```json
{
  "enterpriseId": "12345",
  "databaseName": "byclaw_t_12345",
  "aad": "<AAD Base64>",
  "envelope": {
    "alg": "SM4-GCM",
    "keyId": "<tenant-key>",
    "nonce": "<Base64>",
    "ciphertext": "<Base64>",
    "tag": "<Base64>"
  }
}
```

成功返回 `200 {"plaintext":"<密码 UTF-8 字节的 Base64>"}`。真实 KMS 的 URL/字段若不同，只修改 `kms-decryptor.ts`，不能回退到本地主密钥或 ECB。

新池先核验实际库、账号、schema 权限和只读状态，再替换旧池。每个业务事务在获取共享 Schema 锁后及 COMMIT 前重新核验 Redis 权威配置，捕获的池已更换则拒绝提交。Redis/KMS/DB 故障保持未就绪。

默认 HTTPS 验证客户端证书链，并将证书 CN 固定为 `BE_CLIENT_IDENTITY`。203 本地联调可显式设置 `INTERNAL_TRANSPORT=http`，此时 BE、KMS、Node 走 HTTP，并用 `INTERNAL_API_TOKEN` 认证：直连可使用 Bearer，经过 OpenSandbox HTTP 代理时使用 `X-Byclaw-Internal-Token`，因为代理不会转发 `Authorization`；`REDIS_TLS=false` 允许连接本地 Redis。除 live 外仍要求 `X-Enterprise-Id`、`X-Tenant-Generation`；业务请求还要求真实用户 `X-Actor-User-Id`。这些内部接口不得直接对浏览器开放。

- `/internal/v1/health/live`：进程存活，无需客户端证书。
- `/internal/v1/health/db`：受保护；返回最近一次运行时身份/可写探测的状态。
- `/internal/v1/health/ready`：受保护；`ready` 表示 Schema 已核验、Worker/HTTPS/流组件可供 BE 完成开通验收；`businessReady` 还要求 BE 已发布 `PROVISION_STATE.status=READY`。这样避免「BE 等 Node 就绪、Node 等 BE READY」的循环。

成功连接后注册实际 `TENANT_DATA_<E>` Worker 和同名 ServiceRegistry 服务；metadata 含 enterpriseId、generation、实例 ID、HTTPS endpoint、Schema 版本与 READY/ADMIN_ONLY。失去连接权威后撤销注册，管理态拒绝业务命令。运行时每 5 秒串行对账。

## C2：Schema task

只接受 BE 发布制品，不提供任意 SQL/创建数据库接口。

| API                                                   | 含义                                                                              |
| ----------------------------------------------------- | --------------------------------------------------------------------------------- |
| `POST /internal/v1/schema-tasks`                      | 内部认证 multipart：`task` 为 application/json 字段，`bundle` 为 application/zip 文件 |
| `GET /internal/v1/schema-tasks/{auditId}`             | 返回原/目标/实测版本、阶段、脱敏错误和清理状态                                    |
| `GET /internal/v1/schema`                             | 最近对账的本地版本、BE 审计版本和 verified 状态                                   |
| `POST /internal/v1/schema-tasks/{auditId}/report-ack` | BE 轮询落库后的确认：`{attemptNo,status}`                                         |

上传必须带 `Idempotency-Key: <auditId>:<attemptNo>`。task 完整字段见 OpenAPI；INIT 只能有一个 baseline、fromVersion=null；UPDATE 沿 parentVersion 严格连续，无重复或降级。脚本相对路径必须为 `baseline/<version>/__ddl.sql` 或 `versions/<version>/__ddl.sql`，ZIP 每个版本只含该 SQL 与同目录 manifest.json。

manifest 的具体格式：

```json
{
  "version": "S1",
  "parentVersion": null,
  "engine": "openGauss",
  "nodeProtocol": { "min": 1, "max": 1 },
  "sqlSha256": "<64 hex>",
  "catalogDigest": "<64 hex>",
  "objects": [
    { "kind": "table", "name": "byai_session" },
    { "kind": "sequence", "name": "seq_any_table" }
  ]
}
```

objects 是本版允许操作的对象清单（table/index/sequence）；catalogDigest 是**本版执行完成后整个 byai catalog** 的指纹，包含对象及注释、列类型/非空/default/注释、索引定义、约束定义和序列属性。发布制品必须用 `catalog.ts` 相同查询、排序和 canonical JSON 算法生成，不能只用表名/列名摘要。具体 openGauss 版本的 catalog 格式由实库验收固定。

限制：ZIP ≤8 MiB、解压总量 ≤32 MiB、最多 64 条目；拒绝额外文件、重复名、路径穿越、符号链接、加密条目、CRC/摘要不符。SQL 做语句和 AST 白名单；仅允许 byai 清单对象的建表/序列/索引、ALTER、COMMENT，UPDATE 禁止 DROP，禁止事务控制、DML、其他 schema、角色所有权变更和任意函数。Node 专用 Schema 版本注释不可由制品覆盖。

先 fsync 暂存 ZIP 和受理结果，再返回 `202 PENDING`，202 不表示执行成功。同一 auditId/task 返回原记录，改内容返回冲突；正在执行/对账时拒绝另一任务。失败重试由 BE 使用新的 auditId/attemptNo 追加审计。

Schema 独占数据库锁覆盖整条链；每版独立事务，DDL 与 `COMMENT ON SCHEMA byai` 版本标记同时提交。新 INIT 检查 byai/public 及租户账号自有 schema 无对象；UPDATE 在锁内检查 fromVersion、BE 审计与指纹。提交后用新连接核验结构与标记；COMMIT 结果不明或核验失败进入 RECONCILING，恢复先查标记和指纹，避免重复 SQL。

Node 使用配置的内部认证方式调用：

- `GET <BE_INTERNAL_URL>/internal/v1/tenants/<E>/schema/current`：当前行 `{auditId,observedVersion,isCurrent:true}`；首次 INIT `{currentVersion:null}`。
- `POST <BE_INTERNAL_URL>/internal/v1/tenantSchemaTaskReports`：回报扁平 task/result 字段、steps、脱敏错误码/SQLSTATE，BE 按 auditId+attemptNo+generation 幂等落库，成功返回 204。

`V0.5.0` 的 baseline SQL 保存在 `deploy/migrations/versions/V0.5.0/tenant/`；供 BE 上传的 ZIP 与 manifest 放在本模块 `baseline/`，避免生成制品进入版本迁移目录。BE 从 `BYCLAW_TENANT_BASELINE_BUNDLE` 指向的 ZIP 读取制品。

VERIFIED 立即删除 ZIP，只保留结果；报告失败仍持续重试。FAILED/NEEDS_ATTENTION 的 ZIP 在 BE 报告确认或 report-ack 后清理；RECONCILING 未查清前保留。删除失败记 PENDING_RETRY，独立重试不重跑 DDL。ZIP 在内存解析，不生成解压 SQL 文件。

状态目录必须为可持久化、单进程写入的私有卷（目录 0700、文件 0600），任务按 generation 分目录；旧代际任务保留供 BE 对账，不由新代际自动执行。

## C3：会话、群与任务

写入全部使用以下完整命令信封，HTTP 路径/操作/actor 必须一致：

```json
{
  "protocolVersion": 1,
  "enterpriseId": "12345",
  "generation": "7",
  "dbSandboxRecordId": "67890",
  "userId": "10001",
  "requestId": "<稳定键>",
  "sessionId": "20001",
  "operation": "CREATE_SESSION",
  "tenantMemberUserIds": ["10001"],
  "requestHash": "<64 hex>",
  "payload": { "sessionName": "我的会话" }
}
```

数值型 ID 一律规范十进制字符串，正数、无前导零、不超过 signed bigint；不通过 JS Number 传递。requestId 最大 64 字符，允许 ASCII 字母/数字/冒号/下划线/连字符。

BE 每次核验 ACTIVE 租户成员，并生成 tenantMemberUserIds；邀请/转让目标也必须在此列表。AGENT 和文件的 resourceAuthorized、链接的 joinLinkAuthorized 均由 BE 校验后生成，不能透传 FE 的布尔值。Node 再校验 session.enterprise_id、群成员、OWNER/ADMIN、任务发起人和私有任务的群归属。

| operation                                             | payload 主要字段                                                                                                                                             |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| CREATE_SESSION                                        | sessionName；仅个人 h_as                                                                                                                                     |
| CREATE_GROUP                                          | projectId、sessionName、members[{memObjType,memObjId,memName,userRole,resourceAuthorized?}]；唯一 OWNER 为当前用户                                           |
| UPDATE_SESSION / DELETE_SESSION                       | 名称/内容；个人删除为 CLOSED，群使用解散                                                                                                                     |
| ADD_MEMBERS / REMOVE_MEMBER                           | members[] / memObjType+memObjId；普通成员邀请须启用对应设置                                                                                                  |
| JOIN_GROUP / LEAVE_GROUP                              | BE 授权的 joinLinkAuthorized+memName / 空对象；OWNER 先转让                                                                                                  |
| SET_ROLE / TRANSFER_OWNER                             | userId+role(ADMIN/MEMBER) / userId；仅 OWNER                                                                                                                 |
| DISSOLVE_GROUP / ACK_DISSOLUTION                      | 空对象；解散仅 OWNER，确认须是已解散群成员                                                                                                                   |
| UPDATE_SETTINGS                                       | allowJoinByLink、allowMemberAddAgent、allowMemberInviteUser 布尔字段                                                                                         |
| READ_STATE / RECALL_MESSAGE                           | messageId；已读游标仅向前，撤回由作者或群管理员操作                                                                                                          |
| CREATE_TASK                                           | taskSessionId、sourceMessageId、dispatchId、targetAgentId、taskName                                                                                          |
| UPDATE_TASK                                           | taskSessionId、status(ACTIVE/CANCELLED)、turnStatus(RUNNING/WAITING_USER/FAILED)                                                                             |
| SAVE_PENDING_PUBLICATION / DELETE_PENDING_PUBLICATION | taskSessionId、pendingPublicationId、text、sourcePaths / taskSessionId                                                                                       |
| PUBLISH_TASK                                          | taskSessionId、id、messageId、text、files[]、pendingPublicationId?、metadata?；仅发起人，非 RUNNING；发布消息、publication、PUBLISHED 状态与待发布清理同事务 |

API 路径对应 `command-routes.ts` 和 OpenAPI。HTTP 正常结果是**事务已提交**的原始结果；同 requestId 同内容不重做，冲突拒绝。命令结果使用既有 byai_session_ext 的 `node_command:<requestId>` 保存，与业务变更同事务；不新增幂等/回执表。重投离群/删除命令也可返回原结果。

历史保留既有 assiman、群列表/详情/上下文/搜索、话题、任务与待发布查询，撤回内容做脱敏投影。任务状态沿用 ACTIVE/PUBLISHED/CANCELLED 与 RUNNING/WAITING_USER/FAILED。群消息沿引用链写 topic_id，首次公开回复形成话题；真人提及投影至既有 mention 表。

BE 仍负责平台项目 PENDING→READY 编排、过滤未 READY 项目、租户权限、资源/云文件授权、上传、AI 调度与实时广播。Node 的群创建结果提交后 BE 才能发布项目 READY；上传/文件元数据未租户化的入口不能靠本模块绕开。

Worker content 支持 GET_SCHEMA、GET_SCHEMA_TASK、COMMAND、QUERY；外层都有 protocolVersion 和固定租户身份。COMMAND 的 command 字段为上述信封；QUERY 带 userId、operation、payload，支持 GET_MESSAGES/GET_GROUP/GET_GROUPS/GET_CONTEXT/GET_TASK。业务请求的 SDK header.userCode 必须与真实 userId 一致；仅受租户 Redis ACL 保护的 BE 可生产这些内部指令。Schema ZIP 上传使用 HTTPS。SDK AgentReturn.status 为 COMPLETED/FAILED，replyData 包含 ok/result/error；业务失败不能标记为 SDK 成功。

## C4：消息镜像

```text
入站：byclaw:tenant:{<E>}:inbound:control
出站：byclaw:tenant:{<E>}:outbound:session:<0..15>
```

每条 Redis 记录只有协议 JSON 字段 `data`。分片算法固定为 SHA-256(sessionId 的 UTF-8 字节) 首 8 字节 **无符号大端**整数 mod 16；示例 sessionId=30 → shard=11。consumer group 含 E、generation、方向；每分片 Redis 租约保证一个读者，COMMIT 前仍须持有租约。

信封固定字段：protocolVersion、enterpriseId、generation、dbSandboxRecordId、sessionId、clientRequestId、runId、traceId、userMessageId、answerMessageId、eventId、sourceStreamId(无 Gateway 为 null)、childOrdinal、eventSeq、eventType、payloadHash、payload。

- INPUT payload：id（既有消息表主键）、userId、messageContent，可带 creatorName、messageStruct、relatedResources、metadata、messageRef、topicId、mentionedUserIds、createTime(ISO 时间)。
- DELTA：稳定回答 id、text；可带 creatorId/creatorName、附件与 metadata。缺省字段保留已有值。
- TERMINAL：相同回答 id、relationId、完整 messageContent，finalContent 可选；覆盖草稿，与问答关系同事务。
- ERROR/CANCEL：相同回答 id；正文可选，落完成失败状态。

一个 run 一条回答。Gateway 按 sourceStreamId 的毫秒/序号/childOrdinal 数值排序；非 Gateway 使用从 1 开始连续 eventSeq。两种排序方式不能在同 run 混用，序号必须落在 signed bigint 范围。重复不拼接，差异内容冲突；已完成回答不接受后续 delta。

先处理 XPENDING 最老记录，再用 XAUTOCLAIM 收回超过 30 秒的 orphan，旧 pending 未解决不读取新记录。用户消息尚未提交、引用父消息缺失、序号缺口、DB/租约异常、COMMIT 不确定均留 pending。每条业务事务成功后才 XACK；ACK 失败再次投递时从既有行补 ACK。

永久协议错误只写 quarantine 的源流/ID/错误码引用，再 ACK 该消费组；源正文仍在原流，属于拒绝记录，不是成功回执。Node 不执行 XDEL/XTRIM、不产生持久化成功回执流、不重发 AI。未 ACK 或隔离正文不能由外部裁剪。新代际的旧流记录只作隔离引用，旧 consumer group 的 pending 必须由 BE 对账/迁移或按稳定业务标识重发，不能直接丢弃。

hash 的字节约定：递归按 JSON 对象键的 UTF-16 字典顺序排序，数组顺序不变，数字按 ECMAScript JSON.stringify，UTF-8 编码后 SHA-256，小写 hex。命令移除 requestHash、generation、dbSandboxRecordId、tenantMemberUserIds；镜像移除 payloadHash、generation、dbSandboxRecordId。E、用户、业务 ID、操作、事件序号/类型和 payload 都参与，身份另外独立核验；授权/代际变化不会破坏同一业务写入的幂等 hash。BE 必须使用同样的 canonical 算法，不能直接 hash 原始 JSON 文本。

## 验证与联调边界

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
pnpm format:check
# 配置证书与真实环境后，由联调人员启动：
node --env-file=.env dist/main.js
```

本次仅做离线类型、构建、格式和 mock 单元/HTTP/ZIP 测试，没有连接真实数据库、Redis 或 KMS，也没有执行任何迁移。

正式 baseline/增量 SQL 尚未生成：仓库要求先由用户给出准确迁移版本；本次未修改 deploy/migrations/versions、initdb 或 .applied。制品需包含既有表及方案新增 last_seq、created_seq、storage_version、mirror 序号/ID、clientRequestId/run/answer/command/hash 字段，以及 `readiness.ts` 要求的唯一索引和 seq_any_table。缺结构、索引、catalog 或审计不一致时只进入管理态。

目标 openGauss 的 PostgreSQL 驱动兼容性、advisory lock/ON CONFLICT/catalog 查询、完整 baseline/版本链、COMMIT 故障恢复，以及 BE/KMS/证书/Redis ACL 的实际联调，由实库验收完成。部署约定每租户每代际一个 Node 写入实例；多副本的任务状态共享与协调需另行设计。
