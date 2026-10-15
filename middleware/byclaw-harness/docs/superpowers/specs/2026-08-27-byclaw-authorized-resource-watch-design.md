# ByClaw 授权资源加载与动态监听设计

## 目标

让 `plugins/byclaw-integration` 只读取当前 `USER_CODE` 获得授权的 `DIG_EMPLOYEE` Redis 资源，并在授权 Hash 或资源变更频道更新时自动、串行、原子地重建 DSH 模板。启动过程不得扫描全库 `DIG_EMPLOYEE_*` key，也不得通过 `discoverMine` 推断授权资源。

## 问题与基线

当前资源同步先调用 `discoverMine` 和逐条 HTTP detail，再执行 `SCAN MATCH DIG_EMPLOYEE_*`，并串行 `GET` 每一个命中的 key 以推断专家团。真实环境中扫描到 264 个 key，265 次 Redis `GET` 耗时约 16.4 秒，完整 `pnpm dsh web` 启动到 ready 约 28.45 秒；禁用 ByClaw Integration 后约 3.49 秒。该扫描既跨越当前用户的授权范围，也把插件冷启动阻塞在无关资源上。

`baiying-enhance` 已定义授权链路：`SHARE_BFM_USER_CODE_${USER_CODE}` 映射内部用户 ID，`USER:RESOURCES:AUTH:${userId}` Hash 存储授权资源。只解析类型为 `DIG_EMPLOYEE` 的字段或 JSON 值，再读取对应 `DIG_EMPLOYEE_${resourceId}` snapshot。当前环境的该路径包含 16 个授权资源，目标读取约 0.53 秒；两个授权专家团还引用 1 个不在直接授权集合内的成员，需按成员 ID 补读。

## 数据来源

- Redis 授权 Hash 是资源可见性的唯一来源。字段名或 JSON value 中 `resourceBizType` / `resourceType` 为 `DIG_EMPLOYEE` 时提取资源 ID。
- Redis `DIG_EMPLOYEE_${id}` snapshot 是数字员工和专家团基本字段、成员声明及 Skill 引用的来源。
- 专家团 `resolve-runtime` 继续提供团长 Prompt、模型、配置版本和有效成员。
- Skill version/download HTTP 请求继续更新本地 Skill cache。
- 资源目录加载不再调用 `discoverMine` 或 `findDetailsById`，也不再执行 Redis `SCAN`。

## 冷启动加载

1. 读取 `SHARE_BFM_USER_CODE_${userCode}`，要求得到非空内部用户 ID。
2. 读取 `USER:RESOURCES:AUTH:${userId}`，解析并去重授权资源 ID；缺失授权 Hash 在首次启动时报错，合法空 Hash 产生空目录。
3. 以可配置且有界的并发度读取直接授权的 `DIG_EMPLOYEE_${id}` snapshot。缺失或无效 snapshot 使首次同步失败，不发布部分目录。
4. 根据 snapshot 分类数字员工和专家团，并记录直接授权数字员工 ID。
5. 收集授权专家团声明的成员 ID，仅对直接集合以外的成员做目标 `GET`；这些成员只用于专家团装配，不进入独立可路由员工集合。
6. 使用已有 generation lease 和 staged publication 原子生成 Skills、员工模板、专家团团长模板与 AgentTeams 适配器。成功后才启动 Worker。

## 授权动态监听

授权监听复用 `baiying-enhance` 语义：

- 订阅当前 Redis DB 的 `__keyspace@<db>__:USER:RESOURCES:AUTH:${userId}`；仅当 `notify-keyspace-events` 包含 Hash/keyspace 能力时依赖该信号。
- 无论 keyspace 通知是否可用都保留低频轮询兜底；通知不可用时缩短轮询间隔。
- 授权集合实际变化才触发一次完整资源刷新。新增授权会生成新模板，撤销授权会删除相应 ByClaw-owned 模板。
- 热更新期间临时读不到授权 key 时，在宽限期内保留最后成功集合和模板；超过宽限期仍缺失则记录警告但不发布空目录。Hash 明确存在且为空代表确认撤销全部授权，应发布空目录。

## 资源变更频道

订阅 `byai:pub:dig_employee_change`，解析 `CREATED`、`UPDATED`、`DELETED`、`SKILLS_SYNCED` 事件：

- 忽略非 `DIG_EMPLOYEE` 事件和无效 payload。
- 新建、更新和 Skill 同步只接受当前直接授权 ID或授权专家团成员 ID；删除事件允许清理已投影资源。
- 按 `resourceId` 合并 debounce 窗口内的事件；`DELETED` 优先，其他事件保留最大的 `changedAt`，丢弃比已处理版本更旧的事件。
- 一个批次只触发一次完整资源刷新。刷新通过现有 promise 队列串行执行，避免重叠 generation。

## 失败、并发与卸载

- 首次 Redis 授权或资源加载失败时启动失败，不允许 Worker 带空资源上线。
- 热刷新失败保留最后完整 generation，并继续监听后续事件。
- 授权和资源信号共用同一个串行刷新队列。收到信号时只排队，不并发读取或发布。
- unload 停止定时器、移除监听、退订 keyspace pattern 和资源频道，等待已接纳刷新结束，再关闭 Worker、session 和 Redis client。

## 配置

新增可部署配置：授权轮询间隔、keyspace 不可用时的轮询间隔、授权 key 缺失宽限期、资源事件 debounce、snapshot 读取并发度，以及 Skill／员工模型／专家团运行配置请求共享的投影并发度。默认值与 `baiying-enhance` 保持一致或更保守：5 秒、2 秒、15 秒、250 毫秒、8、8。

## 验证与验收

- 单元/脚本验证覆盖授权格式解析、只读目标 key、专家团成员补读、空授权、缺失 snapshot、授权新增与撤销、资源事件过滤/合并/旧事件丢弃、串行刷新、热失败保留 last-good 和卸载清理。
- 插件完整 `verify`、`typecheck` 和构建通过。
- 将源码文件同步到 `/Users/chenxiaofeng/code/open/deepseek-harness/plugins/byclaw-integration` 后，从 DSH 源码启动真实 Web profile。
- 冷启动日志和 Redis MONITOR/测试 instrumentation 不出现 `SCAN ... DIG_EMPLOYEE_*` 或 `discoverMine`。
- 真实授权加载只读取当前授权 ID和专家团补充成员 ID；完整 ready 时间相对 28.45 秒基线至少缩短 50%。
- 真实修改授权 Hash、发布资源更新和删除事件后，无需重启即可观察模板目录及 `byclaw_list_resources` 更新；失败注入时旧模板继续可用。
