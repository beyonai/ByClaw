# 租户上下文入口

`GET /byaiService/tenantContext/available` 按当前登录用户查询 `ACTIVE` 租户成员关系，并返回企业 ID 字符串、企业名、该用户角色和开通状态。缺失或损坏的 `PROVISION_STATE` 显示为 `UNAVAILABLE`。响应不返回配置纵表原文、数据库凭证或 fencing token。

`POST /byaiService/tenantContext/switch` 重新核验当前用户为 `ACTIVE` 成员且租户为 `READY`。客户端仅保存企业 ID 字符串；后续 HTTP 使用 `X-Enterprise-Id`，BE 每次重新查成员关系。尚未接入租户路由的业务接口会拒绝带此 Header 的请求，不能落到个人数据路径。后续租户业务接口还须检查目标对象归属；`READY` 也不能代替实时 DB/Node 健康检查。

WebSocket 在原连接上发送 `SWITCH_TENANT` 消息，payload 带 `enterpriseId` 和 `clientRequestId`。BE 重验成员、清除旧会话订阅后回 `SWITCH_TENANT_ACK`；FE 收到匹配回执才提交本标签页选择。后续消息须带相同 `enterpriseId`，BE 每帧重新验成员。租户聊天路由未完成前，租户业务消息会被拒绝；旧个人广播不会推送到已选择租户的连接。

平台管理员可用 `POST /byaiService/admin/tenants/members/list` 和 `POST /byaiService/admin/tenants/members/add` 列出成员或按 `userCode` 加入一名 ACTIVE 用户。`enterpriseId`、`userCode` 均放在 JSON body 中。添加操作锁住套餐快照行，检查套餐人数上限和现有成员状态；开通中可先准备成员，但业务访问仍须等到 `READY`。重复添加 ACTIVE 成员返回原成员，DISABLED 成员须通过单独的恢复流程处理。

组织沿用平台 `po_organization` 层级，通过 `tenant_organization` 挂靠到企业租户；同一组织可挂靠多个租户。`POST /byaiService/admin/tenants/organizations/tree` 返回组织树和挂靠状态，`/members` 预览所选组织及可选下级组织的 ACTIVE 用户，`/attach` 可仅挂靠组织或同时批量加入其用户。所有参数均在 JSON body 中。批量加入在同一事务中检查套餐人数上限，超限时整批回滚。

`TenantCredentialCrypto` 从环境变量 `BYCLAW_TENANT_CREDENTIAL_MASTER_KEY` 读取 64 位十六进制字符（32 字节）的独立随机密钥，通过 HMAC-SHA256 和租户 `enterpriseId` 派生 128 位密钥，生成 SM4-GCM v2 密文信封。信封的 nonce、ciphertext、tag 使用租户 Node 接受的标准带填充 Base64；AAD 绑定 `enterpriseId` 和固定数据库名。新建租户数据库前必须配置此密钥，并在 BE 实例间保持一致。旧 v1 Base64URL 信封仍可解密以便迁移；它们使用仓库历史共享密钥，应尽快轮换。密钥不得写入规格、SQL 或日志。
# 管理端租户创建

平台管理员通过 `POST /byaiService/admin/tenants/create` 提交 `enterpriseName`、`packageId`、`requestId`，通过 `POST /byaiService/admin/tenants/list` 查看租户。创建事务写入企业、所有者成员关系、套餐快照和 `RESERVED` 开通状态；同一个 `requestId` 重试返回原租户。`RESERVED` 不能切换进入业务空间，必须由沙箱与 schema 开通流程推进到 `READY`。

列表接口支持 `name` 模糊查询、`createdFrom`/`createdTo` 半开时间段过滤，以及 `createdAt`、`openedAt`、`enterpriseName` 白名单排序。创建时间取开通请求记录，开通时间仅在状态达到 `READY` 时显示；失败原因存于 `PROVISION_FAILURE_REASON`，成功重试后清空。租户 OpenGauss 依赖启用 `BYCLAW_SANDBOX_PROFILE_ENABLED=true` 以加载套餐资源规格。

## 工作组名称与解散历史

创建工作组按已验证的当前租户和创建者校验名称。未解散的同名工作组继续占名；已解散的工作组允许同一创建者重新使用原名，新建独立工作组和 HACU 项目 ID。原会话、成员、消息、项目、云盘和工作目录均保留，不重命名、不软删除，也不复用旧项目。普通项目的同名冲突仍会阻止建群；普通项目的新建和编辑查重也限定在项目所属租户及创建者范围内。默认空间兼容历史 `enterprise_id IS NULL` 数据。

租户工作组的占名状态通过 `POST /internal/v1/group-chats/name-check` 从对应 Node 查询；Node 不可用时中止创建。Node 在建群事务内按租户、创建者和规范化名称加锁并再次校验，拒绝并发同名创建。个人/开发环境从既有会话库按相同范围查询。关联项目的企业 ID 优先取已验证的租户上下文，而非登录用户的默认企业。

名称未变化时，项目编辑不会因保留的同名历史项目而被拒绝；实际改名仍按项目所属租户查重。BE 与 Node 使用相同的首尾空白规范化规则和 100 字符限制。此版本包含新增 Node 查询接口，发布时先更新租户 Node，再更新 BE。

## D0.5.0 聊天兼容范围

无租户上下文时继续使用个人聊天与原有工作组处理路径。带租户上下文时，业务读写先经过 Node 的企业、当前用户和目标会话授权，不能回退到个人消息表。

- `/chat/superAgentChat`、运行状态、运行快照、停止、消息查询、trace 查询和结构编辑接入租户路由。未落库的回答可在授权会话的精确快照中编辑；不会跨会话扫描。跨实例停止不得将租户快照写入个人消息库。
- 会话创建保留 `agentId` 和 `projectId`；数字员工维度的会话查询在租户库中执行。消息反馈及结构编辑通过幂等 Node 命令执行。
- 新工作组可在创建时加入已验证的 ACTIVE 租户用户和数字员工，支持设置、成员角色、群主交接及退出。既有工作组按企业与成员关系识别后仍使用原有服务。
- 新租户工作组的撤回、邀请链接等未移植操作继续返回 409。撤回不能仅设置数据库标记：还需可靠取消关联执行、补偿重试及租户事件广播。这些场景尚不能视为已通过验收。

Java 到 Node 的独立协议 mapper 保持版本号和分页为 JSON 数字；业务 ID 仍以字符串传输。它不改变公共 MVC mapper。前端仅向已接入的业务接口发送租户头，共享模型目录不附带租户头；同一登录会话中的上下文续期不触发空间切换或中断流式请求。

离线回归覆盖个人路径、拒绝跨租户访问、协议 hash、反馈、会话与工作组操作。真实 openGauss、Redis、Gateway、SSE 和多实例故障恢复仍需部署环境联调；本次兼容修复不包含数据库迁移或发布生成操作。

前端能力受 `ENABLE_MULTI_TENACY` 控制：公共布局通过 `/byaiService/system/session/getDcSystemConfigValueByCodes` 批量查询，仅非空字符串 `"1"` 开启。缺失、空响应、其他值或请求失败均关闭；关闭时隐藏空间切换入口、清理旧租户选择，HTTP/WebSocket 不附带旧租户上下文。系统开关查询完成前不挂载业务路由。此开关控制前端业务入口，不替代服务端逐请求的成员与资源授权。

租户工作组单 @ 一个数字员工（包含群组工作助手）沿用个人空间的候选分流：执行员工通过当前 dispatch 绑定的控制文件判断 `CHAT/TASK`，BE 复用严格校验的文件读取器，将服务端判定镜像给 Node。合法 `TASK` 可在执行中晋升正式任务并展示接收回执及子会话卡片，完整成果保留在任务会话；`CHAT` 只向原群返回回答，不生成任务记录或卡片。终态没有合法判定时按 `CHAT` 处理，错误终态不生成成功回答。候选和已结束的聊天执行会话不进入普通会话、子会话和群任务列表。

用户一次 @ 两个及以上不同数字员工仍由系统直接创建 `GROUP_TASK`，交给群组工作助手协调，模型不能降级为 `CHAT`。候选身份、原消息边界、群成员权限和调度范围均由 Node 持久数据回填，客户端不能伪造分类或候选参数。执行中的分类观察复用现有执行表和镜像序号，终态重试与恢复读取已提交状态；不新增数据库迁移或 Redis key。发布需先更新租户 Node，再更新 BE；HACU 的既有卡片协议保持兼容。本次不自动清理升级前已经创建的历史任务卡片。

管理端侧栏的租户管理、租户数据源与沙箱页的租户资源也受此开关控制。关闭时沙箱页使用用户资源，不请求租户列表或显示租户启动入口；开关变化后重新加载对应资源，旧列表请求不得覆盖新空间的结果。HACU 开启多租户时仍保留默认企业 ID `1` 的切换项，默认企业使用普通空间，不携带租户请求头。
