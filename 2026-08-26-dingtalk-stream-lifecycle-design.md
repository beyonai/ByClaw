# DingTalk Stream 连接生命周期修复设计

## 背景

ByClaw 当前通过 `DingtalkRobotRegistryService` 管理每个 `robotCode` 对应的钉钉 Stream 长连接。配置刷新时，只要 `appId`、`cardTemplateId`、`resourceName` 等任一字段变化，现有实现就会停止并重建连接。与此同时，`OpenDingTalkClient.start()` 在业务线程池异步执行，刷新、注销和应用关闭可能与尚未完成的启动任务交错。

项目当前同时使用两套职责不同的钉钉依赖：

- `com.aliyun:dingtalk`：OpenAPI、OAuth、通讯录和互动卡片客户端；与 Stream consumer executor 无关，本次保持现有 `2.2.17`。
- `com.dingtalk.open:app-stream-client`：Stream 长连接客户端；本次计划从 `1.0.5` 升级到已包含拒绝任务处理的 `1.3.14-beta.1`。

`app-stream-client:1.0.5` 在连接关闭后仍收到晚到帧时，会直接向已经关闭的 consumer executor 提交任务，导致未处理的 `RejectedExecutionException`。仅减少 ByClaw 主动调用 `stop()` 的次数可以降低发生概率，但不能消除 SDK 内部竞态。

目标版本 `app-stream-client:1.3.14-beta.1` 的 `OpenDingTalkClient.start()` 只负责启动 SDK 内部连接调度器，随后即可返回。真正的鉴权、获取 endpoint 和 WebSocket 建连发生在 SDK 自己的 `ConnectionTask` 中；该任务捕获建连异常并按 SDK 固定周期继续重试，异常不会传播给 Registry。因此 Registry 只能判断“SDK 运行时是否启动”，不能仅凭 `start()` 返回判断物理连接已经建立，也不能用 `start()` 的异常次数代替真实建连失败次数。

## 目标

1. 只有 Stream 认证字段变化、机器人删除、明确注销或失败后的明确恢复操作才重建客户端。
2. 配置提交、启动、同步启动失败重试、资源注销和应用关闭遵循同一套可验证的生命周期规则。
3. 旧启动任务、旧重试任务、旧客户端和旧清理动作不能覆盖、删除或复活新一代运行时状态。
4. 同一 `robotCode` 在所有活跃实例中最多只有一个有效连接租约持有者；单实例内最多发布一个 SDK 运行时，并禁止跨资源静默抢占。
5. SDK consumer executor 关闭后收到晚到帧时，不再向业务日志抛出未处理的 `RejectedExecutionException`。
6. 配置持久态、配置缓存和连接运行态只在数据库事务提交后收敛，事务回滚不产生运行态副作用。
7. 两个钉钉 SDK 可以独立验证和独立回退。

## 非目标

- 不改变钉钉消息、互动卡片或机器人配置 JSON 协议。
- 不实现全局 leader 选举；多实例只复用现有 Redis CAS 锁能力做每个 `robotCode` 的细粒度连接租约。
- 不重构其他渠道的连接注册服务。
- 不扩展 `DingtalkTestController` 的权限体系；该控制器的治理另行处理。
- 不把 SDK 内部物理连接状态伪装成 Registry 可直接观测的状态；若未来需要精确连接健康度，应通过官方接口或最小 fork 暴露连接事件。

## 兼容性与最小改动约束

1. 不新增数据库表、数据库迁移、机器人配置字段或外部消息协议。
2. 保留 `DingtalkRobotConfigService`、`DingtalkTokenService`、卡片和文件服务现有公开方法；Stream 路径通过重载传入 `DingtalkMessageContext`，原调用方继续走原有逻辑。
3. 保留消息解析、权限校验、会话创建、文件处理、卡片发送和回复正文逻辑，只调整回调接收边界及配置/token 的取值来源。
4. 配置元数据刷新仍然即时生效且不重连；凭证变化、删除和注销的外部行为保持不变，只增加代次保护和失败恢复。
5. 优先复用现有 `TransactionSynchronization.afterCommit()`、Spring `@Scheduled`、Registry `refreshLock`、`RedisUtil.lock/renewLock/releaseLock` 和现有服务查询，不引入新的中间件或跨模块框架。
6. 新增行为必须由针对性测试覆盖，并运行现有 DingTalk、数字员工和后端完整回归，确认非 Stream 调用路径不变。
7. 不修改企微连接锁实现，也不让 DingTalk 直接依赖 `WecomConnectionLockService`；DingTalk 只复用公共 `RedisUtil` 原语和已验证的 CAS-token 模式，避免形成渠道间源码耦合。

预计生产代码改动限制在 DingTalk Stream Registry/配置/token/listener 及其内部模型、`RobotChannelRegistryCoordinator` 的校验异常分流、数字员工服务的一条只读查询、现有数字员工事件 publisher 的 runtime-only 内部重载和变更频道的轻量订阅器。部署清单无需降为单副本，其他渠道 Registry、数据库结构、控制器协议和消息正文处理保持不变。

## 核心设计

### 1. 连接配置与运行时元数据分离

连接是否需要重建只由以下字段决定：

- `robotCode`：注册表键；变化表现为旧键删除、新键注册。
- `clientId`
- `clientSecret`

以下字段属于运行时元数据，只更新 `DingtalkRobotConfigService` 的配置快照，不停止连接：

- `resourceName`
- `appId`
- `cardTemplateId`
- `channel`

`resourceId` 是配置所有者，不属于 Stream 认证字段，但不允许同一 `robotCode` 在不同 `resourceId` 之间静默迁移。跨资源重复必须在数据库提交和连接生命周期之前被拒绝。

### 2. 事务提交是运行态变更边界

数字员工创建、更新和删除当前都可能在数据库事务中触发 Registry。新设计把“校验配置”和“改变运行态”拆开：

1. 事务提交前解析并校验目标配置，包括字段完整性、同一资源内部重复和跨资源 `robotCode` 冲突。
2. 校验失败时向业务调用方返回明确错误，事务不提交；`RobotChannelRegistryCoordinator` 不得吞掉这类校验错误。
3. Registry 的 register、refresh 和 unregister 保留现有公开签名，但公开方法本身是 `validateAndScheduleXxx()`：同步完成解析、所有权校验和事务互斥器登记，只把 `applyCommittedState(resourceId, trigger)` 放入仓库已有的 `runAfterCommitOrNow`。不得把校验本身延迟到 `afterCommit()`。
4. 事务回滚时不修改配置快照、slot、client 或 token。
5. after-commit 每次重新读取数据库最新配置，不按事件携带的旧配置增量执行；同一事务内同一 `resourceId` 的重复请求通过事务绑定 Map 合并。
6. 本机 after-commit 完成后，复用现有 `DigEmployeeChangeEventPublisher` 的 Redis Pub/Sub 事件通知其他实例重新读取该 `resourceId`；增加轻量 `DingtalkRuntimeChangeSubscriber`，不新增事件格式。Pub/Sub 丢失、进程崩溃和临时执行失败由定时 reconciliation 兜底。每轮分别读取“全部未软删除资源”和“当前应在线资源”：前者构造所有权快照，后者决定哪些 slot 应运行；已不在线但未删除的资源只停止运行时，不释放所有权，已软删除的资源才从快照移除。

为避免两个并发事务同时通过 `robotCode` 唯一性校验，所有可能新增或改写 DingTalk `robotCode` 所有权的事务必须经过第 4 节定义的跨实例配置写互斥器，并在 JVM 内用可重入事务绑定避免同一事务重复取锁。公开 Registry 方法在校验前取得互斥器，在事务 `afterCompletion` 后释放，使“读取现有所有权、校验目标配置、提交数据库”成为跨实例串行区间。无事务但可能取得新所有权的写路径在同一次调用中同步校验、执行并在 `finally` 释放。纯下线、删除等只释放所有权的路径不会制造冲突，不强行引入提交前互斥；它们在持久状态成功后立即执行幂等 stop/unregister，失败由周期扫描收敛，避免现有无事务删除出现“数据库已删但接口因事后取锁失败”的新语义。取锁、续期或所有权扫描失败均 fail closed，不允许可能取得新所有权的事务仅靠事后扫描修正已经提交的冲突。

`RobotChannelRegistryCoordinator` 仍可隔离不同渠道的运行时异常，但必须区分：新增的 `DingtalkRobotConfigValidationException` 属于提交前业务校验异常，必须向上抛出；提交后生命周期异常记录并等待下一次定时 reconciliation，不能用同一个 `runQuietly()` 吞掉两类错误。数字员工创建、更新路径在现有事务内完成该同步校验；现有无事务删除路径在资源状态写入成功后走上述无事务即时分支，重复执行保持幂等，并由周期扫描兜底。

远端事件订阅复用现有 `RedisMessageListenerContainer` 和 `byai:pub:dig_employee_change`，只处理 `DIG_EMPLOYEE_CREATED/UPDATED/DELETED`，回调中不信任事件携带配置，只把 `resourceId` 和触发类型合并进本实例的刷新队列并重新读库。普通提交事件使用 `REMOTE_AFTER_COMMIT`。`forceRegister` 先保持现有本机幂等注册/失败恢复行为；若目标资源存在本机未持有连接租约的机器人，才必须写 `dingtalk:stream:force-request:{resourceId}` = 随机 nonce（TTL 默认 10 分钟，至少覆盖两个扫描周期），再复用现有 `DIG_EMPLOYEE_UPDATED` 载荷发布 `source=dingtalk-force` 的 `REMOTE_FORCE`，不新增频道或事件字段。本机可处理的机器人不因 marker 写失败回滚；但存在远端目标且 marker 写失败时必须返回失败，明确报告跨实例部分未完成。slot 记录 `lastHandledForceNonce`：force 被 active slot 幂等跳过、被 `LEASE_WAIT` 用于尝试或被 `STOPPED` 用于恢复时都同步标记，并在 generation 替换时传递，避免同一请求在稍后失败时再次重置预算。事件可立即触发检查；事件丢失时周期扫描只为 `STOPPED` 读取该 key，发现新 nonce 后执行一次明确恢复。并发 force 允许合并为最新 nonce，一次恢复即可满足相同目的。

为保持既有事件副作用不变，publisher 只增加一个内部 `publishRuntimeOnlyNow(...)` 重载来跳过权限刷新，现有发布方法及其权限刷新行为不改；DingTalk 订阅器以 `source` 识别 force。订阅器用现有 `(eventType, resourceId, source, version, changedAt)` 组成事件身份做本进程有界 TTL 去重，普通事件重复或乱序时只以数据库当前状态 reconciliation，不以事件内容覆盖快照。force marker 写失败必须抛出运行时异常让现有测试接口返回失败，公开 Java 方法仍保持 `void` 签名；marker 写成功后 Pub/Sub 发布失败只影响即时性，由周期扫描闭环。DingTalk Stream 启用时自动注册该轻量订阅器，不依赖默认关闭的独立开关；普通业务提交的发布或订阅失败记录指标，但不回滚已经提交的业务事务。Redis Pub/Sub 仍只缩短传播延迟，不能替代数据库 reconciliation 或 force marker。

定时 reconciliation 复用现有 `DingtalkStreamBotLifecycle`、`SsResExtDigEmployeeService` 和 Registry reconciliation，只为“全部未软删除数字员工”补充一个只读查询，不新增数据库表、消息协议或跨模块持久化组件。任务使用 `fixedDelay`，与手工刷新、远端事件刷新共用 `refreshLock` 和去重队列，前一次未结束时不并发启动下一次；应用启动时立即执行同一套全量 reconciliation。除明确隔离的 `STOPPED/STOP_FAILED` 外，只要进程和依赖最终恢复，最多经过一个扫描周期即可重新收敛。扫描周期可配置，但默认 60 秒，关闭时停止调度器。

Registry 内部 reconciliation 接收 `STARTUP`、`AFTER_COMMIT`、`REMOTE_AFTER_COMMIT`、`REMOTE_FORCE`、`PERIODIC`、`MANUAL`、`FORCE` 触发原因，但不改变现有公开方法签名。所有触发都可以补建缺失 slot、应用已提交的凭证/元数据变化、停止已下线资源的 slot，并删除已软删除资源的快照。`STOPPED` 记录进入该状态时的完整非敏感配置指纹；数据库当前配置指纹发生变化时，任何 reconciliation 都把它视为新的期望配置并创建新 generation，避免丢失事件后永久卡死。配置指纹未变化时，普通 `PERIODIC/STARTUP` 不重置失败预算；本机 `AFTER_COMMIT/MANUAL/FORCE`、远端 `REMOTE_AFTER_COMMIT`，或事件/周期发现未处理的 force nonce 才能明确恢复。`FORCE/REMOTE_FORCE` 对 `RUNNING/STARTING/RETRY_WAIT` 保持现有幂等注册语义，不主动 stop 或重建正常客户端。任何触发都不得绕过 `STOP_FAILED`。

### 3. 配置所有权校验与原子快照

`DingtalkRobotConfigService` 保留现有 `DingtalkRobotChannelConfig` 类型和读取接口，只把内部存储改为一次性发布的防御性快照，避免影响现有调用方：

```java
final class RobotConfigSnapshot {
    long snapshotVersion;
    Map<String, DingtalkRobotChannelConfig> byRobotCode;
    Map<Long, List<DingtalkRobotChannelConfig>> byResourceId;
    Map<Long, List<DingtalkRobotChannelConfig>> ownedConfigsByResourceId;
    Map<String, Set<Long>> ownersByRobotCode;
    Set<Long> onlineResourceIds;
    Set<String> conflictedRobotCodes;
    Set<Long> invalidResourceIds;
}

AtomicReference<RobotConfigSnapshot> configSnapshot;
```

快照构造时复制每个 `DingtalkRobotChannelConfig`，并对 Map/List/Set 使用不可修改副本；读取接口返回只读副本，内部对象不向调用方暴露。为保持现有调用行为，`byRobotCode/byResourceId` 是面向原公开读取接口的**在线运行态配置视图**；离线后这些公开接口仍像改造前一样不再返回该资源。`ownedConfigsByResourceId/ownersByRobotCode` 是仅供校验和 reconciliation 使用的内部所有权视图，来源于全部未软删除资源，因此离线不会释放 `robotCode`。历史冲突进入 `conflictedRobotCodes`，不可解析资源进入 `invalidResourceIds`，二者均不进入运行态配置视图且 fail closed。这样无需把现有 DTO 改成 record，也不要求修改无关消费者。

新增一个内部辅助方法计算 SHA-256 `credentialVersion`。摘要输入必须是无歧义的字节序列：UTF-8 版本标记 `v1`，随后分别写入 `clientId` 与 `clientSecret` 的 4 字节大端长度和值；不 trim、不转大小写。该值只用于内存比较和 Redis namespace，不增加 JSON 字段、不写业务日志，也不替代凭证加密。认证字段不变时版本稳定，任一认证字段变化时版本变化，`("ab", "c")` 与 `("a", "bc")` 等组合不得产生相同输入字节。

`desiredConfigFingerprint` 同样只在内存中使用，按固定字段顺序和长度前缀计算完整机器人配置（包括认证字段及影响行为的元数据）的 SHA-256；不得直接依赖 Map/JSON 默认遍历顺序，也不得记录参与摘要的原值。它用于判断 `STOPPED` 面对的是同一份失败配置还是新的持久期望，不替代 `credentialVersion` 的 token namespace 语义。

资源刷新在发布前完成以下步骤：

1. 查询全部未软删除资源构造所有权候选，同时查询当前在线资源集合；不得仅以 `findOnlineDigitalEmployees()` 构造所有权。
2. 在候选副本上验证同资源和跨资源重复，并区分“无 DingTalk 节点”和“存在但不合法的 DingTalk 节点”。
3. 提交入口发现冲突时拒绝该资源的整次刷新，不修改已有快照或连接；启动/周期全量扫描发现历史冲突时则发布包含完整 `ownersByRobotCode/conflictedRobotCodes` 的新快照，并停止所有冲突 owner 的 slot，不能继续保留某个随机旧运行时。
4. 校验通过后一次性发布新快照，使消息、卡片和主动消息消费者只能看到完整旧版本或完整新版本。
5. Registry 使用实际发布的候选结果进行 reconciliation，不能继续遍历未经接受的原始输入；离线资源从公开运行态配置视图移除并停止 slot，但继续保留内部所有权视图，软删除资源才从两个视图移除并释放所有权。

配置解析由一个内部结果模型承载状态，再保留两条现有入口以兼容调用方：

```java
final class RobotConfigParseResult {
    List<DingtalkRobotChannelConfig> configs;
    boolean hasDingtalkNode;
    List<RobotConfigParseError> errors;
}
```

- 一个私有 parser 始终返回 `RobotConfigParseResult`，明确区分“没有 DingTalk 节点”“合法空结果”和“存在但非法”；reconciliation 必须直接消费该结果，不能根据空 List 猜测删除。
- `validateAndBuildRobotConfigs(...)` 只用于创建、更新等提交入口。无 DingTalk 节点返回空配置；JSON 非法、DingTalk 节点缺少必填凭证或同资源重复时把结构化错误转换为 `DingtalkRobotConfigValidationException` 并阻止提交。
- 现有 `buildRobotConfigs(...)` 只解包 `configs`，继续保持原有宽松返回行为，不改变公开签名和既有调用方。周期扫描根据 parse result 的错误状态记录脱敏指标并保留该资源最后一次已接受的所有权与运行态配置，不把解析失败解释为配置删除；若冷启动没有旧快照，则把资源放入 `invalidResourceIds`、不启动 slot。只能保留非法内容中仍可确定且无歧义的 `robotCode` 所有权；无法可靠解析出的未知 robotCode 不能被臆测占用，必须通过上线前数据扫描和告警清理。只有明确读到合法空配置或软删除状态才执行移除。

所有权扫描范围是全部未软删除的数字员工配置，不限于当前在线或启用状态。下线资源不启动连接，但仍保留其 `robotCode` 所有权；只有删除该机器人配置或资源进入软删除状态后才释放所有权。

当资源 B 提交已属于资源 A 的 `robotCode` 时：

- 保留资源 A 的持久配置、配置快照和运行时；
- 拒绝资源 B 的业务事务；
- 返回包含 `robotCode`、原 `resourceId` 和冲突 `resourceId` 的错误，但不包含 `clientSecret`；
- 记录冲突指标和结构化错误日志。

冷启动若发现历史数据已存在跨资源重复，不按数据库返回顺序选择所有者。所有冲突资源对应的该 `robotCode` 均 fail closed、不启动客户端，并一次性记录全部冲突 `resourceId`。其他没有冲突的机器人仍可正常启动。上线前必须扫描并清理历史重复数据。

连接运行时的多实例唯一发布由下一节的 Redis 租约保证。数据库配置所有权校验使用同一个跨实例配置写互斥器，使两个副本不能同时完成“扫描所有权并提交冲突配置”。

### 4. 多实例连接租约

仓库默认 K3s 部署为两个后端副本，因此不能把单实例当作运行前提。新增轻量 `DingtalkConnectionLockService`，复用现有企微连接锁的 `RedisUtil.lock/renewLock/releaseLock` CAS-token 语义，不新增中间件：

- 锁 key 为 `dingtalk:stream:connection-lock:{robotCode}`，value 是包含实例标识和随机 lease epoch nonce 的不可预测 owner token；凭证轮换可在同一连接所有权周期内把该 token 交给下一 generation。
- slot 创建后先进入 `LEASE_WAIT`；取得租约后才能创建 SDK client、进入 `STARTING` 或发布 `RUNNING`。未取得租约不计入同步启动失败预算，由周期性 reconciliation 再尝试。
- 每个 slot 同时至多有一个 `LeaseAcquireAttempt`。acquire 在 `refreshLock` 外执行，返回锁内时只有 `connectionSlots.get(robotCode) == slot`、slot 未取消且仍为 `LEASE_WAIT` 才能接纳 token；否则必须先用候选 token compare-and-delete，再完成该 acquire attempt。取消、替换或 shutdown 不得让尚未返回的 acquire 游离在 `generationDrained` 之外。
- acquire、renew 和 release 都使用现有 Redis 客户端的有限命令超时；超时必须小于本地租约安全裕量，且批量续期若无法在某个 slot 的 `leaseValidUntilNanos` 前确认成功，就按续期失败关闭该 slot 的消息入口并停止 SDK。不能用无限 Redis 等待维持逻辑所有权。
- 租约 TTL 和续期间隔可配置，默认 TTL 90 秒、每 30 秒续期；续期只允许 token 匹配的持有者延长 TTL，释放也只能 compare-and-delete 自己的 token。
- 每次 acquire/renew 成功后记录基于 `System.nanoTime()` 的保守本地 `leaseValidUntilNanos`，必须早于 Redis TTL 截止点一个安全裕量。启动发布和消息 admission 只认可未超过本地截止时间的 token；长 GC pause 后即使续期任务尚未来得及回调，也不能继续把过期 token 当作有效租约。
- Registry 只保留一个批量租约续期任务，复用生命周期调度器，不为每个 slot 创建独立续期 future。任务在锁内快照 `(robotCode, ownerToken)`，锁外逐个 renew，再在锁内把结果应用到仍持有相同 token 的当前 slot；因此凭证轮换时旧 generation 完成 `generationDrained` 后把 token 条件转交给新 generation，不会因旧 slot 的续期任务被取消而产生续租空窗。删除、下线和正常关闭在 SDK stop 成功且 `generationDrained` 后释放租约。
- 续期失败时立即在锁内将 `acceptingMessages=false`、取消启动和重试，并在锁外执行 `stopOnce()`；该实例不能再次发布 `RUNNING`。stop 成功后 best-effort compare-and-delete 旧 token，完成旧 generation 后创建新的 `LEASE_WAIT` generation，由后续 reconciliation 重新竞争租约；释放失败时等待原 TTL 过期并告警。不得把已 cancelled 的旧 slot 直接改回可运行态或把未经确认续期的 token 转交给新代。
- stop 抛错时进入 `STOP_FAILED`，继续尽力续租并暴露 DingTalk 专属错误指标/告警，要求完整 JVM 退出以释放旧运行时。本次不默认改变整个 Spring 应用的聚合健康状态，避免影响其他渠道流量；不得主动释放租约或在本实例重建。若 Redis 持续不可用直至 TTL 过期，无法用应用侧租约证明物理连接绝对无重叠，必须告警并依赖 JVM 重启终止旧 SDK，这是无服务端 fencing 能力下的显式边界。

配置提交使用单独的 `dingtalk:stream:config-ownership-mutex` CAS 租约，并由本地可重入事务绑定包装：校验前取得，事务期间按固定间隔续期；事务绑定对象记录 `leaseLost`，`beforeCommit` 必须再次做 token 匹配校验，失败时抛出异常使事务回滚；`afterCompletion` 后 token 匹配释放。取锁或续期失败时事务必须 fail closed，不能降级为仅记录日志。该锁只串行化低频 DingTalk 配置写入，不参与消息路径。

### 5. 用 ConnectionSlot 统一生命周期状态

`DingtalkRobotRegistryService` 不再分别依赖 `openDingTalkClients`、`activeRobotConfigs` 和 `startingRobotCodes` 推断状态，而是维护：

```java
Map<String, ConnectionSlot> connectionSlots;
Map<RobotCredentialKey, Integer> credentialGenerationRefs;
AtomicLong generationSequence;
```

每次需要建立、重建或从最终失败中明确恢复时，从全局单调递增序列取得新的 generation：

```java
final class ConnectionSlot {
    String robotCode;
    Long resourceId;
    long generation;
    DingtalkRobotChannelConfig connectionConfig;
    ConnectionState state;
    String desiredConfigFingerprint;
    String lastHandledForceNonce;
    ClientAttempt currentAttempt;
    LeaseAcquireAttempt currentLeaseAttempt;
    ScheduledFuture<?> retryFuture;
    boolean cancelled;
    CompletableFuture<Void> generationDrained;
    boolean acceptingMessages;
    int inFlightMessages;
    CompletableFuture<Void> messagesDrained;
    String leaseOwnerToken;
    long leaseValidUntilNanos;
}

final class LeaseAcquireAttempt {
    String candidateOwnerToken;
    AtomicBoolean releaseInvoked;
    CompletableFuture<Void> settled;
}

final class ClientAttempt {
    OpenDingTalkClient client;
    int attemptNumber;
    boolean startEntered;
    AtomicBoolean sdkStopInvoked;
    CompletableFuture<Void> attemptSettled;
}

enum ConnectionState {
    LEASE_WAIT,
    STARTING,
    RUNNING,
    RETRY_WAIT,
    STOPPING,
    STOP_FAILED,
    STOPPED
}
```

`ConnectionSlot` 表示一代期望配置，`ClientAttempt` 表示这一代中的一次 SDK 启动尝试。`RUNNING` 只表示 `client.start()` 已返回且 SDK 内部连接调度器正在运行，不表示 WebSocket 已经建立。启动同步失败后必须创建新的 `OpenDingTalkClient`，不能复用内部 executor 已关闭或状态不确定的客户端。

slot 发布为 `RUNNING` 时才设置 `acceptingMessages=true`。注销或凭证轮换先把 slot 标记为 cancelled，阻止新的 client/retry，但在 `client.stop()` 返回前仍允许已经到达旧 client adapter 的回调取得 lease，避免改变原有消息处理语义；stop 返回或抛错后永久关闭该 generation 的消息入口。

`messagesDrained` 在 slot 创建时是未完成 future，且遵守唯一完成条件：**该 generation 的消息入口已经永久关闭，并且 `inFlightMessages==0`**。统一的 `closeMessageAdmissionPermanently(slot)` 在 slot 锁内设置 `acceptingMessages=false`；若计数为零立即完成 future，否则由最后一个 message lease 的幂等 `close()` 完成。取消发生在 `start()` 前、最终进入 `STOPPED`、进入 `STOP_FAILED`、正常 stop 完成和应用 shutdown 都必须调用该 helper；仍准备在同一 generation 内重试的同步启动失败不得提前完成它。该 future 只描述已经接受的业务消息，不参与判断 SDK client 是否停止。

### 6. SDK 启动语义与重试责任边界

失败分成两类：

- **同步启动失败**：client factory/build 抛错、启动执行器拒绝任务、`client.start()` 同步抛错，或发布 `RUNNING` 前的 Registry 自身异常。由 Registry 负责清理并按 1 秒、2 秒、4 秒最多重试三次。
- **异步建连失败**：鉴权、获取 endpoint、WebSocket 建连或断线重连失败。由 Stream SDK 内部连接调度器负责持续重试；Registry 不创建新 client，也不进入 `STOPPED`。

Registry 不记录“连接成功”日志，只记录“SDK 运行时启动成功”。真实连接建立与失败暂以 SDK 日志和端到端消息探针观察。若需要把真实连接状态纳入状态机，必须先通过官方接口或最小 fork 暴露连接事件，再单独设计 `CONNECTED/DISCONNECTED` 状态，不能通过轮询私有字段或解释 `start()` 返回值实现。

### 7. 当前身份校验与完成屏障

所有 SDK 启动异步任务都捕获 `ConnectionSlot` 和 `ClientAttempt`，并通过以下逻辑验证身份：

```java
private boolean isCurrentAttempt(ConnectionSlot slot, ClientAttempt attempt) {
    return !shutdown
            && connectionSlots.get(slot.robotCode) == slot
            && !slot.cancelled
            && connectionLockService.isOwner(slot.robotCode, slot.leaseOwnerToken)
            && slot.currentAttempt == attempt;
}
```

校验至少发生在：

1. client factory/build 前后。
2. 向启动执行器提交任务前。
3. 启动任务真正调用 `client.start()` 之前。
4. `client.start()` 返回之后、发布 `RUNNING` 之前。
5. 同步启动失败准备安排重试之前。
6. 延迟重试到期、创建新客户端之前。

三个完成屏障的职责不能混用：

- `attemptSettled`：本 attempt 已确定不会再调用 `start()`，且需要的 `stopOnce()` 已执行完成后完成。
- `LeaseAcquireAttempt.settled`：本次 Redis acquire 已返回；若结果已过期或 slot 已取消，候选 token 的条件释放也已经执行完毕。
- `generationDrained`：slot 已取消或最终停止，所有 SDK attempt 与 lease acquire attempt 均 settled，且不存在可能创建新 attempt 的 retry future 后完成。

一次同步启动失败只完成本次 `attemptSettled`，不能提前完成 `generationDrained`。新 generation 必须等待旧 slot 的 `generationDrained`，而不是等待某一次 attempt 的 future。旧任务的 `catch` 和 `finally` 只能条件清理自己持有的 attempt，不能按 `robotCode` 无条件删除当前 slot、client、配置快照或 token。

`isOwner(...)` 必须是本地 owner token、最近一次成功 acquire/renew 结果与 `leaseValidUntilNanos` 的无副作用校验，不能在持有 `refreshLock` 时访问 Redis；实际 Redis acquire/renew 在锁外执行，结果再回到锁内做 slot 或相同 owner token 的身份校验后发布。acquire 的所有成功结果必须二选一：被当前 slot 接纳，或在其 `settled` 完成前按候选 token 释放，不允许只靠 TTL 回收陈旧申请。

`STOP_FAILED` 是安全隔离态：Registry 已调用过 `stop()`，但 SDK 抛错，无法证明旧运行时已经释放。该状态不完成 `generationDrained`，旧 slot 继续作为该 `robotCode` 在 `connectionSlots` 中的隔离占位，也不允许自动启动新 generation；批量租约续期任务继续尽力保持当前 owner token。为避免增加难以验证的在线恢复接口，本次只允许完整 JVM 退出后由其他实例或下一进程重新初始化；普通刷新、`forceRegister` 和 Spring context 内部重载均不能解除隔离。

### 8. 停止正在启动或运行的客户端

停止操作接收内部 `StopReason`（`CREDENTIAL_ROTATION`、`OFFLINE`、`DELETE`、`LEASE_LOST`、`SHUTDOWN`），并分成“注销状态”和“调用外部 SDK”两部分：

1. 启动任务在 `refreshLock` 内完成最后一次身份校验并设置 `startEntered=true`，随后才在锁外调用 SDK `start()`。
2. 停止操作在 `refreshLock` 内将 slot 标记为 cancelled，并取消 `retryFuture`；若有尚未返回的 `currentLeaseAttempt`，不阻塞锁等待，而由其返回路径负责条件释放并 settle。`LEASE_LOST` 和 `SHUTDOWN` 必须在同一临界区立即调用 `closeMessageAdmissionPermanently()`；凭证轮换、下线和删除仍可保持原兼容语义，在 SDK `stop()` 返回前允许已经进入旧 adapter 的回调取得 lease。旧 slot 在 drained 前继续占据 `connectionSlots`，避免停止失败时丢失隔离状态。
3. 如果 attempt 尚未进入 `start()`，启动任务会在身份校验处退出；已创建 client 仍执行 `stopOnce()`，避免 factory 已分配资源但尚未调用 `start()` 的实现差异造成泄漏。
4. 如果 attempt 已进入 `start()` 但尚未返回，停止方不与 SDK 的同步 `start()`/`stop()` 锁竞争；启动任务返回后发现 slot 已过期，再在锁外执行 `stopOnce()`。
5. 如果 attempt 已是 `RUNNING`，停止方在锁外通过 `sdkStopInvoked.compareAndSet(false, true)` 调用一次 `client.stop()`，避免 SDK 阻塞全局刷新锁。
6. stop 正常返回后永久关闭该 generation 的消息入口并完成 attempt 的本地清理；stop 抛错时也永久关闭消息入口并进入 `STOP_FAILED`，保留未完成的 `generationDrained`、继续尽力续租并阻止替代客户端启动，不能在资源释放未知时假装旧 generation 已排空或释放连接租约。
7. 旧 `generationDrained` 完成后，Registry 在锁内重新读取最新配置快照，再以 compare-and-replace 将旧 slot 替换为新 generation 并启动新 client；凭证轮换条件转交现有 owner token，删除、下线和正常关闭则 token 匹配释放租约。不提前创建等待中的新 slot，也不使用凭证变化事件当时捕获的陈旧目标配置。

access token 缓存必须按凭证版本隔离，Redis key 调整为 `robotCode + credentialVersion + senderStaffId`。旧 generation 和已接受的旧消息只能读写自己的 namespace，不能污染不同凭证的新 generation。Registry 用一个仅限 JVM 内的 `credentialGenerationRefs[(robotCode, credentialVersion)]` 记录消息入口尚未永久关闭或消息尚未排空的 generation 数：所有增减都在 `refreshLock` 内执行，slot 创建时加一，`messagesDrained` 完成时幂等减一，减到零才 best-effort 精确清除该前缀。客户端停止后不再按 `robotCode` 全量删除；A→B→A→B 等快速轮换中，只要任一当前或旧 generation 仍可能使用 A，就不能由另一个旧 A 删除共享 namespace。清理失败只记录脱敏日志并依赖原 TTL，不改变生命周期状态；应用崩溃后的残留同样由 TTL 回收。

### 9. 可取消重试与 STOPPED 恢复

同步启动失败后最多重试三次，延迟为 1 秒、2 秒和 4 秒。第一次立即调用计为 attempt 1，三次重试分别为 attempt 2、3、4，因此一个 generation 最多创建四个 client。attempt 4 同步失败后进入 `STOPPED`，不再自动调度。

重试与批量租约续期复用 Registry 自己拥有的单线程生命周期 `ScheduledExecutorService`；SDK 的阻塞 `start()` 仍使用独立启动执行器。每个 slot 同时最多存在一个 `retryFuture`。刷新凭证、删除机器人、资源注销和应用关闭都必须：

- 标记旧 slot 为 cancelled；
- 取消未执行的 retry future；
- 使已到期但尚未执行主体的任务在身份校验处退出；
- 禁止取消后的任务创建或发布新客户端；
- 在当前 SDK attempt、lease acquire attempt 均 settled 且 retry future 不再可能运行后完成 `generationDrained`。

client factory/build、启动执行器 `submit()` 和调度器 `schedule()` 抛出的拒绝或构造异常都进入同一套条件清理路径。关闭期间的拒绝只记录 shutdown 原因，不产生恢复尝试；非关闭期间按同步启动失败计数。

reconciliation 不只比较配置字段，还比较 slot 状态：

- 相同凭证且状态为 `LEASE_WAIT`、`STARTING`、`RUNNING` 或 `RETRY_WAIT`：保持当前 generation；`LEASE_WAIT` 只在持有者释放或租约过期后再次竞争，不消耗 SDK 启动重试预算。
- 相同凭证但状态为 `STOPPED`：完整配置指纹变化、明确的资源刷新或人工 `forceRegister` 创建新 generation，attemptNumber 从 1 重新开始；远端提交与 force 按第 2 节语义传递到实际租约持有实例。
- 状态为 `STOP_FAILED`：保持隔离并拒绝自动或人工 `forceRegister`；只有完整 JVM 退出后，下一进程的全量初始化才能重新建立运行时。
- 凭证变化：取消旧 generation，等待其 drained 后启动新 generation。

### 10. 在途消息与配置删除

SDK consumer executor 和 `DingtalkBotListener.messageExecutor` 是两个不同的异步边界。修复晚到帧的 `RejectedExecutionException` 不会自动处理已经提交到业务线程池的消息。

本次采用“一旦 ACK 就处理到底”的规则，并通过每个 client 独立的轻量 listener adapter 避免让共享业务 Listener 反向依赖 Registry：

1. Registry 为每个 `ConnectionSlot` 创建 `GenerationBoundCallbackListener`，该 adapter 持有 slot 引用和该 generation 的凭证配置副本，再委托现有 `DingtalkBotListener` 处理业务逻辑。adapter 使用 slot 的 `robotCode` 作为权威值，并校验 payload 中的 robotCode 一致，不能根据不可信 payload 切换到其他 slot。
2. adapter 收到回调后调用 slot 的 `tryAcquireMessageLease()`。该方法与 `acceptingMessages` 状态切换使用同一个 slot 锁：只有 `acceptingMessages=true`、Registry 未 shutdown 且本地租约仍有效时，才递增 `inFlightMessages` 并返回 lease；否则在写去重键和返回 ACK 前抛出接收不可用异常，由 SDK 走 `Context.exception()`，不把消息标记为已消费。
3. adapter 使用 slot 中固定的认证配置；若当前配置快照的 `resourceId` 和 `credentialVersion` 与 slot 一致，可合并最新 `resourceName/appId/cardTemplateId/channel` 元数据，否则完整使用 slot 的旧配置副本。这样不会出现新凭证与旧 generation 混用。
4. 形成的 `DingtalkMessageContext` 包含 `robotCode`、`resourceId`、generation、credentialVersion、配置防御性副本和 message lease。token、文件下载和卡片内部接口只增加接收该 context/config 的重载，保留现有公开方法，避免影响非 Stream 调用方。
5. 去重从单纯布尔值改为带 reservationId 的预留。只有取得 message lease 后才预留；成功提交到 `messageExecutor` 后才返回 ACK。提交失败时使用 compare-and-delete 释放本次预留并抛出异常，使钉钉可以重投且不会误删其他任务的新预留。
6. `messageExecutor` 使用显式抛错的拒绝策略，不能在 shutdown 时静默丢弃，也不使用可能让 SDK consumer 线程执行长任务的 `CallerRunsPolicy`。
7. message lease 的 `close()` 必须幂等。重复消息、参数错误和不支持类型等同步结束路径在 Listener 返回前关闭；异步路径把 lease 所有权转交给已成功入队的任务，并在任务 `finally` 关闭，提交失败则由提交方关闭。
8. 一旦成功入队并返回 ACK，任务不再因后续 generation 变化退出；它始终使用捕获的 context 完成处理。最后一个 lease 关闭后完成 slot 的 `messagesDrained`。
9. 凭证轮换或资源注销允许已经 ACK 的旧消息尽力完成，因此注销完成后可能仍返回一条在注销前已经接受的回复；这不触发旧 generation 复活，且旧 token 只能写入旧 credentialVersion namespace。
10. 应用关闭在调用任何 SDK `stop()` 和关闭执行器之前，先在锁内设置 shutdown 并永久关闭所有 slot 的消息入口；随后按全局关闭窗口等待 `messagesDrained`。超时中断时必须记录已 ACK 但未完成的消息数量。进程崩溃仍沿用现有非持久化消息处理语义，本次不引入消息 inbox 或改变机器人回调协议。

### 11. 应用关闭

`shutdownAll()` 设置 Registry 级 shutdown 标记，之后所有注册、启动、明确恢复和重试入口均拒绝新工作。关闭顺序为：

1. 先停止远端事件订阅和周期 reconciliation 入队，再在锁内设置 Registry shutdown，永久关闭所有 slot 的消息入口，标记 slot cancelled、取消 retry future，并取得当前 SDK attempt 与 lease acquire attempt 快照；从这一临界区返回后 `tryAcquireMessageLease()` 和新的 lease acquire 必须全部失败。批量连接租约续期在对应 SDK 确认停止前不能先取消。
2. 在锁外并发执行各 attempt 的 `stopOnce()`，避免单个 SDK stop 串行放大总关闭时间。
3. 关闭启动执行器，使未开始任务进入条件清理路径；生命周期调度器暂不关闭，使同一个批量续期任务可维持仍未确认停止的 SDK 租约，但 shutdown 标记保证重试和新 acquire 不再执行。
4. 等待尚未返回的 lease acquire attempt settle；其陈旧成功结果先条件释放。stop 成功且 generation drained 后 token 匹配释放连接租约；`STOP_FAILED` 不主动释放，批量续期任务继续尽力持有到全局截止时间或 JVM 退出。
5. 等待旧 generation 的 `generationDrained` 与 `messagesDrained` 两个栅栏完成。
6. 使用一个可配置的全局关闭截止时间，而不是对每个 client 分别等待完整超时；到期后关闭生命周期调度器、调用各执行器 `shutdownNow()` 并记录未结束的 generation、SDK attempt、lease acquire attempt、租约和消息任务数量。Spring 关闭流程随后必须退出 JVM；不得在同一 JVM 中重新加载 context 并继续服务。

关闭截止时间只限制应用退出等待，不会把 `STOP_FAILED` 改写为 drained；进程正在退出时不再启动替代客户端，因此不会破坏唯一性约束。

Registry 必须在 Listener 的消息执行器之前停止 Stream 接收。通过 Spring bean 依赖关系或显式 `SmartLifecycle` phase 固化销毁顺序，不能依赖未声明的 `@PreDestroy` 调用顺序。

## 生命周期流程

### 元数据刷新

1. 事务提交前解析目标配置并验证 `robotCode` 唯一性。
2. 事务提交后构造并原子发布新配置快照。
3. 对比当前 connectionConfig 与目标连接配置。
4. `clientId/clientSecret` 未变化且 slot 未处于 `STOPPED` 时，仅保留新元数据快照。
5. 原 slot 和 client 保持不变，不清除访问令牌。

### 凭证变化

1. 事务提交后，在锁内发布新期望配置，注销旧 slot 并取消其重试；旧 slot 在 drained 前保持为该 `robotCode` 的占位和连接租约持有者。
2. 在锁外停止旧 attempt；旧 token namespace 在该 slot 的 `messagesDrained` 后递减凭据 generation 引用，只有引用归零才按 `credentialVersion` 清除。
3. 等待旧 `generationDrained` 完成后重新读取最新配置快照，以条件替换创建新 generation，并把仍匹配的 owner token 条件转交给它后启动新 client；如果机器人期间已删除或下线，则只移除旧 slot并释放租约，不创建新 generation。
4. 新 attempt 通过身份校验且 `start()` 返回后发布为 `RUNNING`。

### 机器人删除或资源注销

1. 事务提交后注销该资源拥有的 slot 并取消重试。
2. 原子发布不包含该资源的配置快照。
3. 在锁外停止当前 attempt，并在旧消息处理完成后递减凭据 generation 引用，只有归零才按 `credentialVersion` 清除 access token。
4. 已经 ACK 的旧消息使用捕获 context 尽力完成；尚未取得 message lease 的晚到回调不写去重键、不返回成功 ACK。
5. 重复注销不再次调用底层 `stop()`。

资源仅从在线变为下线时执行相同的运行时停止和 token 清理，并从公开 `byRobotCode/byResourceId` 视图移除，但内部 `ownedConfigsByResourceId/ownersByRobotCode` 保持不变；只有软删除或合法提交的 DingTalk 配置移除才执行第 2 步并释放所有权。

### 同步启动失败

1. 条件清理失败 attempt 并执行 `stopOnce()`。
2. 若该 generation 仍准备重试，不关闭消息栅栏；只有达到最终 `STOPPED`、被取消或 stop 失败时才永久关闭消息入口，并在 `messagesDrained` 后幂等递减对应凭据 generation 引用，引用归零才清除 token namespace。
3. 完成该 attempt 的 `attemptSettled`。
4. 当前 generation 仍有效且未达到上限时进入 `RETRY_WAIT`。
5. 重试到期后重新校验身份，创建新 client 和新 attempt。
6. 达到上限后永久关闭消息入口，记录当前完整配置指纹并进入 `STOPPED`；保留连接租约到该 generation 被配置变化、明确恢复、删除、下线或应用关闭处理，防止其他实例绕过本实例的失败预算。下一次有效明确刷新或人工 `forceRegister` 使用同一 owner token 创建新 generation。

### SDK 异步建连失败

1. Registry 保持 `RUNNING`，不创建额外 client。
2. SDK 内部调度器继续建连或断线重连。
3. 通过 SDK 错误日志、端到端消息探针和连续不可用告警观察。
4. SDK 已进入 `RUNNING` 后，现有 `forceRegister` 仍按幂等注册语义跳过该 active slot，不新增“强制重启正常客户端”的行为；若 SDK 自身重连机制失效，按告警 runbook 重启所在 Pod。未来若需要在线强制重连，应设计独立、可审计的管理接口，不能暗改现有 force 语义。

### 周期性全量 reconciliation

1. 启动时立即执行，之后默认每 60 秒执行一次。
2. 查询全部未软删除数字员工构造 `ownersByRobotCode`，再查询当前应在线的 DingTalk 数字员工构造 `onlineResourceIds`；先原子发布通过校验的所有权快照，再 reconciliation 运行态。
3. 对 Registry 中存在但不再在线的资源只停止 slot、释放连接租约、移出公开运行态配置视图并保留内部配置所有权；对已软删除或合法移除 DingTalk 配置的资源才同时删除内部快照所有权。
4. 单个资源在读取或 reconciliation 编排阶段失败时，只记录脱敏错误并继续其他资源，下一周期继续；client 同步启动失败仍遵守四次总尝试和 `STOPPED` 规则。
5. 与事务后刷新共用 `refreshLock`，每轮结束后再计算下一次 fixed delay，避免扫描重叠。
6. 周期扫描会让 `LEASE_WAIT` 再次竞争租约；它不恢复配置指纹未变化的 `STOPPED`，也绝不绕过 `STOP_FAILED`。如果数据库完整配置指纹已经变化，则周期扫描按新的期望配置创建 generation，保证远端事件丢失仍能闭环。

### 应用关闭

1. 停止事件和周期刷新入口，再在同一临界区设置 Registry 级 shutdown 标记并永久关闭所有 slot 的消息入口，拒绝新的 lease acquire、注册、启动、重试和消息任务。
2. 注销所有 slot 并取消 retry future；等待在途 lease acquire 返回后接纳或条件释放，批量租约续期任务在对应 SDK 确认停止前继续运行。
3. 在锁外停止所有当前 attempt。
4. 成功停止且 generation drained 的 slot 释放连接租约；先关闭启动执行器，生命周期调度器最后关闭。
5. 停止接收新消息并等待已开始消息。
6. 在全局截止时间到达时中断剩余任务，记录未结束任务数量和身份信息。

## SDK 升级与回滚边界

### Stream SDK

候选目标版本为 `com.dingtalk.open:app-stream-client:1.3.14-beta.1`。已核对该官方 tag 的 `AppServiceListener` 源码和对应单测包含 `RejectedExecutionException` 处理，但发布验证仍必须对最终 Maven artifact 直接证明 `receive()` 在 consumer executor 已关闭时不会向调用线程抛出该异常，不能只验证依赖版本号或源码 tag。

同时验证以下真实语义：

- `start()` 返回只代表 SDK 运行时启动，不代表物理连接建立。
- 异步建连失败由 SDK 捕获并继续调度，不误触发 Registry 的同步启动重试。
- stop 后晚到 EVENT 能返回 SDK 约定的 later/capacity 响应，晚到 CALLBACK 只记录容量告警，不向调用线程抛异常。

若 beta 版本出现建连、回调或网络兼容问题，则回退到 `1.0.5` 并使用基于官方修复的最小内部 fork。仅回退到未修补的 `1.0.5` 时，不满足“彻底修复”的验收标准。

### OpenAPI SDK

本次保持现有 `com.aliyun:dingtalk:2.2.17` 不变。它不负责 Stream consumer executor，升级不能帮助本次生命周期闭环，反而会扩大 OAuth、通讯录和互动卡片回归面。若后续确需升级到 `2.2.62`，必须作为独立需求、独立提交和独立回归处理，不与 Registry/Stream SDK 修复绑定。

## 可观测性

注册、SDK 运行时启动、停止、重建、同步启动重试安排、重试取消和最终失败日志至少包含：

- `robotCode`
- `resourceId`
- `generation`
- `attemptNumber`
- client identity
- 当前状态和触发原因

禁止记录 `clientSecret`、完整 access token、完整 session webhook 和原始消息正文。

灰度期间观察：

- 未处理 `RejectedExecutionException` 数量；
- 按原因分类的 stop 次数；
- 同步启动失败、重试及最终失败次数；
- SDK 异步建连失败和连接建立日志；
- 重复 `robotCode` 冲突次数；
- 连接租约 acquire/renew/release 结果、`LEASE_WAIT` 时长和租约丢失次数；
- 配置写互斥器等待、续期失败和提交前 owner token 校验失败次数；
- 本实例每个 `robotCode` 的已发布 `RUNNING` slot 数；
- 事务后刷新失败次数、周期性 reconciliation 扫描结果和收敛延迟；
- 远端数字员工事件接收、合并、刷新失败和从提交到租约持有实例收敛的延迟；
- message lease 获取拒绝、执行器提交拒绝及已 ACK 未完成消息数；
- 消息到首个回复的延迟；
- `appStreamResponse` idle timeout 次数。
- `STOP_FAILED` 所在实例、持续时间和人工重启处置状态。

“每个 robotCode 的 `RUNNING` slot 数为 1”只证明 Registry 发布唯一，不等同于 SDK 内部已有物理连接。真实可用性以端到端探针为准。

## 测试设计

### 单元测试

- 元数据变化不停止客户端，配置消费者原子读到新元数据。
- 配置快照更新期间，消费者只能读到完整旧快照或完整新快照，不出现临时缺失。
- clientId 或 clientSecret 变化时旧客户端最多停止一次，新客户端只在旧 `generationDrained` 后启动。
- 删除机器人和重复注销不会重复停止客户端。
- attempt 1 同步失败后 attempt 2 被阻塞，此时修改凭证；新 generation 必须等待 attempt 2 settled 和旧 generation drained。
- 旧 attempt 的异常和 finally 不删除新 generation 的 slot、配置或 token。
- client factory、启动执行器提交和 `client.start()` 同步失败均使用新 client 重试，并按 1 秒、2 秒、4 秒完成最多三次重试、四次总尝试。
- 启动执行器和调度器在 shutdown 期间拒绝任务时，不遗留未完成 future，也不产生新重试。
- 重试等待期间注销资源，延迟到期后不创建新 client。
- 重试等待期间修改凭证，旧 generation 不得用旧凭证复活。
- attempt 4 同步失败进入 `STOPPED`；相同凭证的明确刷新创建新 generation 并从 attempt 1 恢复。
- `STOPPED` 后数据库完整配置指纹变化时，即使远端事件丢失，周期扫描也创建新 generation；指纹未变化的周期扫描不重置预算。
- 配置提交落在非租约持有实例时，`REMOTE_AFTER_COMMIT` 能让持有实例恢复同配置指纹的 `STOPPED`；重复普通事件只按当前数据库状态幂等 reconciliation。
- `forceRegister` 落在非租约持有实例时先写 force nonce 再发布 `REMOTE_FORCE`；持有实例对同一 nonce 只执行一次。marker 写失败向调用方返回失败；事件丢失时周期扫描仍恢复，事件发布失败不误判 marker 失败。
- `RUNNING/STARTING/RETRY_WAIT` 收到本机或远端 force 时保持现有幂等注册语义，不停止或替换正常 client。
- runtime-only force 事件不触发 publisher 既有的权限刷新副作用；原有 create/update/delete 发布路径行为不变。
- `stop()` 抛错时进入 `STOP_FAILED`，不完成 `generationDrained`，普通刷新和 `forceRegister` 均不能启动替代客户端。
- `shutdownAll()` 先停止事件/周期入口，取消重试和新 acquire，停止客户端，按顺序关闭启动执行器与生命周期调度器，并遵守全局关闭截止时间。
- 两个资源使用相同 `robotCode` 时，提交前拒绝后者，前者连接保持运行。
- 同一资源内重复 `robotCode` 时整次配置事务失败且不改变已有持久态、快照或连接。
- 两个并发事务提交相同 `robotCode` 时，事务级互斥保证至多一个事务通过校验并提交。
- 两个不同应用实例并发提交相同 `robotCode` 时，跨实例配置写互斥器保证至多一个事务提交；租约续期丢失时 `beforeCommit` 使事务回滚。
- 纯下线/删除路径不申请配置所有权互斥器；持久状态成功后即使即时 stop 失败，也不返回“业务已回滚”的假象，并由下一周期收敛。
- 冷启动存在历史跨资源重复时，不按查询顺序选择所有者，冲突 robotCode 均不启动。
- 离线但未软删除的资源保留 `ownersByRobotCode` 且不持有运行时连接租约；重新上线可恢复，软删除后才释放所有权。
- 数据库事务回滚时不改变配置快照和连接；提交后才触发 reconciliation。
- 同一事务多次刷新同一资源时只注册一次 after-commit reconciliation，并读取数据库最新状态。
- after-commit 执行失败后，周期性 reconciliation 在下一扫描周期修复运行态；扫描不重叠且单资源失败不阻断其他资源。
- 本机提交事件由另一 Registry 实例接收后重新读库并停止/刷新其持有的 slot；重复、乱序或丢失事件分别通过幂等刷新、最新数据库状态和下一周期扫描处理。
- 周期性 reconciliation 可补建缺失 slot，只在完整配置指纹变化时恢复 `STOPPED`，且不会绕过 `STOP_FAILED`。
- 周期扫描遇到已提交但不可解析的 DingTalk 配置时保留最后一次已接受快照和 slot；合法空配置才按移除处理。
- 严格提交解析区分无 DingTalk 节点、非法 JSON、缺少凭证和同资源重复；后三者阻止事务提交且不改变旧运行态。
- 宽松兼容入口仍返回原 List 语义，而 reconciliation 使用 `RobotConfigParseResult` 区分合法空配置和解析失败，不能把后者当删除。
- 配置快照发布后修改原始 DTO 或读取结果，不会改变已发布快照。
- 凭证刷新与回调接收并发时，adapter 捕获的 generation、resourceId、credentialVersion 和配置始终属于同一 slot。
- 消息已成功入队并 ACK 后注销资源，任务仍使用捕获 context 完成，不因全局缓存删除抛出 config not found。
- stop 完成、`acceptingMessages=false` 后收到晚到回调时，不创建去重预留且不返回成功 ACK；stop 完成前已进入 adapter 的回调仍可取得旧 lease。
- shutdown 标记设置后、SDK `stop()` 返回前到达的回调不能取得 message lease、写去重预留或成功 ACK。
- 去重预留成功但执行器提交失败时 compare-and-delete 当前 reservation，后续重投可以重新处理。
- clientSecret 变化但 clientId 不变时，新旧 generation 使用不同 token namespace；旧消息晚写 token 不影响新消息。
- 最后一个旧消息 lease 释放后完成 `messagesDrained` 并幂等递减凭据 generation 引用；A→B→A→B 快速轮换时，只有同一 namespace 的全部 generation 均排空后才清理。
- client factory 失败、启动任务拒绝、取消发生在 start 前以及最终 `STOPPED` 等从未进入 `RUNNING` 的路径，都能在消息入口永久关闭时完成 `messagesDrained`。
- `STOP_FAILED` 在普通刷新、`forceRegister` 和 Spring context 重载下保持隔离，只能通过完整 JVM 退出清除。
- `credentialVersion` 使用长度前缀 UTF-8 编码，`("ab", "c")` 与 `("a", "bc")` 不同，Unicode 输入跨 JVM 重启保持稳定。
- 两个 Registry 实例共享 fake Redis 租约时，同一 `robotCode` 只有租约持有者创建 client；未持有者保持 `LEASE_WAIT` 且不消耗启动预算。
- lease acquire 被阻塞期间发生删除、凭证变化或 shutdown，旧 acquire 返回成功后必须先条件释放候选 token再 settle；旧 `generationDrained` 在此之前不完成，且陈旧任务不能发布 client。
- 批量 renew 结果与凭证 generation 转交并发时，只按相同 owner token 应用到当前 slot，不因旧 slot 被替换产生续租空窗或覆盖新 token。
- Redis acquire/renew/release 超时或批量续期超过本地安全截止点时均走失败路径，不会无限阻塞排空或继续接收消息。
- 连接租约续期失败会先关闭消息入口再停止旧 client；stop 成功后条件释放旧 token，释放失败则最多等待原 TTL 后由其他实例接管；stop 失败则进入 `STOP_FAILED` 且不主动释放租约。
- 本地 `leaseValidUntilNanos` 到期后，即使续期回调尚未执行，也不能发布 runtime 或取得 message lease。

测试使用可控 executor、fake scheduler、可阻塞的 fake `OpenDingTalkClient` 和事务同步测试夹具，不依赖真实时间等待。

### SDK 行为验证

- 使用 rejecting executor 构造 `AppServiceListener`，分别验证 EVENT 和 CALLBACK 都不会向调用线程抛出 `RejectedExecutionException`。
- 验证 EVENT 被拒绝时返回 SDK 约定的 later/capacity 响应。
- 验证 `GenerationBoundCallbackListener` 在 stop 完成后拒绝回调时，异常会经 SDK `Context.exception()` 返回失败而不是成功 ACK；stop 完成前已经进入 adapter 的回调仍可取得旧 slot lease 并按原逻辑处理。
- 验证 `start()` 返回早于真实连接建立，Registry 只发布 `RUNNING` 而不记录物理连接成功。
- 模拟 endpoint 获取或 WebSocket 建连失败，验证 SDK 内部继续重试且 Registry 不创建第二个 client。
- 验证升级后的 SDK 可以正常 start/stop，并保持机器人消息 topic 注册兼容。

### 回归和集成验证

- 提交配置事务 → after commit 启动 SDK 运行时 → 收到消息。
- 回滚配置事务 → 不启动、不停止、不替换配置快照。
- 模拟事务后刷新丢失 → 周期性 reconciliation 最多一个扫描周期内恢复。
- 两个后端实例同时启动 → 同一 `robotCode` 只有一个实例发布 `RUNNING`；持有实例正常退出并释放租约后另一实例接管。
- 配置更新请求落在非租约持有实例 → Redis 变更事件通知持有实例重新读库并停止/轮换旧 runtime；事件丢失时周期扫描兜底。
- `STOPPED` 持有租约时，更新或人工 force 请求落在另一实例 → 持有实例收到对应远端触发后恢复；force 事件丢失时在两个扫描周期内由 nonce marker 恢复，普通事件重复/乱序和相同 nonce 不重复重置新 generation。
- 在线资源下线 → 停止运行时但保留所有权 → 冲突资源提交仍被拒绝 → 原资源重新上线后恢复运行时。
- 启动运行时 → 收到消息 → 刷新元数据 → 再次收到消息。
- 启动运行时 → 修改凭证 → 停止旧运行时 → 启动新运行时。
- 启动运行时 → 接受并 ACK 消息 → 注销资源 → 已接受消息完成、晚到新回调不被错误确认。
- 同步启动失败 → 等待 Registry 重试 → 新客户端成功启动运行时。
- SDK 异步建连失败 → SDK 自行重试 → Registry 不重复创建 client。
- 同步启动失败 → 等待 Registry 重试 → 注销资源 → 不再启动。
- `STOPPED` → 相同凭证明确刷新 → 新 generation 启动。
- acquire 请求在 Redis 返回前 shutdown → 返回成功的候选 token 被条件释放 → 另一实例可接管。
- 应用关闭 → 停止全部运行时和 Listener → 无后续重试或新消息任务。
- 应用关闭与回调并发 → shutdown 临界区之后所有新回调失败确认，临界区之前已 ACK 的任务在全局截止时间内完成。
- OAuth 登录、通讯录查询、卡片创建、卡片流式更新在现有 `com.aliyun:dingtalk:2.2.17` 下保持正常。
- 原有配置查询、主动消息、token 获取、文件下载、权限校验和卡片服务公开方法的输入输出与改造前一致。

## 验收标准

1. 仅修改运行时元数据时，`OpenDingTalkClient.stop()` 调用次数为零，配置消费者不会观察到半更新状态。
2. 凭证变化时旧 attempt 的底层 `stop()` 最多调用一次，新 generation 只在旧 `generationDrained` 后继承有效 owner token，并成为唯一已发布 `RUNNING` slot。
3. 注销、配置删除或应用关闭后，旧 generation 的启动、重试和清理任务不能创建、发布、删除或复活新 generation 状态。
4. 同步启动失败最多重试三次、总尝试四次，每次使用新的 client；异步建连失败由 SDK 内部重试且 Registry 不重复创建 client。
5. `STOPPED` slot 可由相同凭证的明确刷新或人工 `forceRegister` 创建新 generation 恢复。
6. `STOP_FAILED` slot 不完成 `generationDrained`，且不能被普通刷新、`forceRegister` 或 Spring context 重载绕过，只能通过完整 JVM 退出清除。
7. 跨资源或同资源重复 `robotCode` 在事务提交前被拒绝，不覆盖持久配置、配置快照或连接；同实例或跨实例并发事务经配置写互斥器后至多一个提交，冷启动历史冲突不产生随机所有者。
8. 数据库事务回滚不改变配置快照和连接；除已进入 `STOPPED/STOP_FAILED` 的明确隔离外，事务后刷新失败或丢失时，周期性 reconciliation 最多一个扫描周期内与数据库最新状态重新收敛。离线资源停止运行时但保留所有权，只有软删除或合法配置移除才释放。
9. 连接关闭期间收到晚到帧时，不出现未处理的 `RejectedExecutionException`。
10. 回调只有在取得 message lease、完成去重预留并成功入队后才返回成功 ACK；一旦 ACK 就不因 generation 变化丢弃。
11. 注销或凭证轮换期间，已 ACK 消息使用同一 generation 的配置快照和 token namespace 完成，旧消息不能污染新 token、读取新凭证或复活旧 generation。
12. 应用关闭在调用 SDK stop 前原子关闭消息入口并遵守全局截止时间；shutdown 临界区后无新 lease、注册、重试或消息任务产生，并记录已 ACK 但未完成的任务。
13. 现有公开服务方法、机器人配置 JSON、权限、会话、文件、卡片和主动消息路径行为保持兼容。
14. 仅 Stream SDK 变更通过行为与回归测试并可独立回退；OpenAPI SDK 保持现有 `2.2.17`，不进入本次变更。
15. 后端 Maven 完整验证通过，日志中不新增敏感信息。
16. 在仓库默认两个后端副本下，同一 `robotCode` 同时只有一个有效连接租约持有者可以创建或发布 SDK runtime；正常释放或租约到期后其他实例最多一个扫描周期内接管。配置提交到非持有实例时，现有 Redis 变更事件触发持有实例重新读库，事件丢失仍由周期扫描收敛。
17. 所有从未进入 `RUNNING` 的终止路径都会完成 `messagesDrained`；严格提交解析不会把非法配置误判为合法删除。
18. `credentialVersion` 使用明确的长度前缀编码，认证字段组合不存在拼接歧义。
19. 在途 lease acquire 属于 generation 排空条件；陈旧 acquire 成功只能条件释放，不能发布 runtime。Redis 可用时应立即释放；释放失败时以原 TTL 为有界兜底并告警，不能假装已经释放。
20. A→B→A→B 等凭证快速轮换不会由任一旧 generation 清理掉仍被其他当前或旧 generation 使用的 token namespace。
21. 灰度前完成 `robotCode` 历史冲突和“同一 clientId 对应多个 robotCode”只读扫描；前者必须清零，后者若非空则阻断灰度并单独确认映射，不由本次修复静默改写。
22. 跨实例 `forceRegister` 在 Pub/Sub 丢失时仍可由带 TTL 的 nonce marker 恢复 `STOPPED`，相同 nonce 只消费一次；对正常 active slot 不改变既有幂等行为。

## 风险与取舍

- `app-stream-client:1.3.14-beta.1` 是预发布版本，必须通过测试环境和灰度验证；失败时使用最小 fork，而不是接受未处理异常。
- Registry 无法通过 SDK 公共接口获知真实连接状态，因此 `RUNNING` 只表示 SDK 运行时已启动。需要精确健康度时必须增加 SDK 连接事件接口，不能扩大 `RUNNING` 的含义。
- 等待旧 generation drained 会延后凭证切换，但可以避免新旧运行时同时发布。stop 异常会让该 `robotCode` 进入 `STOP_FAILED` 隔离态并牺牲可用性，直到完整 JVM 退出；这是对单运行时安全约束的显式取舍。
- 在途消息捕获配置快照会延长旧凭证对象的内存生命周期，但只持续到该消息结束；不得把快照写入日志或长期缓存。
- 拒绝重复 `robotCode` 比后写覆盖更严格，可能暴露已有脏配置；上线前应扫描现有配置并处理冲突。
- 当前连接拓扑按 `robotCode` 建租约，而 SDK 认证按 `clientId/clientSecret` 建 client。上线前必须只读扫描“同一 clientId 对应多个 robotCode”的历史数据；若存在，不在本次最小修复中猜测合并或自动拒绝，先阻断灰度并单独确认钉钉应用与机器人映射规则，避免改变原有多机器人语义。
- 周期性全量 reconciliation 增加一次轻量数据库查询，但避免新增表和持久化 worker；默认 60 秒的收敛窗口是最小改动与即时恢复之间的取舍。
- 一旦 ACK 的消息允许在注销后完成，可能出现“注销后仍返回最后一条已接受回复”；这是避免消息静默丢失的显式兼容性取舍。
- Redis 租约解决默认双副本下的应用侧唯一持有，但 DingTalk SDK/服务端没有 fencing token。若持有者与 Redis 长时间隔离且 SDK stop 同时失败，租约过期后理论上仍可能出现短暂物理连接重叠；设计通过先关闭消息入口、`STOP_FAILED` 健康失败、持续告警和要求 JVM 退出收敛，不能把该边界表述为服务端强一致 fencing。
- 跨实例配置写互斥器会串行化低频 DingTalk 配置提交；Redis 不可用时相关提交 fail closed，但消息和其他渠道不受该互斥器影响。
- 当前 K3s 清单没有现成的存活/就绪探针，本次也不改变整个应用的聚合健康状态，避免 DingTalk 单机器人故障影响其他渠道流量。`STOP_FAILED` 告警必须携带实例与 `robotCode`，值班 runbook 要求重启该 Pod，并验证旧实例退出、租约释放或过期及另一实例接管；自动探针重启需作为独立部署变更评审。
