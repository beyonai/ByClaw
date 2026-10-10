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

BE 以固定服务名 `TENANT_DATA_<E>` 从 Redis 发现并校验实例，直接使用注册的 host、port 和 pathPrefix，不再从数据库中的 sandbox ID 重建访问地址。Node 的 `ADVERTISE_HOST` 未设置、为空或沿用旧的 `host.containers.internal` 占位值时，默认发布自身容器 hostname；Docker 共享网络须能解析该 hostname，其他部署方式可显式设置可达的 `ADVERTISE_HOST`。容器重建后实例 hostname 可以变化，固定服务名和租户/代际校验保持不变。

## C2：Schema task

只接受 BE 发布制品，不提供任意 SQL/创建数据库接口。

| API                                                   | 含义                                                                                  |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `POST /internal/v1/schema-tasks`                      | 内部认证 multipart：`task` 为 application/json 字段，`bundle` 为 application/zip 文件 |
| `GET /internal/v1/schema-tasks/{auditId}`             | 返回原/目标/实测版本、阶段、脱敏错误和清理状态                                        |
| `GET /internal/v1/schema`                             | 最近对账的本地版本、BE 审计版本和 verified 状态                                       |
| `POST /internal/v1/schema-tasks/{auditId}/report-ack` | BE 轮询落库后的确认：`{attemptNo,status}`                                             |

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

数值型 ID 一律规范十进制字符串，正数、无前导零、不超过 signed bigint；不通过 JS Number 传递。Node 自行创建的消息、任务、成员等 ID 使用 `8_000_000_000_000_000_000 + enterpriseId × 1_000_000_000 + nextval(byai.seq_any_table)`，为每个租户保留独立的 BIGINT 区间；企业 ID 和本地序列值分别必须小于 10 亿，超出时拒绝写入。已有本地小 ID 保持原值，新写入使用新范围。requestId 最大 64 字符，允许 ASCII 字母/数字/冒号/下划线/连字符。

BE 每次核验 ACTIVE 租户成员，并生成 tenantMemberUserIds；邀请/转让目标也必须在此列表。AGENT 和文件的 resourceAuthorized、链接的 joinLinkAuthorized 均由 BE 校验后生成，不能透传 FE 的布尔值。Node 再校验 session.enterprise_id、群成员、OWNER/ADMIN、任务发起人和私有任务的群归属。

| operation                                             | payload 主要字段                                                                                                                                                                             |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CREATE_SESSION                                        | sessionName；仅个人 h_as                                                                                                                                                                     |
| CREATE_GROUP                                          | projectId、sessionName、members[{memObjType,memObjId,memName,userRole,resourceAuthorized?}]；唯一 OWNER 为当前用户                                                                           |
| UPDATE_SESSION / DELETE_SESSION                       | 名称/内容；个人删除为 CLOSED，群使用解散                                                                                                                                                     |
| ADD_MEMBERS / REMOVE_MEMBER                           | members[] / memObjType+memObjId；普通成员邀请须启用对应设置                                                                                                                                  |
| JOIN_GROUP / LEAVE_GROUP                              | BE 授权的 joinLinkAuthorized+memName / 空对象；OWNER 先转让                                                                                                                                  |
| SET_ROLE / TRANSFER_OWNER                             | userId+role(ADMIN/MEMBER) / userId；仅 OWNER                                                                                                                                                 |
| DISSOLVE_GROUP / ACK_DISSOLUTION                      | 空对象；解散仅 OWNER，确认须是已解散群成员                                                                                                                                                   |
| UPDATE_SETTINGS                                       | sessionName（1–100 字符）、allowJoinByLink、allowMemberAddAgent、allowMemberInviteUser 布尔字段；由 BE 的群设置 PUT 路由转发，OWNER/ADMIN 可更新                                             |
| READ_STATE / RECALL_MESSAGE                           | messageId；已读游标仅向前，撤回由作者或群管理员操作                                                                                                                                          |
| CREATE_TASK                                           | taskSessionId、sourceMessageId、dispatchId、targetAgentId、taskName                                                                                                                          |
| SEND_GROUP_MESSAGE                                    | chatContent、resourceList、files、replyToMessageId；单个员工创建隐藏候选执行，两个及以上不同员工直接创建团长 GROUP_TASK；返回 messageId 和含稳定 dispatchId、groupCoordination 的 dispatches |
| CLAIM_TASK                                            | taskSessionId；仅发起人可将 QUEUED 任务或候选执行原子领取为 RUNNING，返回 claimed，重复领取不会启动第二次执行                                                                                |
| UPDATE_TASK                                           | taskSessionId、status(ACTIVE/CANCELLED)、turnStatus(RUNNING/WAITING_USER/FAILED)                                                                                                             |
| SAVE_PENDING_PUBLICATION / DELETE_PENDING_PUBLICATION | taskSessionId、pendingPublicationId、text、sourcePaths / taskSessionId                                                                                                                       |
| PUBLISH_TASK                                          | taskSessionId、id、messageId、text、files[]、pendingPublicationId?、metadata?；仅发起人，非 RUNNING；发布消息、publication、PUBLISHED 状态与待发布清理同事务                                 |

API 路径对应 `command-routes.ts` 和 OpenAPI。HTTP 正常结果是**事务已提交**的原始结果；同 requestId 同内容不重做，冲突拒绝。命令结果使用既有 byai_session_ext 的 `node_command:<requestId>` 保存，与业务变更同事务；不新增幂等/回执表。重投离群/删除命令也可返回原结果。

群聊提及、话题及消息确认写入与 BE 的 Mapper 使用相同的 openGauss `MERGE` 语义：重复提及/确认不新增记录，话题活动时间和消息 ID 只向前推进。命令和镜像仍在群会话锁保护的事务内执行。数据库适配器统一将 TypeORM 的 `UPDATE`/`DELETE` 返回值 `[rows, affected]` 转为行数组，覆盖普通查询、业务事务和 Schema 专用连接；任务领取、消息序号及镜像版本检查不能直接判断驱动元组的长度。BE 的租户群聊成功、拒绝和错误回执均携带 `enterpriseId`，避免被前端租户过滤器丢弃。

`GET /internal/v1/messages/by-command/{commandId}` 按既有 `byai_message.persist_command_id` 查询当前消息。commandId 是镜像 eventId，允许 1–64 个 ASCII 字母、数字、冒号、下划线和连字符。接口要求 mTLS、固定租户/代际头与真实 `X-Actor-User-Id`，查询同时限定消息和会话的企业，返回前复核个人会话所有者、群成员或私有任务发起人权限；撤回消息仍做脱敏。200 返回沿用历史字段的单条消息及 complete；未匹配或无权访问均返回 404 RESOURCE_NOT_ACCESSIBLE。

群消息“收到”确认：`POST /internal/v1/group-chats/:id/messages/:messageId/ack` 使用 `ACK_MESSAGE`，同路径 `DELETE` 使用 `UNACK_MESSAGE`。请求体沿用完整命令信封，payload 为 `{ "messageId": "...", "userName": "可选的显示名称" }`；实际确认用户取鉴权后的 actor，不接受 payload 指定其他用户。仅未撤回消息的被 @ 群成员可操作，发送者不能确认自己的消息。重复确认保留原时间，重复撤销无副作用。

确认结果包含 `messageId` 和 `acknowledgements[{messageId,userId,userName,acknowledgedAt}]`，时间为毫秒时间戳。Node 只持久化；BE 提交成功后广播 `MESSAGE_ACK_UPDATED`。群上下文、搜索、消息定位和话题消息返回确认列表及当前用户的 `canAcknowledge`。该操作不推进已读游标，不新增聊天消息。

部署前须在租户数据库中创建 `byai.byai_group_chat_message_ack`；表结构沿用 `deploy/migrations/versions/V0.5.0/V0.5.0__ddl.sql`。主库 SQL 与租户 baseline 是独立制品，仅合并主库建表语句不会更新租户数据库；新租户 baseline 和已有租户升级都需要包含此表。

输入消息保留 INPUT 的 commandId；回答行只保留最近一次已提交的出站 commandId，后续事件会覆盖旧 ID。该接口查询当前行，不保存逐事件审计历史，404 不能作为“事件从未落库”的证明。旧出站事件应结合稳定 answerMessageId、后续消息状态和源流记录对账。

历史保留既有 assiman、群列表/详情/上下文/搜索、话题、任务与待发布查询，撤回内容做脱敏投影。任务状态沿用 ACTIVE/PUBLISHED/CANCELLED 与 QUEUED/RUNNING/WAITING_USER/FAILED。群消息沿引用链写 topic_id，首次公开回复形成话题；真人提及投影至既有 mention 表。单 @（包括只 @ 群组工作助手）使用现有 `byai_group_chat_execution` 表保存候选执行，初始会话为 `GROUP_TASK_CANDIDATE`，不创建正式任务、不出任务卡。BE 复用个人空间的分类指引和 UserFS 文件校验，在镜像 `metadata.groupDisposition` 中发送 `{schemaVersion:"1",dispatchId,kind:"CHAT"|"TASK",taskName?,ackText?}`；Node 校验 dispatch 和当前 trace/answer 绑定。合法 TASK 在首条分类 DELTA 或 TERMINAL 中原子创建任务、将原会话提升为 `GROUP_TASK`，只在群中发布带 taskId 的回执；完整回答保留在任务子会话。CHAT（包括终态没有合法分类文件）只投影群内回答，不带 taskId，并隐藏会话为 `GROUP_CHAT_DISPATCH`。已提升的 TASK 不能被迟到的 CHAT 判定降级。两个及以上不同数字员工仍强制直接创建团长 GROUP_TASK，与模型分类无关。TERMINAL 保存私有回答与问答关系后将任务置 WAITING_USER，保留成果确认发布流程；ERROR/CANCEL 只结束对应执行，不伪造公开回复。重复命令、Stream 回放或重复分类不会创建第二张卡或第二条群回复。BE 在 Node 提交成功后广播群事件。

运行候选的内部 session GET 在核验原群成员与发起人后返回服务端 `groupDispatch` 标识；普通会话列表和子会话列表排除候选与隐藏 CHAT 会话。BE 用 `GET /internal/v1/group-chat/dispatches/:sessionId` 在镜像提交后查询公开回执 ID 与判定状态，即使 CHAT 执行会话已经隐藏也可广播群消息；该接口仍校验原群成员与发起人，正式 task detail 不接受候选执行。摘要同时返回初始回答的 `traceId`、`answerMessageId`、`answerLastSeq`（已持久化的镜像序号字符串）和 `answerTerminal`（回答是否已到终态），供 BE 在同 trace 恢复与重试时续接已提交序号；已提交终态只重发通知，不重写回答。

群的团长关联保存于现有会话扩展 `group_coordinator_agent_id`；新建群由 BE 添加平台确定的唯一默认助手。存量群首次发送员工请求时，BE 确定默认助手并授权群用户，Node 在发送事务内核验、补齐成员和关联。`coordinatorAgentId/coordinatorName/coordinatorAuthorized` 仅由 BE 生成，禁止透传客户端数据。

任务范围保存于 `group_coordination_scope`：`{schemaVersion:"byclaw.group-coordination/v1",mode:"COORDINATED"|"DIRECT",groupSessionId,taskSessionId,coordinatorAgentId,allowedAgentIds}`，ID 均为字符串。多人请求仅保留原 @ 的员工为可委派成员（团长身份单独记录）；单人请求保留直接执行，并通过团长申请协助。任务详情、私有会话和重试 dispatch 返回同一持久化范围；客户端不能覆盖范围或在团长根会话切换员工。内部成员协助由运行时结构化工具关联原任务，正文 @ 与成果署名仅用于展示，`PUBLISH_TASK` 不再根据资源引用创建新任务。

群任务每次新入站在现有 INPUT 消息 `metadata.groupPublicContext` 中冻结服务端公共历史边界：首轮使用原群消息 ID，续聊使用 Node 当前群最大消息 ID 加一。Node 的公共消息 ID 与 BE 私有消息 ID 属于不同范围，不可互相比较。客户端同名字段被移除；重复输入复用已有边界。BE 读取并校验这条私有输入后，调用既有 context API 的 `agentContext:true` 视图，最多 60 条 / 30,000 字符，查询阶段排除系统事件和系统引用；普通用户时间线保持原展示。Worker `GET_CONTEXT` 同样使用 Agent 视图。

BE 复用个人群聊的私有 UserFS 快照导出与完成校验机制，将 `group-history.json` 路径和冻结的 `groupContextSnapshot` 一并送入运行时；同 trace 重试复用完成文件，新输入生成新快照。旧执行缺少 INPUT 边界时保留原任务 sourceMessageId，不按重试时的最新历史扩大范围。快照中的历史和引用是只读背景，不能被当作新请求或调度授权。未新增 Redis key、表或数据库迁移。

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

### 租户任务事件、子会话与交付

BE 在任务输入时保存可信的租户归属，Redis 恢复上下文保留同一身份。外部子 Agent 的会话、消息和绑定写入该租户 Node；`POST /internal/v1/sessions/{id}/children/query` 先校验父会话，再沿父链校验各子会话与任务发起人。会话详情和子会话列表返回导航所需的 `parentSessionId` 与外部 `sessionExts`，普通会话列表排除子会话。

`ENSURE_EXTERNAL_CHILD` 复用稳定子会话与消息 ID；`SAVE_EXTERNAL_CHILD` 使用 `expectedStreamId` 校验读取水位，提交消息正文、结构化事件、推理记录、最终正文和新水位后才允许 ACK。后端按 Stream 水位及逻辑事件序号去重，较新的 `child_turn` 重置上轮内容，过期轮次不覆盖新内容。后续状态事件保留已写入的最终正文。子会话消息使用既有 `created_seq` 和 `storage_version` 字段，无需新增数据库结构。

实时父会话事件、运行状态和子会话快照、增量及状态帧均携带 `enterpriseId`，仅发给同一用户在对应企业的频道，并通过 Redis Pub/Sub 送达其他 BE 实例。接收实例按自己的子会话订阅选择正文或状态通知，再生成增量；消息元数据保留 `messageRenderVersion=v2`、本地父会话 ID 和外部运行标识。群回显只提取文本或明确的最终答案，任务计划、团队快照及文件变更保留在结构化消息中。DIRECT 与 COORDINATED 任务均通知终态。

任务请求复用原链路的 `.byclaw/task-delivery.json` 交付信号指引；用户发起 `prepare_group_task_publication` 时追加发布准备工具指引，由用户在待发布卡片中确认。部署此修复需要同时更新 BE 与租户 Node；既有历史任务的错误正文、缺失绑定或交付信号不会自动补写。

HACU 租户任务会话的 WebSocket `STOP_CHAT` 与 HTTP 停止接口共用 Node 会话/消息授权，授权成功后才读取共享运行态并执行取消；`STOP_CHAT_ACK` 携带请求标识、字符串消息 ID 和企业 ID。新候选会话沿用 `CHAT_REPLY`/`TASK_ACK` 分类，兼容旧任务链路的自动成果标记为 `TASK_RESULT`。实时广播复用 Node 的撤回安全历史投影，包含任务标识、回复引用和资源字段；`canAcknowledge` 由各接收者按自身身份计算。旧自动回复仅在其消息 ID 与任务的 `publishMessageId` 匹配时补充成果类型，无需改写历史数据或执行迁移。

私有任务历史保留过程文字；仅收到明确最终答案而没有文本增量时，历史正文回退到最终答案，避免刷新后答复为空。群成果只使用明确最终答案或最后一个推理/工具事件之后的末段正文。没有最终正文时更新任务终态但不发布空成果。此修复需部署 BE 和租户 Node，单独更新 HACU 前端无法消除旧后端的停止拒绝及广播字段缺失；已保存的旧过程文字不自动清理。

候选会话的状态写入和完成时间判断共用参数时，显式转换为 `varchar`，避免 openGauss 将同一参数分别推断为 `text` 与 `varchar`，造成群回复落库返回 503。设置 `TENANT_NODE_TEST_DATABASE_URL` 后，`pnpm test` 会额外执行真实 PostgreSQL/openGauss 的 CHAT/TASK SQL 回归；这些用例只执行 `EXPLAIN`，不会修改数据库数据或表结构。

启动入口自动读取模块根目录的 `.env`，不依赖调试器工作目录，已有环境变量优先。

本地填写 `.env` 后运行 `pnpm dev`，或调试 `src/dev.ts`。开发入口默认监听 `127.0.0.1`，把示例状态目录改为模块内 `.tenant-state/`；TLS 路径未填写或仍为 `/run/secrets/` 时，用 OpenSSL 自动生成本地 CA、Node 证书和 BE 客户端证书，保存至 `.tenant-state/dev-tls/`，有效证书重复启动会复用。自定义证书路径保持不变。私钥仅当前用户可读，目录已被 gitignore 排除；不会安装系统信任证书。

本地仍使用 HTTPS/mTLS，受保护接口须带开发 BE 客户端证书、租户与代际头。进程存活检查可使用：

```bash
curl --cacert .tenant-state/dev-tls/ca.crt https://localhost:3100/internal/v1/health/live
```

本地开发入口不会模拟 Redis、BE、KMS 或数据库；这些配置仍需填写，就绪取决于依赖和租户结构。`pnpm start` 使用正式入口，不生成开发证书或修改监听/状态目录，部署时由 BE 注入环境和真实证书。

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
pnpm format:check
# 配置证书与真实环境后，由联调人员启动：
pnpm start
```

本次仅做离线类型、构建、格式和 mock 单元/HTTP/ZIP 测试，没有连接真实数据库、Redis 或 KMS，也没有执行任何迁移。

正式 baseline/增量 SQL 尚未生成：仓库要求先由用户给出准确迁移版本；本次未修改 deploy/migrations/versions、initdb 或 .applied。制品需包含既有表及方案新增 last_seq、created_seq、storage_version、mirror 序号/ID、clientRequestId/run/answer/command/hash 字段，以及 `readiness.ts` 要求的唯一索引和 seq_any_table。缺结构、索引、catalog 或审计不一致时只进入管理态。

目标 openGauss 的 PostgreSQL 驱动兼容性、advisory lock/ON CONFLICT/catalog 查询、完整 baseline/版本链、COMMIT 故障恢复，以及 BE/KMS/证书/Redis ACL 的实际联调，由实库验收完成。部署约定每租户每代际一个 Node 写入实例；多副本的任务状态共享与协调需另行设计。

## D0.5.0 消息命令兼容

`UPDATE_FEEDBACK` 对应 `POST /internal/v1/sessions/:sessionId/messages/:messageId/feedback`，payload 为 `messageId`、`type`（praise/tread/none）、`mode`（reaction/feedback）和可选的 `feedback` JSON 字符串。服务保留与反馈无关的消息 metadata，更新消息与问答关系的反馈字段，并返回 metadata 字符串。

`UPDATE_MESSAGE_STRUCTURE` 对应 `PATCH /internal/v1/sessions/:sessionId/messages/:messageId/structure`，payload 为 `messageId`、`updateField`（messageStruct/inferLog）、`id` 与 `content`，按段落 ID 替换结构内容。两种命令均复用企业/用户/会话授权、会话锁、requestHash 校验及命令事务；已撤回或不属于该会话的消息拒绝更新。运行快照中的待落库回答由 BE 精确会话授权后编辑。

会话创建可保留 `agentId`、`projectId`，会话查询支持 `agentId`。`GET /internal/v1/messages/:messageId/trace` 复用消息访问权限，返回当前镜像协议保存的 runId（BE 生产端与 traceId 相同）。

## HACU 租户接口补齐

BE 公共路径保持不变。带租户上下文的群消息、群管理与任务请求转发到对应 Node；个人模式继续使用原 BE 用例。Node 只存取数据，BE 负责平台项目/模板/资源授权、文件上传、停止运行以及提交后的 WS 广播。

| 能力               | Node 内部接口（省略 `/internal/v1`）                      | 操作                                                                                         |
| ------------------ | --------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 修改群昵称         | `PATCH /group-chats/:id/members/me/nickname`              | `SET_NICKNAME`，`nickname`                                                                   |
| 从群创建私聊       | `POST /group-chats/:id/direct-sessions`                   | `CREATE_DIRECT_SESSION`，`agentId`；返回 `data` 会话                                         |
| 创建/续期邀请      | `POST /group-chats/:id/invitations`                       | `CREATE_INVITATION`，BE 生成 8 位 `token`；返回 `data.token/expiresAt`                       |
| 预览邀请码         | `POST /group-chats/invitations/validate`                  | body `{token}`；仅当前租户成员可访问                                                         |
| 凭邀请码入群       | `POST /group-chats/:id/join`                              | `JOIN_GROUP`，`token/joinLinkAuthorized/memName`；事务内复查邀请及群状态                     |
| 修改群名/设置      | `PATCH /group-chats/:id/settings`                         | `UPDATE_SETTINGS`，可选 `sessionName` 和三个既有布尔设置                                     |
| 改角色、转让、退群 | `/group-chats/:id/members/role`、`/owner`、`/leave`       | 复用 `SET_ROLE/TRANSFER_OWNER/LEAVE_GROUP`                                                   |
| 解散、确认解散     | `/group-chats/:id/dissolve`、`/dissolution-ack`           | 复用 `DISSOLVE_GROUP/ACK_DISSOLUTION`                                                        |
| 撤回群消息         | `POST /group-chats/:id/messages/:messageId/recall`        | `RECALL_MESSAGE`；返回撤回事实和需停止的关联任务                                             |
| 准备发布           | `POST /group-chats/:id/tasks/:taskId/pending-publication` | `SAVE_PENDING_PUBLICATION`；支持 `expectedPendingPublicationId` 防止覆盖旧卡片               |
| 上传检查点         | 同上路径 `PATCH`                                          | `CHECKPOINT_PUBLICATION`，`taskSessionId/pendingPublicationId/cloudResourceId/uploadedFiles` |
| 完成发布           | `POST /group-chats/:id/tasks/:taskId/publication`         | `PUBLISH_TASK`；Node 分配消息 ID、原子保存消息和成果，重复发布返回已有结果                   |
| 取消任务           | `POST /group-chats/:id/tasks/:taskId/cancel`              | `CANCEL_TASK`，`taskSessionId`；发起人或管理员可操作                                         |

以上写入均使用完整 `TenantCommand` 信封；路径、operation、actor 与 payload 必须一致。查询补充 `GET /group-chats/:id/management`（含解散后的成员快照）、`GET /group-chat/tasks/:taskId/cancellation`（取消权限校验）与 `GET /group-chat/tasks/:taskId/publication`（发起人查询已发布结果）。

邀请记录复用群扩展表，不单独建表。私聊记录来源群、目标 Agent 和创建时的消息边界，仅创建者可读取。取消、解散和撤回先在 Node 关闭任务，再由 BE 停止发起人的运行；迟到终态不会重新发布到群。外部停止失败会返回错误，重复取消/撤回可重试停止。

本次不修改或执行数据库脚本、不重新生成 baseline。部署者需要保证租户库已有原群聊/任务/待发布表、确认表及 Node 原有字段。BE 和 Node 应一起更新；数据库结构由部署者升级后再联调。

群历史 `context` 的最新消息超过字符预算时，返回保留消息 ID、资源和附件的有界正文预览（标明截断），避免空页阻断历史分页。原始消息不改写，使用该消息 ID 作为 beforeMessageId 可继续读取更早消息。

私有群任务的原始用户输入若缺少提及资源，历史查询会从同租户、未撤回的原群消息补齐 metadata 和 relatedResources 中的 resourceList，让客户端显示 @名称。此投影兼容既有任务，不改写历史消息；保留已经保存的提及资源，且只处理与任务原消息正文和发起人一致的输入。

### 群任务子会话查询

`GET /internal/v1/sessions/{id}/children?pageNum=1&pageSize=100` 用于 GROUP_TASK 的成员导航。节点先沿用历史读取规则校验父任务，再按当前企业、当前用户及父会话分页查询，并逐一校验子会话。任务仍需由发起人访问，成员仍需位于原任务调度范围内；普通个人会话列表继续排除群任务。返回会话保留字符串 ID、`parentSessionId`、`state`、`objectId` 和 `objectType`。

BE 的会话资源查询通过节点校验租户会话，不回退查询个人会话库。未关联项目（包括 `projectId=-1`）的已授权租户会话返回空资源页；关联平台项目时继续使用平台项目与数据源权限校验。

### V0.5.0 租户任务轮次基线修复

租户基线及配套 ZIP/manifest 必须包含 `byai_group_chat_task.current_turn_id`、`current_turn_trace_id` 和 `idx_group_chat_task_running_turn`。就绪检查会拒绝缺少轮次字段的库，避免任务续聊在业务阶段才失败。`tenant/V0.5.0__ddl.sql` 为已有租户的同版本补丁；openGauss 不支持 `ADD COLUMN IF NOT EXISTS`，执行器须在同一事务中检查字段存在性及类型，再执行缺失字段的 ALTER，并更新 schema 的 catalog 指纹。该补丁不回填历史任务状态。

生成新基线 manifest 时，应在同引擎的临时空库执行完整基线后，使用 Node 的 `catalogDigest` 计算指纹；已有租户的修复指纹按实际 catalog 计算，不可直接覆盖为新建库指纹。修改 SQL 后须同步生成 `baseline/V0.5.0__baseline.zip` 和 manifest；`packaged-baseline.test.ts` 验证发布 ZIP 与迁移源及 manifest 一致。BE 的打包资源包含该 ZIP，部署时需同步更新。

### 专家团父子会话渲染序号

BE 到 Node 的镜像协议中，`AnswerDelta.seq` 是渲染顺序计数器，必须输出 JSON 数字；消息、会话及任务业务 ID 仍为字符串。旧镜像中的字符串序号由 BE 历史投影转换为安全整数，仅调整响应，不修改库中历史及业务 ID。否则有序渲染器会退回纯文本，专家团活动卡和工具过程无法回显。回归同时验证大整数业务 ID 保真、渲染序号类型及旧父子任务历史。

租户子会话实时订阅通过 HEARTBEAT 的字符串 `scopedSessionId` 选择；BE 在更新频道前调用 Node 会话读取接口校验用户权限。空字符串取消订阅，拒绝访问时保留原订阅；HACU 心跳保留选中会话，重连的企业切换确认后恢复订阅。

任务页 `/api/v1/sessionResources/query` 必须携带租户上下文并经过 BE 租户校验，随后从 Node 授权读取会话；未绑定项目（含 `projectId=-1`）的父子任务返回空资源页，不查询平台个人会话。

租户话题列表路由到 Node 的 `/group-chats/{id}/topics` 集合，不能用群详情响应替代列表；话题消息继续使用对应 topicId 的消息接口。文件页共用 HACU 的任务文件、工作组云盘和对话上传组件及现有文件资源接口，不新增租户专属文件存储。

租户候选任务标题和模型声明的任务名称按 UTF-8 字节限制截断到 255 字节，保留完整 Unicode 字符，兼容 openGauss VARCHAR 字节上限；群消息正文完整保留。回归覆盖长中文和 emoji 消息。
