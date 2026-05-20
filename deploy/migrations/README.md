# Database Migrations

手动维护的数据库版本迁移脚本，用于管理 ByClaw 的增量 schema 变更。

## 目录结构

```
deploy/migrations/
├── README.md              # 本文件
└── versions/
    ├── V0.0.1-alpha__baseline.sql   # 基线（等同于 initdb/ 完整内容）
    ├── V0.0.2__xxx.sql              # 后续增量变更
    └── ...
```

## 与 initdb 的关系

| 目录 | 用途 |
|------|------|
| `deploy/middleware/initdb/` | 全新部署的初始化脚本，OpenGauss 首次启动时自动执行 |
| `deploy/migrations/versions/` | 所有版本的完整记录，手动按需执行 |

- `V0.0.1-alpha__baseline.sql` = initdb 的完整快照，用于版本追踪
- 后续版本的增量变更放在 versions/ 下，手动执行

## 命名规范

```
V{major}.{minor}.{patch}__{description}.sql
```

同一版本多个变更用序号区分：

```
V0.0.2_01__add_agent_tags.sql
V0.0.2_02__add_agent_index.sql
```

按文件名字母序排列，确保执行顺序正确。

## 使用方法

### 全新部署

OpenGauss 首次启动时自动执行 `initdb/`，无需手动操作。如果当前版本高于 v0.0.1-alpha，需要手动执行后续迁移脚本：

```bash
PGPASSWORD=$DB_PASS psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_DATABASE \
  -v ON_ERROR_STOP=1 -1 -f deploy/migrations/versions/V0.0.2__xxx.sql
```

### 版本升级

按版本顺序逐个执行新增的迁移脚本：

```bash
# 查看有哪些新脚本
ls deploy/migrations/versions/

# 逐个执行（按文件名顺序）
PGPASSWORD=$DB_PASS psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_DATABASE \
  -v ON_ERROR_STOP=1 -1 -f deploy/migrations/versions/V0.0.2__add_agent_tags.sql
```

`-v ON_ERROR_STOP=1` 遇错即停，`-1` 在单事务中执行（失败自动回滚）。

## 编写规则

1. 使用 `IF NOT EXISTS` / `IF EXISTS` 保证幂等性
2. 开头加 `SET search_path TO byai;`
3. 每个文件应能在单事务中执行
4. 已执行的脚本不要修改，需要修正就写新脚本
5. 大表 DDL 注意锁表风险，必要时使用 `CONCURRENTLY`（需在事务外执行）

## 模板

```sql
-- V0.0.2__add_agent_tags.sql
SET search_path TO byai;

ALTER TABLE ss_resource ADD COLUMN IF NOT EXISTS tags TEXT[];
CREATE INDEX IF NOT EXISTS idx_resource_tags ON ss_resource USING gin(tags);
```

## FAQ

**Q: 基线脚本需要执行吗？**

不需要。`V0.0.1-alpha__baseline.sql` 仅用于版本追踪记录。全新部署由 `initdb/` 自动完成。

**Q: 能回滚吗？**

不支持自动回滚。如需回滚，编写一个新的迁移脚本撤销变更（如 `V0.0.3__revert_xxx.sql`）。

**Q: initdb 和 baseline 内容不一致怎么办？**

以 `initdb/` 为准（它是实际执行的）。如果 initdb 有变更，同步更新 baseline 或写新的增量脚本。
