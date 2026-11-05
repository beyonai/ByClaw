# 知识、工具与技能的组织发布范围

日期：2026-11-05。目标分支：D0.6.0。数据库迁移：V0.6.0。

## 1. 已确认的业务规则

1. 发布使资源进入目标组织的企业目录，不自动授予使用、管理权限，不自动安装技能。
2. Whale 首次同步企业资源未带发布组织时，提交“全公司”发布申请；审核通过后才进入企业目录。同步显式授权和固定个人助手关联仍独立执行。
3. 发布采用组织审核：组织管理员处理管理范围内的组织，全公司由当前企业具备全公司审核资格的管理员处理。审核资格不等于编辑资源资格。
4. 知识（KG_DOC / KG_DB / KG_QA / KG_TERM）、工具（TOOL / TOOLKIT / MCP / AGENT）、技能（SKILL）统一发布范围模型；数字员工保留现有业务，不复用其写入 FORCE_USE 的发布授权方法。
5. 个人资源归属、企业租户、发布组织、管理权限、使用权限相互独立。`owner_type` 和 `com_acct_id` 保留原义，`man_org_id` 不承担多组织发布范围。
6. 发布范围收窄不会撤销已获使用权，也不会卸载已安装技能。需要停止使用时，执行资源下架或撤销使用授权。

## 2. 范围和权限

全公司与具体组织互斥；组织可多选，每个组织覆盖当前有效下级组织。父子同时选择时规范化为父组织，所有组织必须属于当前企业。组织名称只用于展示，审核历史保存申请时名称；组织删除或移出企业后不能继续生效，范围不会自动扩大成全公司。

企业目录条件为：当前企业 + 已上架 + 生效发布范围覆盖访问者 + 原有查看权限限制 + 搜索筛选。公共列表按数据库分页前过滤，count 与列表共用条件。组织筛选使用发布目标，而非创建者或管理组织；“全公司”只显示 COMPANY，选择组织时不混入 COMPANY，勾选包含下级时追加发布到下级的资源。

“我可用的”、安装候选和运行时按实际使用权限处理，发布范围不生成使用权。基础信息仅包含名称、简介、分类、发布范围；技能下载地址、工具凭证和配置、知识正文仍需原有内容访问权限。已有显式查看、使用、管理资格的访问继续遵守其原有边界，不能用收藏、直接 ID 或旧查询入口绕过权限。

管理员、创建者、管理授权人可从管理入口查看自己有资格处理的未发布资源。一般浏览者不能看到 NONE 或待审核范围。所有租户、操作者和审核上下文由服务端计算，不信任请求里的用户或企业标识。

## 3. 数据结构

以下是设计字段；可执行迁移仅放在 `deploy/migrations/versions/V0.6.0/`，DDL 与 DML 分离，不修改 initdb 及迁移合并标记。

### 3.1 ss_resource 扩展

| 字段 | 类型 | 约定 |
|---|---|---|
| publish_scope_mode | varchar(16) | LEGACY 历史未设置、NONE 尚未发布、COMPANY 全公司、ORGS 指定组织 |
| publish_scope_revision | bigint | 生效范围并发版本，初始 0 |
| publish_scope_controller | varchar(16) | BYAI 本地维护、SYNC 同步维护 |

历史行默认 LEGACY；新建支持的企业资源显式初始化 NONE。个人资源不创建组织发布。COMPANY/ORGS 与生效范围表同事务更新。资源上下架状态与发布审核状态分别展示，待审核不能自动变成公共目录可见。

### 3.2 resource_publication：发布申请

| 字段 | 类型 | 说明 |
|---|---|---|
| request_id | bigint PK | 申请标识 |
| tenant_id / resource_id | bigint | 当前企业、企业目标资源 |
| source_resource_id | bigint nullable | 个人技能源资源 |
| request_source | varchar(32) | UI / SYNC / LEGACY |
| operation | varchar(32) | PUBLISH / ADD_SCOPE / REPLACE_SCOPE / RETRACT |
| applicant_id / applicant_name | bigint / varchar(255) | 申请人快照 |
| review_snapshot_json | text | 不含凭证的资源审核信息 |
| resource_fingerprint | varchar(64) | 审核相关元数据及技能包指纹 |
| before_scope_json / requested_scope_json | text | 修改前、申请目标范围 |
| status | varchar(16) | DRAFT / PENDING / CLOSED / WITHDRAWN / SUPERSEDED |
| revision / base_scope_revision | bigint | 申请及范围并发版本 |
| idempotency_key | varchar(128) | 同资源操作的幂等键 |
| comment | varchar(2000) | 操作说明 |
| created_at / submitted_at / closed_at / updated_at | timestamp | 生命周期 |

唯一约束：`tenant_id, resource_id, idempotency_key`；同一资源 DRAFT/PENDING 最多一条。索引覆盖租户、资源、状态、申请人和创建时间。申请处理状态与逐组织结果分开：页面按目标记录计算全部通过、部分通过、驳回等，不由单个资源状态推断。

### 3.3 resource_publication_target：组织审核

| 字段 | 类型 | 说明 |
|---|---|---|
| target_id | bigint PK | 审核目标 |
| tenant_id / request_id | bigint | 企业及申请 |
| org_id | bigint | -1 全公司；正数为组织 |
| org_name_snapshot | varchar(255) | 申请时组织名称 |
| status | varchar(16) | PENDING / APPROVED / REJECTED / CANCELLED |
| revision | bigint | 并发版本 |
| reviewer_id / reviewer_name | bigint / varchar(255) | 审核人 |
| reviewed_at / applied_at | timestamp nullable | 审核、生效时间 |
| comment | varchar(2000) | 审核意见 |
| created_at | timestamp | 创建时间 |

唯一约束：`tenant_id, request_id, org_id`；待审索引：`tenant_id, org_id, status, request_id`。审批和生效同事务；REPLACE_SCOPE 在全部目标通过前保留旧范围，已通过但尚未应用的目标 applied_at 为空。

### 3.4 resource_publish_scope：当前生效范围

| 字段 | 类型 | 说明 |
|---|---|---|
| scope_id | bigint PK | 生效范围标识 |
| tenant_id / resource_id | bigint | 企业及资源 |
| org_id | bigint | -1 全公司，其余为组织 |
| request_id | bigint | 来源申请 |
| effective_at | timestamp | 生效时间 |

唯一约束：`tenant_id, resource_id, org_id`；筛选索引：`tenant_id, org_id, resource_id`。所有写入校验资源、申请、组织的企业一致。软删除保留审核历史且不再可见；现有彻底删除入口由外键级联清理申请、审核目标和生效范围，避免阻断删除。组织是查询时动态展开的目标，不能将当时成员快照当作永久范围。

### 3.5 knowledge_provision_task：外部建库

外部创建与数据库事务不能原子提交，单独保存可恢复任务：task_id、tenant_id、resource_id、applicant_id、provider_id、idempotency_key、request_hash、request_json、external_code、status、error、created_at、updated_at。状态为 PENDING / CREATING / SUCCEEDED / UNKNOWN / FAILED。请求中不复制凭证，服务端读取受控提供方配置。幂等键唯一，UNKNOWN 不自动重试创建；只有提供方支持幂等创建或查询确认后才能重试。

## 4. 状态、审核和并发

- prepare/save 只建立草稿；submit 冻结审核快照并生成组织目标。
- PUBLISH、ADD_SCOPE 按组织逐项生效。A 通过、B 待审时，只有 A 生效。
- REPLACE_SCOPE 必须全部新目标通过，才一次性替换旧范围。任何驳回都不改变旧范围。
- 撤回只取消未处理目标；已生效部分通过 retract 撤销。retract 记录前后范围及执行人，不伪造组织审核。
- 资源管理者可收窄自己有资格维护的范围；单纯组织审核角色不能修改资源或扩大其他组织范围。
- 审核资格读取当前角色和组织关系，不信任申请时缓存的角色。
- 写操作采用 revision 条件更新和唯一约束。审核明细、申请状态、范围行及资源范围版本在同一事务内提交，不使用 SELECT FOR UPDATE。
- 已过期的请求或并发冲突返回明确错误；同幂等键返回原申请。批量审核先校验全部目标，发生冲突整批回滚。
- 个人技能继续审核独立企业副本，保留包哈希与命名规则。全部驳回或撤回且未有任何组织生效时，可由个人源入口重新生成最新包副本；已生效副本继续独立维护。申请保存来源资源及 adminvip 来源保护快照，不能通过修改副本元数据或删除源资源降低审核资格。待审核期间关键元数据或包发生变化时拒绝旧快照审批并要求重新提交。日常知识入库、已发布资源的普通内容同步不额外引入逐次内容审核。

## 5. 接口

统一前缀 `/byaiService/resourcePublication`：

| 方法 / 路径 | 用途 |
|---|---|
| GET /scopeOptions | 当前企业组织与全公司选项 |
| GET /capabilities | 发布、审核、维护能力 |
| POST /prepare | 幂等创建或返回草稿 |
| POST /save | 保存范围，携带申请 revision |
| POST /submit | 提交草稿，冻结审核依据 |
| GET /detail / GET /current | 申请详情、资源最新申请与生效范围 |
| GET /list / GET /pendingCount / GET /pendingCounts | 我的申请、待我审核、总数量或按资源业务类型分组数量 |
| POST /review | 指定目标通过或驳回，校验版本 |
| POST /withdraw | 撤回未处理目标 |
| POST /retract | 撤销生效发布，写操作记录 |

范围格式：`{"mode":"COMPANY"}` 或 `{"mode":"ORGS","orgIds":["101","202"]}`。不接受空组织数组表示全公司，不接受同时选择全公司和组织。请求、资源和组织 ID 用字符串传输，JSON 文本范围字段中的组织 ID 也保存为字符串，以避免 JavaScript 精度丢失。revision、scopeRevision 为版本数。

查询继续使用 `/auth/privilegeGrant/listResourceUseAuth`，增加 `audienceScopeMode=ALL/COMPANY/ORGS/UNSET`、`audienceOrgIds`、`audienceIncludeDescendants`。分页前筛选，组织筛选与原有类型、分类、搜索、收藏、状态和权限条件组合。返回 publishScopeMode、publishScopeRevision、publishScopeController、publishedScope、canManagePublishScope。申请状态、版本、可审核目标及操作资格从 /current 或 /detail 读取；待审组织和审核意见只返回给有资格的参与人。

写接口参数约定：

- prepare：resourceId、operation（PUBLISH / ADD_SCOPE / REPLACE_SCOPE）、publishScope、idempotencyKey。返回草稿及 revision；同资源存在未完成申请时不能另建冲突申请。
- save：requestId、revision、publishScope；submit / withdraw：requestId、revision；review：requestId、revision、targetOrgIds、approved、comment。审核目标必须全部在当前操作者可审核范围内。
- retract：resourceId、scopeRevision、targetOrgIds、idempotencyKey、comment；只允许移除已生效目标，存在进行中的申请时应先处理或撤回。
- list：review=true 查询当前审核范围内的申请（含历史），false 查询本人申请；page、size 和 resourceBizTypeList 组合分页。pendingCounts 的值按申请去重，而非把每个待审组织都算一笔。
- detail 返回 publication、targets（逐项 canReview）、scopeMode / scopeRevision / scopeController、publishedScope，以及 canManage / canSubmit / canWithdraw / canReview。审核与修改操作均应采用最近一次响应版本，发生冲突后重新读取。

现有 `/tool/publishSkillToEnterprise` 保持企业副本创建兼容入口，统一接入新发布申请，不再由旧审核接口重复完成同一笔新申请。新企业上传、导入、知识创建支持 publishScope；缺少字段的旧本地客户端保存未发布资源，不隐式发布；Whale 首次同步的缺省行为单独处理。

## 6. 同步契约

现有 `/tool/addToolFromThird` 增加独立 publishScope，保持 viewAuth、authScope、autoAuthorize 的缺省/显式 false 语义。发布审核不写 ALLOW_VIEW、AVAILABLE_USE、FORCE_USE，不改变个人助手自动关联规则。

| 场景 | 行为 |
|---|---|
| 新企业资源，未带范围 | NONE + 全公司待审申请 |
| 新企业资源，带合法组织 | NONE + 组织待审申请 |
| 已有资源，未带范围 | 保留范围及审核状态 |
| 同范围重复同步 | 返回原申请，不重复审批 |
| SYNC 维护，范围改变 | 建立新变更申请，旧范围继续生效 |
| BYAI 人工接管，范围改变 | 保留本地范围，响应提示 IGNORED_LOCALLY_MANAGED |
| 本地创建的个人知识库回流 | 保留个人归属，不套用企业缺省范围 |

响应分开返回资源入库、authorization/association、publication。发布待审核不表示同步失败；显式授权可能使用户先在“我可用的”访问资源，但不使其提前进入公共企业目录。

范围维护权切换由有资格的本地操作者显式触发，普通查看、审批本身不切换维护方。同步请求不能伪造 BYAI 本地归属标记。任何跨企业资源或组织参数都拒绝。

## 7. 百应创建 Whale 知识库

提供方复用当前企业中用户具有使用权限、已上架的外部 KG_DOC 资源描述，不新增凭证输入入口。`queryKnowledgeCapability` 返回 creationProviders（providerId 是该资源 ID、providerName 是资源名）；仅暴露明确声明 POST create_kb action 或 OpenAPI operationId=create_kb 的提供方。企业创建表单选择发布范围、服务提供方；个人创建不选择发布组织。服务端按提供方 CREATE_KB 能力决定是否允许创建，不再单凭第三方模式禁用。查询型提供方仍可导入和使用。

流程：验证权限/范围和幂等键 → 保存创建任务 → 调用受控提供方建库 → 保存外部标识和 ss_resource/扩展表 → 标记本地归属 → 企业资源提交发布申请。创建成功但发布提交失败时保留资源并允许重试，不重复建库。外部返回超时为 UNKNOWN，不能自动再次创建或删除来源库。

建库通过服务端已保存的 domainURL、headers 和接口描述执行，禁用自动网络重试及跳转。成功响应必须有可识别的外部库编码（knCode / kbCode / knowledgeCode / knowledgeBaseCode / resourceCode，可在 resultObject 或 data 下），HTTP 成功且存在的 resultCode 必须为 0、code 必须为 0 或 200。返回超时、格式不明或缺少编码均不猜测成功。UNKNOWN 或停留在 CREATING 的任务需要运营核对提供方结果，本期不提供人工核对页面；已确认外部编码但本地事务失败可用同一幂等键恢复本地记录。

复用现有 DatasetOwnershipMetadata 的本地归属保护。回流同步按持久化外部标识找到同一资源，不能覆盖本地创建人、个人/企业归属和发布范围。个人知识库复制或转移到企业另行设计，禁止复制 ss_resource 却共用同一底层库冒充隔离副本。

## 8. 页面

- 企业知识、工具、技能页签：增加全公司、组织多选、包含下级筛选；卡片和详情展示生效发布范围，历史行显示未设置。
- 企业上传技能、导入工具/知识、创建知识：选择发布范围；分别反馈创建成功与发布审核状态。个人入口保持原行为。
- 个人技能发布：增加范围选择、组织审核进度，复用已准备副本。
- 员工内技能上传仍是上传和绑定；需要企业发布时进入统一发布流程。
- 资源管理页：查看当前范围与申请差异、调整范围、撤回申请、撤销发布。范围维护方和同步忽略原因可见。
- 审批中心：知识、工具、技能都有使用申请/发布审核切换，支持逐组织审核、部分通过、历史记录。待审数只统计当前用户可以处理的目标。
- 资源可用状态与发布状态分别展示。例如“已上架；发布到研发；财务待审”。

## 9. 兼容与发布顺序

1. V0.6.0 增量迁移创建新表并增加字段，历史资源为 LEGACY，不自动扩大范围或修改授权。DDL 位于 `V0.6.0__ddl.sql` 的 `RESOURCE_ORGANIZATION_PUBLICATION` 段；已经执行过本版本早期内容的环境只执行新增段，不能重新执行整个历史迁移文件。
2. 后端新接口先部署；老接口接入统一校验。旧 SKILL_PUBLICATION 历史保留；新申请不能被旧审核接口绕过组织审核。历史待审申请通过受控适配处理，不能出现两份有效审批。
3. 前端启用新入口。无明确历史证据的资源展示“未设置”，管理员通过审核补设范围；不从 man_org_id、创建者组织或同步账号推断。
4. 不改 initdb，不执行迁移合并；租户迁移范围按 V0.6.0 现有布局处理。
5. 回滚应用时必须评估旧版本不识别范围的影响，不能直接降级旧公共列表而使受限资源重新可见。先关闭公共资源目录入口或使用理解范围的兼容版本。

## 10. 实施与验证

按以下顺序实施：迁移和实体 → 范围规范化/资格/事务状态机 → 分页查询和详情边界 → 技能发布与本地导入 → Whale 同步 → 外部建库任务 → 前端组织组件和审批 → 回归。

必须覆盖：组织父子去重、跨企业拒绝、部分审批、替换全通过才生效、重复审核/提交、审核快照变化、申请撤回与生效撤销分离、权限不增长、同步重复和省略字段、本地接管、历史 LEGACY、查询 count 一致、只有查看权限不能下载/安装/调用、撤销发布保留已有使用权、外部建库超时与回流去重。

执行迁移 dry-run、后端 Maven verify、前端非修改式 lint、测试和 build。业务授权 Redis 继续使用已有抽象，本功能不新增旁路 Redis 客户端或跨槽写操作；若实际改到 Redis 行为须同时验证单机和真实 Cluster。运行时无环境或提供方接口未能调用时必须明确列出，不将静态/模拟测试说成端到端通过。

## 11. 实施记录

设计已确认，迁移版本和本文随代码提交均已获用户明确授权。

- 发布事务仅更新申请、组织审核、生效范围和范围版本，不生成使用授权；同步已有显式授权仍按原流程执行。
- 本地导入完成后单独提交发布，业务校验失败保留已创建资源并返回 publicationError。外部建库使用短事务持久化任务；原生知识创建的本地资源与扩展表同事务保存。
- 新申请统一组织审核；旧 LEGACY 技能申请继续使用原审核入口。企业目录在分页前应用发布范围条件，运行时和可用资源列表保留原使用权限判断。
- 后端全量 `mvn verify` 通过；最终提交检查再次执行 `mvn clean test`，7,025 项测试，0 失败、0 错误、50 跳过，包含新增删除级联、动态组织范围、审核及外部建库恢复用例。
- 前端依赖锁定安装、lint:js、lint:style:check、lint:prettier 与生产构建通过，运行环境使用 Node 18。最终提交检查全量回归：574 组通过、4 组跳过；5,032 项通过、47 项跳过。早期并行构建期间曾出现既有岗位管理用例超时，独立重跑及最终全量检查均已通过；发布页面 5 项回归包含原组织删除后的范围更换。
- 迁移 `merge_migrations.py --dry-run` 在仅包含 Git 跟踪文件的临时副本中通过；原工作区存在未跟踪的 .DS_Store 与历史 baseline 目录，未删除或改写这些文件，也未执行迁移合并。
- H2 集成测试不验证 PostgreSQL 的部分唯一索引；未向测试或生产环境执行迁移，未执行真实 Whale 建库或 Harness / OpenClaw 调用。现有仓库 TypeScript 全量检查存在大量存量错误，本次使用项目要求的 lint、Jest 和生产构建验收。
