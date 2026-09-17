# dbcli 设计：面向 Skill 业务脚本的统一 SQL 执行与事务运行时

## 1. 目标与边界

Agent 负责根据业务需求创建 Skill，Skill 内的脚本通过 `dbcli` 执行 SQL。
`dbcli` 屏蔽 PostgreSQL/OpenGauss、MySQL、Oracle 等数据源的连接与驱动差异，
并保证一次 Skill 业务脚本中的多条写 SQL 处于同一数据库事务。

Agent 开发 Skill 时从平台分配的编码中选择 `datasource_code`，并将它固定在 Skill 公开入口中；
Agent 不能知道驱动、主机、端口、数据库名、用户名或密码。Skill 运行时调用方只传入
动态 `session_id`，`dbcli` 将它与 Skill 中已固定的 `datasource_code` 组合，通过服务发现获取
当前会话有权使用的短期连接信息。

`只知道数据源编码` 指不知道连接信息，不代表不需要业务 Schema。Agent 要编写可执行 SQL，
平台必须按 `datasource_code` 提供版本化的逻辑 Schema 合同（表、列、类型、主外键、
可用视图和允许的操作）。Schema 合同不得包含主机、端口、DSN 或凭据。

第一版明确保证：

- 一个事务只访问一个数据源。
- 同一事务的 SQL 使用同一条物理连接。
- 脚本成功时提交，失败、超时或被终止时回滚。
- 数据库凭据不暴露给 Agent 或 Skill。
- `session_id` 与 `datasource_code` 在事务开始时绑定，事务中不得更换。
- 所有请求和结果都使用稳定的 JSON 协议。

不保证：

- 跨数据源原子性。
- 数据库与 HTTP、文件、消息、对象存储之间的原子性。
- 数据库本身不支持的隔离级别或 DDL 事务能力。

## 2. 核心决策

不允许 Skill 通过多次独立命令管理事务：

```bash
# 禁止：三次 CLI 调用可能对应三条连接
dbcli sql --session-id "$session_id" --datasource-code 3001 --text "BEGIN"
dbcli sql --session-id "$session_id" --datasource-code 3001 --text "UPDATE ..."
dbcli sql --session-id "$session_id" --datasource-code 3001 --text "COMMIT"
```

事务必须由一个长生命周期的 `dbcli transaction run` 进程持有：

```bash
dbcli transaction run \
  --session-id "$session_id" \
  --datasource-code 3001 \
  --isolation read-committed \
  --timeout 120s \
  -- ./scripts/business.sh
```

`transaction run` 建立数据库连接和事务，启动业务子进程，并通过仅当前用户
可访问的 Unix Socket 接收子进程中的 `dbcli sql` 请求。因此多个短生命周
`dbcli sql` 进程仍可共享同一数据库连接。

## 3. 运行时架构

```text
不可控 Agent
  └──执行 Skill 公开入口 scripts/run.sh <session_id>
       └── dbcli transaction run --session-id ... --datasource-code ...
            ├── Service Discovery（鉴权并返回短期连接信息）
            ├── Transaction Host（持有唯一物理连接）
            ├── Unix Socket + 临时事务令牌
            └── business.sh
                 ├── dbcli sql -> Socket -> 固定连接
                 └── dbcli sql -> Socket -> 固定连接
```

### 3.1 组件

| 组件 | 职责 |
|---|---|
| CLI Parser | 解析命令，输出 JSON，管理退出码 |
| Transaction Host | 持有连接，执行 begin/commit/rollback，管理子进程 |
| Local IPC Server | 验证事务令牌，串行转发 SQL |
| Service Discovery Client | 使用动态 `session_id` 和 Skill 固定的 `datasource_code` 鉴权并获取短期连接信息 |
| Connection Resolver | 验证发现结果、驱动能力、有效期和策略，创建连接 |
| Driver Adapter | 适配驱动参数、隔离级别、取消和错误类型 |
| Policy Engine | 校验身份、SQL 类型、schema/table、行数和超时 |
| Audit Sink | 记录 request/transaction/skill run 的审计摘要 |

### 3.2 两种执行模式

**Script 模式**支持分支、循环和上一条 SQL 结果驱动下一条 SQL，是通用模式：

```bash
dbcli transaction run --session-id "$session_id" --datasource-code 3001 -- ./scripts/business.sh
```

**Plan 模式**将固定的多条 SQL 在单次 CLI 中执行，实现更简单、确定性更高：

```bash
dbcli transaction execute \
  --session-id "$session_id" \
  --datasource-code 3001 \
  --file ./sql/transaction.json
```

```json
{
  "isolation": "read-committed",
  "timeoutMs": 120000,
  "statements": [
    {"id": "debit", "sqlFile": "debit.sql", "paramsFile": "debit.params.json"},
    {"id": "credit", "sqlFile": "credit.sql", "paramsFile": "credit.params.json"}
  ]
}
```

优先使用 Plan 模式；需要条件分支或中间计算时才使用 Script 模式。

## 4. CLI 契约

### 4.1 所有命令的公共参数

任何会访问数据源的 `dbcli` 命令都必须同时提供：

```text
--session-id <id>
--datasource-code <code>
```

`session_id` 用于当前会话鉴权，`datasource_code` 标识 Skill 开发时已确定的数据源。
包括 Schema/Table 元数据命令在内，所有独立命令都先执行服务发现、会话鉴权和数据源授权。
事务内的 `dbcli sql` 仍要显式传入两个参数，但只校验它们与已鉴权的事务上下文一致，
然后复用事务开始时的发现结果和物理连接，不重复发现。

### 4.2 SQL 执行

```text
dbcli sql
  --session-id <id>          # 必填
  --datasource-code <code>   # 必填
  --text <sql>               # 与 --file/--stdin 三选一
  --file <path>
  --stdin
  --params <json>            # 与 --params-file 二选一
  --params-file <path>
  --max-rows <n>
  --timeout <duration>
  --format json|jsonl|csv
```

结构值必须使用参数，不得字符串拼接：

```bash
dbcli sql \
  --session-id "$session_id" \
  --datasource-code 3001 \
  --file ./sql/update-order.sql \
  --params '{"order_id":"O-1001","status":"PAID"}'
```

### 4.3 Schema 和表元数据

列出当前会话在数据源中有权看到的 Schema：

```bash
dbcli schema list \
  --session-id "$session_id" \
  --datasource-code 3001
```

列出指定 Schema 中有权访问的表和视图：

```bash
dbcli table list \
  --session-id "$session_id" \
  --datasource-code 3001 \
  --schema orders \
  --include table,view
```

查看表结构：

```bash
dbcli table describe \
  --session-id "$session_id" \
  --datasource-code 3001 \
  --schema orders \
  --table account
```

`table describe` 返回列名、逻辑类型、可空性、默认值、主键、唯一约束、外键、
索引摘要和允许操作。默认不返回表数据、存储路径、物理分片、主机或凭据。

查看当前会话对数据源的能力和策略：

```bash
dbcli datasource capabilities \
  --session-id "$session_id" \
  --datasource-code 3001
```

元数据命令的输出必须是稳定 JSON，并包含 `schemaVersion`，便于 Skill 记录开发时依赖的
Schema 版本。元数据只返回当前会话被授权的对象。

元数据输出契约示例：

```json
{
  "ok": true,
  "datasourceCode": "3001",
  "schemaVersion": "2026.09.1",
  "data": {
    "schemas": [{"name": "orders"}],
    "tables": [{"schema": "orders", "name": "account", "type": "TABLE"}],
    "table": {
      "schema": "orders",
      "name": "account",
      "columns": [
        {"name": "account_id", "type": "string", "nullable": false},
        {"name": "balance", "type": "decimal(18,2)", "nullable": false}
      ],
      "primaryKey": ["account_id"],
      "uniqueConstraints": [],
      "foreignKeys": [],
      "allowedOperations": ["SELECT", "UPDATE"]
    }
  }
}
```

实际命令只返回与自身类型对应的 `schemas`、`tables` 或 `table` 字段。Schema/Table 名称必须经过
标识符校验和授权检查，不得直接拼接未校验的命令行值。

### 4.4 事务脚本执行

```text
dbcli transaction run
  --session-id <id>
  --datasource-code <code>
  --isolation read-committed|repeatable-read|serializable
  --read-only
  --timeout <duration>
  -- <command> [args...]
```

Skill 不能直接执行 `BEGIN`、`COMMIT`、`ROLLBACK`。Policy Engine 应拒绝 SQL 中的事务控制语句。

### 4.5 输出

stdout 只输出机器可读结果，调试和诊断信息写入 stderr。

```json
{
  "ok": true,
  "requestId": "req_01",
  "transactionId": "tx_01",
  "datasourceCode": "3001",
  "statementType": "UPDATE",
  "affectedRows": 1,
  "columns": [],
  "rows": [],
  "truncated": false,
  "elapsedMs": 14
}
```

错误：

```json
{
  "ok": false,
  "requestId": "req_02",
  "transactionId": "tx_01",
  "error": {
    "code": "DB_CONSTRAINT_VIOLATION",
    "message": "Operation violates a database constraint",
    "retryable": false
  }
}
```

稳定退出码：`0` 成功，`2` 参数错误，`10` SQL/数据库错误，`11` 策略拒绝，
`12` 事务错误，`13` 超时，`14` 运行时不可用，`20` 提交结果不确定。

## 5. 事务协议

### 5.1 子进程上下文

Transaction Host 向业务子进程注入：

```text
DBCLI_TRANSACTION_SOCKET=/tmp/dbcli-<random>/transaction.sock
DBCLI_TRANSACTION_TOKEN=<high-entropy-one-time-token>
DBCLI_TRANSACTION_ID=tx_01
DBCLI_SESSION_ID=session_01
DBCLI_DATASOURCE_CODE=3001
```

这些值是 CLI 的内部协议，Skill 不得读取、修改、打印或持久化。
`DBCLI_SESSION_ID` 只用于事务内部 `dbcli sql` 显式传参；Skill 不得打印或持久化它。

### 5.2 状态转换

```text
CREATED -> ACTIVE -> COMMITTING -> COMMITTED
                  \-> ROLLING_BACK -> ROLLED_BACK
                  \-> EXPIRED -> ROLLED_BACK
COMMITTING -> UNKNOWN   # commit 期间连接中断
```

终止规则：

- 子进程退出码为 `0`：提交。
- 非 `0`、脚本超时、SQL 超时、SIGINT 或 SIGTERM：回滚。
- 某条 SQL 失败后将事务标记为 failed-only，后续 SQL 统一拒绝。
- 连接中断后不得换连接继续事务。
- commit 发送后连接中断，返回 `TX_OUTCOME_UNKNOWN`，不自动重试。

### 5.3 并发

同一事务的 SQL 默认串行执行。即使业务脚本并发启动多个 `dbcli sql`，
Transaction Host 也必须排队，否则 SQL 顺序和驱动连接状态不可预期。

## 6. 数据源适配

### 6.1 服务发现与连接解析

`dbcli` 不保存业务数据源连接信息。每条命令开始前，使用下列输入调用服务发现：

```json
{
  "sessionId": "2001",
  "resourceType": "data_source",
  "resourceId": "3001",
  "pageNum": 1,
  "pageSize": 1,
  "includeCredentials": true
}
```

其中 `resourceId` 等于 Skill 中固定的数据源编码。开放会话资源接口完成会话创建者/成员、
项目创建者/成员以及项目资源归属校验。`dbcli` 请求连接时必须设置
`includeCredentials=true`，但绝不把响应凭据传给 Skill 子进程。

平台原始返回为分页结构：

```json
{
  "code": "0",
  "data": {
    "items": [{
      "resourceType": "data_source",
      "resourceId": "3001",
      "datasourceId": "3001",
      "datasourceType": "opengauss",
      "connectionConfig": {
        "host": "database.internal",
        "port": "5432",
        "database": "orders",
        "username": "session_user",
        "schema": "orders",
        "sslMode": "require"
      },
      "credentials": {"password": "<password>"}
    }],
    "total": "1"
  }
}
```

`dbcli` 在内存中把该条目转换为 `ResolvedDataSource`。`datasourceType=opengauss`
映射到 openGauss/PostgreSQL 驱动，`host + port` 映射为 endpoint，用户名与密码映射为
credential，`sslMode` 映射为驱动 `sslmode`。SSL 模式只接受平台配置界面支持的
`disable`、`require`、`verify-ca`、`verify-full`；其他值在连接数据库前按发现协议错误
拒绝。`connectionConfig.schema` 会转换为 psycopg 的
`options=-c search_path=<schema>`，使 Skill 中未限定 schema 的 SQL 默认落到配置模式；
schema 必须是安全 SQL 标识符。返回空 `items` 时报告
`DATASOURCE_NOT_FOUND`；返回项 ID 或类型与请求不一致时按协议错误拒绝连接。

约束：

- 只有 `dbcli` 进程可获取发现结果，不得转发给 Skill 子进程。
- 发现结果只存于内存，不写入文件、stdout、stderr 或审计日志。
- 连接凭据有效期必须覆盖事务预计时长；不满足时在 `BEGIN` 前失败。
- 一个事务只发现一次并绑定 `session_id + datasource_code + resolution_id`。
- 事务进行中不刷新凭据、不重新发现、不切换物理连接。
- 发现服务不可用或鉴权失败时禁止执行 SQL，不使用本地默认连接降级。
- `session_id` 是不透明授权上下文，日志中只记录 hash 或脱敏值。

服务发现客户端接口：

```text
DiscoveryClient.resolve(session_id, datasource_code, purpose, request_id)
  -> ResolvedDataSource
```

### 6.2 驱动适配

```text
DataSourceAdapter
  connect(configuration)
  list_schemas(connection)
  list_tables(connection, schema, object_types)
  describe_table(connection, schema, table)
  begin(connection, options)
  execute(connection, sql, parameters, options)
  commit(connection)
  rollback(connection)
  cancel(connection, request_id)
  classify_error(error)
  capabilities()
```

每个适配器声明能力：

```json
{
  "transactions": true,
  "savepoints": true,
  "ddlTransactional": true,
  "cancel": true,
  "isolationLevels": ["read-committed", "repeatable-read", "serializable"]
}
```

如果数据源不支持请求的能力，必须在执行前失败，不得静默降级。

## 7. 策略与安全

数据源安全策略由服务发现结果下发。生产环境不保存固定发现地址，而是复用平台
`by_framework` 的 Redis 服务发现机制（实现约定与
`skills/structured-ontology-manager/scripts/_common.py` 一致）：

```yaml
discovery:
  serviceNameEnv: DBCLI_DATASOURCE_SERVICE
  serviceNameFallbackEnv: BE_DOMAINNAME
  resolvePath: /byaiService/open/api/v1/sessionResources/query
  timeoutMs: 3000
  cacheIntervalSeconds: 5
  retry:
    maxAttempts: 3
    statusCodes: [502, 503, 504]
```

初始化顺序如下：

1. Redis 集群优先读取 `DATACLOUD_GATEWAY_REDIS_CLUSTER_HOST`，其次
   `REDIS_CLUSTER_HOST`；节点格式为逗号分隔的 `host[:port]`，缺省端口 6379。
2. 单机配置优先读取 `DATACLOUD_GATEWAY_REDIS_HOST/PORT/DB/PASSWORD/USERNAME`，
   分别回退到 `REDIS_HOST/PORT/REDIS_DATABASE/PASSWORD/USERNAME`。
3. 调用 `init_redis(RedisConfig(...))`，再由 `DiscoveryClient` 和
   `DiscoveryHttpClient` 按服务名发起 POST。
4. 请求携带 `sessionId`、`resourceType=data_source`、
   `resourceId=<固定 datasource_code>`、`pageNum=1`、`pageSize=1` 和
   `includeCredentials=true`；若运行环境提供 `BEYOND_TOKEN`、`SYSTEM_CODE`，分别转发为
   `Beyond-Token`、`system-code`。
5. 平台响应支持 `{code, msg, data}` 信封，兼容数值 `0` 和字符串 `"0"`；只有 HTTP 成功且 `code == 0` 时解析
   `data`。客户端始终关闭服务发现对象。

`DBCLI_DISCOVERY_URL` 仅作为本地测试/独立联调的显式直连覆盖；直连生产环境要求
HTTPS，禁止将它写入 Skill。

强制策略：

- Agent 只使用 `datasource_code`，不接触驱动、DSN、网络地址、用户名和密码。
- `session_id` 必须由 Skill 运行时调用方传入，不得硬编码在 Skill 中。
- `datasource_code` 必须在 Skill 开发完成时固定，运行时调用方不得覆盖。
- 服务发现返回的策略只能收紧平台基线，不得由 Skill 覆盖。
- 写 SQL 默认必须位于 `transaction run/execute` 内。
- 限制允许的 schema/table/statement type，生产环境默认禁止 DROP/TRUNCATE。
- Socket 目录权限为 `0700`，Socket 为 `0600`，令牌仅在子进程环境中传递。
- 日志不记录密码、令牌、完整敏感参数或无脱敏查询结果。
- 审计记录 skill id/run id、数据源、SQL hash、耗时、影响行数和事务结果。

## 8. 实现分层

建议 Python 包结构：

```text
dbcli/
├── pyproject.toml
├── src/dbcli/
│   ├── cli.py
│   ├── contracts.py
│   ├── discovery_client.py
│   ├── connection_resolver.py
│   ├── policy.py
│   ├── transaction_host.py
│   ├── ipc.py
│   ├── audit.py
│   └── adapters/
│       ├── base.py
│       ├── postgres.py
│       ├── mysql.py
│       └── oracle.py
└── tests/
    ├── unit/
    ├── contract/
    └── integration/
```

Transaction Host 主流程伪代码：

```python
async def run_transaction(command, session_id, datasource_code, options):
    resolved = await discovery.resolve(
        session_id=session_id,
        datasource_code=datasource_code,
        purpose="transaction",
    )
    policy.validate_resolution(resolved, options)
    adapter = adapters.require(resolved.driver)
    connection = await adapter.connect(resolved)
    transaction = await adapter.begin(connection, options)
    socket, token = await ipc.start(connection, transaction)
    try:
        exit_code = await run_child(
            command,
            env=transaction_environment(socket, token),
            timeout=options.timeout,
        )
        if exit_code != 0 or ipc.transaction_failed:
            await transaction.rollback()
            return exit_code or TX_FAILED
        await transaction.commit()
        return 0
    except BaseException:
        await transaction.rollback()
        raise
    finally:
        await ipc.close()
        await connection.close()
```

## 9. 交付阶段

### MVP

1. PostgreSQL/OpenGauss 适配器。
2. `session_id + datasource_code` 服务发现客户端。
3. `dbcli datasource capabilities`、`schema list`、`table list`、`table describe`。
4. `dbcli sql`。
5. `dbcli transaction execute --file` Plan 模式。
6. `dbcli transaction run -- command` Script 模式。
7. Unix Socket、超时、信号回滚和结构化输出。
8. 写操作必须在事务中的强制策略。

### 增强

1. MySQL、Oracle 适配器。
2. Savepoint、查询取消、JSONL 流式结果。
3. Vault/KMS、RBAC 和集中审计。
4. Outbox/Saga；只在明确需要且所有数据源具备能力时考虑 XA。

## 10. 验收条件

- 两条写 SQL 第二条失败时，第一条不可见。
- 业务脚本返回非零、超时、SIGTERM 时均回滚。
- 事务内两次 `dbcli sql` 的数据库 session id 相同。
- 事务内切换数据源被拒绝。
- 不同 `session_id` 无法复用其他会话的数据源授权或事务。
- 服务发现失败或鉴权失败时，不发起任何数据库连接。
- 发现获得的连接信息不出现在子进程环境、输出和日志中。
- 所有命令缺少 `session_id` 或 `datasource_code` 时均在服务发现前失败。
- Schema/Table 命令只返回当前会话已授权对象，且包含 `schemaVersion`。
- 未授权的 Schema/Table 对象不得通过列表、描述、错误详情或时序差异泄露。
- 事务外写 SQL 在 `writesRequireTransaction=true` 时被拒绝。
- SQL 错误后即使脚本忽略退出码，整个事务仍不能提交。
- 参数、令牌和凭据不出现在日志中。
- commit 结果不确定时返回专用错误，不重试写 SQL。

## 11. 当前实现与运行

实现位于本目录的 `src/dbcli/`，安装基础 CLI：

```bash
python3 -m pip install -e .
```

根据实际数据源安装驱动：

```bash
python3 -m pip install -e '.[postgres]'
python3 -m pip install -e '.[mysql]'
python3 -m pip install -e '.[oracle]'
```

生产运行时由平台注入服务名与 Redis 配置，例如：

```bash
export DBCLI_DATASOURCE_SERVICE='byclaw-datasource-service'
export REDIS_HOST='redis'
export REDIS_PORT='6379'
```

服务名未单独配置时回退到 `BE_DOMAINNAME`。解析路径可用
`DBCLI_DATASOURCE_RESOLVE_PATH` 覆盖。`DBCLI_DISCOVERY_URL` 与
`DBCLI_ALLOW_INSECURE_DISCOVERY=1` 只用于本地自动化测试，生产环境不得设置。
可选的 `DBCLI_AUDIT_FILE` 指向平台保护的审计 JSONL 文件；记录中只包含
`session_id` hash 和 SQL hash，不包含原始会话、SQL、参数或凭据。

内置 SQLite 适配器用于端到端事务验证。生产数据源通过可选驱动适配
PostgreSQL/OpenGauss、MySQL 和 Oracle。
