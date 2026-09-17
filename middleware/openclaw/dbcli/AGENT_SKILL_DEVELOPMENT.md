# Agent 基于 dbcli 开发数据库业务 Skill 规范

> 本文档供创建或修改 Skill 的 Agent 使用。开发时选择已分配的 `datasource_code`
> 并将其固定在 Skill 中；运行时调用方只传入 `session_id`。
> 不要将 `session_id`、数据库密码、DSN 或事务令牌写入 Skill。

## 核心规则

1. 只通过 `dbcli` 访问业务数据库，不直接使用数据库驱动。
2. `SELECT` 可使用单次 `dbcli sql`；任何多步写业务必须使用 `dbcli transaction run` 或 `transaction execute`。
3. 不得在 SQL 文本中写 `BEGIN`、`COMMIT`、`ROLLBACK`。
4. 不得把多条独立 `dbcli sql` 当作一个事务。
5. 所有外部值使用 `--params`/`--params-file`，不拼接 SQL。
6. Skill 只公开一个业务入口；不允许 Agent 直接调用事务内部脚本。
7. 一个事务只能使用一个 `datasource_code`。
8. 检查每次 `dbcli` 的退出码和 JSON `ok`。禁止使用 `|| true` 吞掉数据库错误。
9. `session_id` 只能由 Skill 运行时入参获取，不得硬编码、伪造、打印或持久化。
10. `datasource_code` 在 Skill 开发完成时必须确定；不得将其设计成运行时入参。
11. 所有 `dbcli` 命令（包括 Schema/Table 元数据命令）都必须显式传入 `session_id` 和 `datasource_code`。

## 标准 Skill 结构

```text
order-transfer/
├── SKILL.md
├── scripts/
│   ├── run.sh             # 唯一公开入口
│   └── business.sh        # 事务内部脚本
└── sql/
    ├── lock-account.sql
    ├── debit.sql
    └── credit.sql
```

SQL 文件和脚本分离，便于审查 SQL 权限、锁和影响范围。
上述以 Shell 命名示意；选择 Python 时使用 `run.py + business.py`。
一个实际 Skill 只能选择并公开一种入口，不得同时暴露 Shell 和 Python 两个入口。

## 开发流程

### 1. 确认数据源与能力

开发时从项目提供的数据源目录和版本化 Schema 合同中确认：

- `datasource_code`；
- 是否只读；
- 允许访问的 schema/table；
- 支持的事务隔离级别；
- 语句、事务和结果集限制。
- Schema 合同版本以及表、列、类型、约束和可用视图。

数据源目录由平台以文档或只读配置提供。Agent 不得探测或记录数据源连接信息。
Skill 运行时，`dbcli` 使用调用方传入的 `session_id` 和 Skill 中已固定的
`datasource_code` 通过服务发现解析当前会话有权使用的连接信息。
在实际服务请求中，`dbcli` 将它作为开放会话资源 API 的 `resourceId`，并固定发送
`resourceType=data_source`。该接口的 `resourceId` 是长整型或数字字符串，因此 Skill
中应固定平台提供的数据源资源 ID（推荐字符串形式，例如 `"3001"`），不要使用名称或
让模型猜测 ID。
服务发现、Redis、认证令牌和真实连接信息全部由 `dbcli` 与平台运行环境处理；
Skill 脚本不得读取或配置 `DBCLI_DATASOURCE_SERVICE`、`BE_DOMAINNAME`、`REDIS_*`、
`DATACLOUD_GATEWAY_REDIS_*`、`BEYOND_TOKEN`、`SYSTEM_CODE`，也不得设置测试专用的
`DBCLI_DISCOVERY_URL`。Agent 只负责传递动态 `session_id` 和 Skill 内固定的
`datasource_code`。
如果无权限或数据源不支持需要的事务能力，停止开发并报告缺失能力，
不得改用非事务执行。

### 2. 先发现 Schema 和表

```bash
# 1. 查看数据源能力与 Schema 版本
dbcli datasource capabilities \
  --session-id "$dev_session_id" \
  --datasource-code 3001

# 2. 列出当前会话有权访问的 Schema
dbcli schema list \
  --session-id "$dev_session_id" \
  --datasource-code 3001

# 3. 列出目标 Schema 的表和视图
dbcli table list \
  --session-id "$dev_session_id" \
  --datasource-code 3001 \
  --schema orders \
  --include table,view

# 4. 查看业务所需表的列、主键、唯一约束和外键
dbcli table describe \
  --session-id "$dev_session_id" \
  --datasource-code 3001 \
  --schema orders \
  --table account
```

开发平台可以向 Agent 传入短期 `dev_session_id`，但 Agent 不得将它写入产出的 Skill。
元数据命令只能返回当前会话已授权的对象。记录 Skill 依赖的 `schemaVersion`，
但不记录会话、主机、端口、DSN 或凭据。

不要根据自然语言需求猜测表名、列名、类型、唯一约束或外键。
无法获取元数据时，停止编写业务 SQL 并报告所缺信息。

### 3. 定义事务不变量

编写脚本前写清楚：

- 业务成功后必须同时成立的数据状态；
- 任意一步失败后不得残留的中间状态；
- 同一业务请求重复调用时的幂等规则；
- 并发执行时需要锁定的行；
- 合法的影响行数。

### 4. 选择执行模式

| 业务特征 | 使用方式 |
|---|---|
| 固定顺序的多条 SQL，没有中间分支 | `dbcli transaction execute --session-id ... --datasource-code ... --file plan.json` |
| 后续步骤依赖前面查询结果 | `dbcli transaction run --session-id ... --datasource-code ... -- business.sh` |
| 单条只读查询 | `dbcli sql --session-id ... --datasource-code ...` |
| 需要跨库写入 | 不得实现为普通事务；报告需要 Saga/Outbox/XA 设计 |

### 5. 编写公开入口

`scripts/run.sh`：

```bash
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ "$#" -lt 1 ]]; then
  echo '{"ok":false,"error":{"code":"INVALID_ARGUMENT","message":"session_id is required"}}' >&2
  exit 2
fi

session_id="$1"
shift

# 开发 Skill 时确定，运行时不允许覆盖。
readonly datasource_code="3001"

exec dbcli transaction run \
  --session-id "$session_id" \
  --datasource-code "$datasource_code" \
  --isolation read-committed \
  --timeout 120s \
  -- "${SCRIPT_DIR}/business.sh" "$@"
```

要求：

- 使用 `exec` 使信号、退出码和超时语义保持清晰。
- 所有路径根据脚本所在目录解析，不依赖 Agent 的当前工作目录。
- 第一个运行时参数固定为 `session_id`，并原样传给 `dbcli`。
- `datasource_code` 在 `run.sh` 中使用只读常量固定，不从命令行、环境变量或业务输入读取。
- 不得把 `session_id` 或数据源连接信息写入脚本、SQL、配置、缓存和日志。
- 请求输入在进入事务前完成格式和必填项校验。

### 6. 编写业务脚本

`scripts/business.sh`：

```bash
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

: "${DBCLI_TRANSACTION_ID:?business.sh must run through scripts/run.sh}"

request_id="$1"
from_account="$2"
to_account="$3"
amount="$4"

dbcli sql \
  --session-id "$DBCLI_SESSION_ID" \
  --datasource-code "$DBCLI_DATASOURCE_CODE" \
  --file "${SKILL_DIR}/sql/debit.sql" \
  --params "$(jq -nc \
    --arg request_id "$request_id" \
    --arg account_id "$from_account" \
    --argjson amount "$amount" \
    '{request_id:$request_id, account_id:$account_id, amount:$amount}')"

dbcli sql \
  --session-id "$DBCLI_SESSION_ID" \
  --datasource-code "$DBCLI_DATASOURCE_CODE" \
  --file "${SKILL_DIR}/sql/credit.sql" \
  --params "$(jq -nc \
    --arg request_id "$request_id" \
    --arg account_id "$to_account" \
    --argjson amount "$amount" \
    '{request_id:$request_id, account_id:$account_id, amount:$amount}')"
```

不要输出或操作 `DBCLI_TRANSACTION_SOCKET`、`DBCLI_TRANSACTION_TOKEN`。

#### Python 脚本模式

当业务包含较多 JSON 处理、条件分支、数值校验或错误映射时，优先使用 Python。
Python 公开入口仍必须由 `dbcli transaction run` 启动内部业务脚本：

```python
DATASOURCE_CODE = "3001"  # 开发完成时固定的平台数据源资源 ID

command = [
    "dbcli", "transaction", "run",
    "--session-id", session_id,
    "--datasource-code", DATASOURCE_CODE,
    "--timeout", "30s",
    "--",
    sys.executable, str(script_dir / "business.py"),
    *business_arguments,
]
exit_code = subprocess.run(command, check=False).returncode
```

Python 内部脚本通过参数数组调用 `dbcli sql`：

```python
command = [
    "dbcli", "sql",
    "--session-id", os.environ["DBCLI_SESSION_ID"],
    "--datasource-code", os.environ["DBCLI_DATASOURCE_CODE"],
    "--file", str(skill_dir / "sql" / "update.sql"),
    "--params", json.dumps(params, separators=(",", ":")),
    "--format", "json",
    "--expect-affected-rows", "1",
]
result = subprocess.run(command, check=False, capture_output=True, text=True)
payload = json.loads(result.stdout)
if result.returncode != 0 or payload.get("ok") is not True:
    raise RuntimeError("dbcli sql failed")
```

Python 规则：

- 使用 `subprocess.run([...])` 参数数组，禁止 `shell=True` 和字符串命令拼接。
- 每次检查子进程退出码和 JSON `ok`。
- 任何业务失败都抛出异常并以非零状态退出，使 Transaction Host 回滚。
- 不导入 `psycopg`、`pymysql`、`oracledb`、SQLAlchemy 等数据库客户端。
- 不输出、缓存或持久化 `DBCLI_SESSION_ID`、Socket 和事务令牌。
- 入参校验应在调用 `transaction run` 之前完成。

完整 Python 实现见
[`examples/account-transfer/scripts/run.py`](examples/account-transfer/scripts/run.py) 和
[`examples/account-transfer/scripts/business.py`](examples/account-transfer/scripts/business.py)。

### 7. 编写 SQL

`sql/debit.sql`：

```sql
UPDATE orders.account
SET balance = balance - :amount,
    updated_at = CURRENT_TIMESTAMP
WHERE account_id = :account_id
  AND balance >= :amount;
```

必须验证影响行数。转账场景中，影响 `0` 行不是成功，可以使用 CLI 断言：

```bash
dbcli sql \
  --session-id "$DBCLI_SESSION_ID" \
  --datasource-code "$DBCLI_DATASOURCE_CODE" \
  --file "${SKILL_DIR}/sql/debit.sql" \
  --params-file "$params_file" \
  --expect-affected-rows 1
```

如果 CLI 尚未提供断言选项，脚本必须解析输出并在不符合时非零退出。

### 8. 幂等与并发

每个写业务接受稳定的 `request_id`，由数据库唯一约束防止重复执行。

需要“先读后写”的行，根据数据库能力使用 `SELECT ... FOR UPDATE`，或者将校验条件合并到
`UPDATE ... WHERE ...` 中，并校验影响行数。不得依赖事务外预查询的结果。

### 9. 事务内禁止慢操作

以下操作应在事务开始前完成：

- LLM 推理或等待 Agent 决策；
- 等待用户确认；
- 网络下载和外部 HTTP 调用；
- 大文件解析；
- 可预先完成的计算。

事务内只保留必要的查询、校验、写入和影响行数判断。

## SKILL.md 必须包含的说明

```markdown
## Database execution

- Invoke only `scripts/run.sh` for this business operation.
- Call it as `scripts/run.sh <session_id> <business arguments...>`.
- Treat `session_id` as an opaque runtime value; never generate, log, persist, or hard-code it.
- Use the `datasource_code` fixed by this Skill; never accept a runtime override or request connection details.
- Do not invoke `scripts/business.sh` or SQL files directly.
- All database access goes through `dbcli`; do not import a database driver.
- The command is successful only when it exits with code 0 and returns `ok: true`.
- Do not retry an unknown transaction outcome automatically.
```

`SKILL.md` 应另外说明：

- 何时触发该 Skill；
- 入参含义和校验规则；
- 唯一公开入口命令；
- 成功输出与可能错误；
- 哪些操作需要用户显式授权。

## 错误处理规则

| 错误 | Agent/Skill 行为 |
|---|---|
| `SESSION_INVALID` | 停止，要求调用方提供有效会话，不生成新会话 |
| `DATASOURCE_FORBIDDEN` | 停止，当前会话无权使用该 Skill 固定的数据源 |
| `SCHEMA_NOT_FOUND` / `TABLE_NOT_FOUND` | 重新读取元数据，不猜测名称 |
| `SCHEMA_VERSION_MISMATCH` | 停止写入，根据新 Schema 重新验证 Skill |
| `DB_POLICY_DENIED` | 停止，报告需要的权限，不规避策略 |
| `DB_CONSTRAINT_VIOLATION` | 作为业务失败处理，不修改约束 |
| `TX_DATASOURCE_MISMATCH` | 停止，重新设计为单库事务或补偿流程 |
| `TX_TIMEOUT` | 确认已回滚；只有业务幂等时才可重试 |
| `TX_OUTCOME_UNKNOWN` | 禁止盲目重试；用 `request_id` 查询业务状态 |
| `DBCLI_UNAVAILABLE` | 停止写入，报告运行时异常 |

## 发布前检查

- [ ] 只有一个公开业务入口。
- [ ] Shell/Python 二选一，未同时暴露两个入口。
- [ ] 公开入口只接收动态 `session_id`，不接收 `datasource_code`。
- [ ] `datasource_code` 已作为只读常量固定在 Skill 入口中。
- [ ] 所有 `dbcli` 命令都显式传入 `session_id` 和 `datasource_code`。
- [ ] 已使用 `schema list`、`table list`、`table describe` 确认业务对象。
- [ ] Skill 记录了依赖的 `schemaVersion`。
- [ ] Skill 中没有硬编码、生成、打印或持久化 `session_id`。
- [ ] Skill 中没有驱动、DSN、主机、端口、用户名或密码。
- [ ] 所有写 SQL 均在 `transaction run/execute` 中。
- [ ] 没有手写 BEGIN/COMMIT/ROLLBACK。
- [ ] 没有 SQL 字符串拼接。
- [ ] 事务只访问一个数据源。
- [ ] 每条关键写 SQL 都校验影响行数。
- [ ] 写业务具备 `request_id` 和数据库唯一约束保护。
- [ ] 脚本使用严格错误模式，未吞掉 CLI 错误。
- [ ] 事务内没有 LLM、用户交互或慢网络调用。
- [ ] 测试了成功、中间 SQL 失败、非零退出、超时和重复 request_id。
- [ ] 失败测试证明没有中间数据残留。
- [ ] 日志中没有凭据、事务令牌和敏感参数。

## 禁止的实现

```bash
# 错误：跨进程 BEGIN/COMMIT 不保证使用同一连接
dbcli sql --session-id "$session_id" --datasource-code 3001 --text 'BEGIN'
dbcli sql --session-id "$session_id" --datasource-code 3001 --file ./sql/step-1.sql
dbcli sql --session-id "$session_id" --datasource-code 3001 --file ./sql/step-2.sql
dbcli sql --session-id "$session_id" --datasource-code 3001 --text 'COMMIT'

# 错误：吞掉错误可能让外层误判成功
dbcli sql --session-id "$session_id" --datasource-code 3001 --file ./sql/update.sql || true

# 错误：字符串拼接
dbcli sql --session-id "$session_id" --datasource-code 3001 \
  --text "SELECT * FROM orders WHERE id = '$order_id'"

# 错误：事务内调用远程服务
dbcli transaction run --session-id "$session_id" --datasource-code 3001 -- ./update-db-and-call-http.sh
```

## 完整参考用例

参考 [`examples/account-transfer/`](examples/account-transfer/) 中的账户转账 Skill。该用例覆盖：

- 等价的 Shell 和 Python 脚本实现；
- 动态 `session_id` 与固定 `datasource_code`；
- Schema 合同版本；
- 入参校验和唯一公开入口；
- `request_id` 幂等处理；
- 稳定顺序行锁；
- 余额条件更新和影响行数断言；
- 多条 SQL 同事务提交或回滚；
- 结构化成功、重复请求和冲突输出。
