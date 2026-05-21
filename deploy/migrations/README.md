# Database Migrations

手动维护的数据库版本迁移脚本，用于管理 ByClaw 的增量 schema 变更。

## 目录结构

```
deploy/migrations/
├── README.md              # 本文件
├── merge_migrations.py    # 增量脚本合并工具
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

## 合并工具 (merge_migrations.py)

将 `versions/` 下的增量脚本自动区分 DDL/DML，追加合并到 `initdb/02_ddl.sql` 和 `initdb/04_dml.sql`，确保新部署环境包含所有历史变更。

### 用法

```bash
# 预览（不写入文件）
python deploy/migrations/merge_migrations.py --dry-run

# 执行合并
python deploy/migrations/merge_migrations.py

# 完整稽核（需要数据库连接 + psycopg2）
python deploy/migrations/merge_migrations.py --audit-db "host=localhost port=5432 dbname=postgres user=gaussdb password=xxx"
```

### 工作原理

1. 读取 `initdb/.applied` 文件，获取已合并的版本列表
2. 扫描 `versions/` 目录，按文件名排序，跳过 baseline 和已合并的版本
3. 对每个待合并文件，按 `;` 分割 SQL 语句（正确处理引号、`$$` 块、注释中的分号）
4. 根据首个关键字分类：`CREATE/ALTER/DROP/COMMENT ON/GRANT` → DDL，`INSERT/UPDATE/DELETE` → DML
5. 追加到对应的 initdb 文件，并记录到 `.applied`

### 防重复机制

`deploy/middleware/initdb/.applied` 记录已合并的版本文件名。重复运行自动跳过。

### 稽核检查

脚本执行后自动进行以下检查：

| # | 检查项 | 是否需要数据库 |
|---|--------|---------------|
| 1 | 版本覆盖完整性（所有 versions 是否都已合并） | 否 |
| 2 | SQL 语法检查（BEGIN + ROLLBACK 模拟执行） | 是 |
| 3 | 表结构一致性（DDL 定义 vs 实际 schema） | 是 |
| 4 | 种子数据完整性（DML 涉及的表是否有数据） | 是 |

检查 2-4 需要通过 `--audit-db` 传入数据库连接串。
