# Database Migrations

手动维护的数据库版本迁移脚本，用于管理 ByClaw 的增量 schema 变更。

## 目录结构

每个版本对应 `versions/` 下的一个**子目录**，目录内 DDL / DML 已**预先拆分**为独立文件：

```
deploy/migrations/
├── README.md              # 本文件
├── merge_migrations.py    # 增量脚本合并工具
├── .applied               # 已合并版本记录（脚本维护，勿手改）
└── versions/
    ├── V0.0.1/
    │   ├── V0.0.1-alpha__baseline__ddl.sql   # 基线全量快照（DDL），合并时跳过
    │   ├── V0.0.1-alpha__baseline__dml.sql   # 基线全量快照（DML），合并时跳过
    │   ├── V0.0.1__ddl.sql                    # 该版本增量 DDL
    │   └── V0.0.1__dml.sql                    # 该版本增量 DML
    ├── V0.0.2/
    │   ├── V0.0.2__ddl.sql
    │   └── V0.0.2__dml.sql
    └── ...
```

## 命名规范

工具运行前会**强制校验**目录与文件命名（不合规直接中止，见“合并工具”一节）。

### 版本目录

```
V{major}.{minor}.{patch}[-{prerelease}]
```

- 必须以 `V` 开头，后接 `major.minor.patch` 三段数字
- 可选预发布后缀：`-alpha`、`-alpha.2`、`-beta.1`、`-rc.3` 等

合法示例：`V0.1.0`、`V0.1.0-alpha.2`、`V1.2.3-rc.1`
非法示例：`0.99`（缺 V、段数不足）、`v1.0`（段数不足）

### 目录内文件

文件名必须是 `{版本前缀}` + 以下后缀之一，且版本前缀须与所在目录一致：

| 后缀 | 用途 | 是否参与合并 |
|------|------|--------------|
| `__ddl.sql` | 该版本增量 DDL | 是 → `initdb/02_ddl.sql` |
| `__dml.sql` | 该版本增量 DML | 是 → `initdb/04_dml.sql` |
| `__baseline__ddl.sql` | 基线全量快照（DDL） | 否（跳过） |
| `__baseline__dml.sql` | 基线全量快照（DML） | 否（跳过） |

baseline 的版本前缀可带预发布段（如 `V0.0.1-alpha__baseline__ddl.sql`），只要以目录名开头即可。

## 版本执行/合并顺序

按语义化版本排序，不是简单字母序：

1. 主体 `major.minor.patch` 按**数字**比较（`V0.0.10` 在 `V0.0.2` 之后）
2. 预发布版排在同主体正式版**之前**（`V1.0.0-alpha` < `V1.0.0`）
3. 预发布之间：`alpha < beta < rc`，同类按序号数字比较（`alpha.2 < alpha.10`）

## 与 initdb 的关系

| 目录 | 用途 |
|------|------|
| `deploy/middleware/initdb/` | 全新部署的初始化脚本，OpenGauss 首次启动时自动执行 |
| `deploy/migrations/versions/` | 所有版本的增量变更记录 |

`merge_migrations.py` 把各版本的 `__ddl.sql` / `__dml.sql` 追加合并进 `initdb/02_ddl.sql` 与 `initdb/04_dml.sql`，使新部署环境包含所有历史变更。baseline 仅作快照，不参与合并。

## 编写规则

1. 使用 `IF NOT EXISTS` / `IF EXISTS` 保证幂等性
2. 开头加 `SET search_path TO byai;`
3. 每个文件应能在单事务中执行
4. 已合并的脚本不要修改，需要修正就在新版本目录里写新脚本
5. 大表 DDL 注意锁表风险，必要时使用 `CONCURRENTLY`（需在事务外执行）
6. DDL 写进 `__ddl.sql`、DML 写进 `__dml.sql`，不要混放（工具会校验，混放会中止）

## 合并工具 (merge_migrations.py)

> 用 `python3` 运行，**不要**用 `sh`（这是 Python 脚本，不是 shell 脚本）。
> 脚本基于自身位置定位路径，从任意目录运行均可。

### 用法

```bash
# 预览（不写入文件）
python3 deploy/migrations/merge_migrations.py --dry-run

# 执行合并
python3 deploy/migrations/merge_migrations.py

# 完整稽核（需要数据库连接 + psycopg2）
python3 deploy/migrations/merge_migrations.py --audit-db "host=localhost port=5432 dbname=postgres user=gaussdb password=xxx"
```

### 工作原理

1. **STEP 0 — 布局校验**：检查 `versions/` 下目录与文件命名是否合规，任一不合规立即中止（退出码 1）
2. **STEP 0 — 内容校验**：检查 `__ddl.sql` 里是否混入 DML、`__dml.sql` 里是否混入 DDL，混放立即中止（baseline 文件不校验）
3. 读取 `.applied`，获取已合并版本
4. 扫描 `versions/` 各版本目录，按语义化版本排序，跳过 baseline 与已合并版本
5. 直接读取每个版本预拆好的 `__ddl.sql` / `__dml.sql`（不再自动拆分/分类语句）
6. 以版本标记块（`-- ========== V0.0.2 (merged at ...) ==========`）追加到对应 initdb 文件
7. 记录到 `.applied`

### 防重复机制

- `.applied` 记录已合并版本（目录名，如 `V0.0.2`）
- 即使 `.applied` 丢失，也会检查目标文件里是否已存在该版本标记块，存在则跳过并回填 `.applied`

### 稽核检查

合并后自动进行以下检查：

| # | 检查项 | 是否需要数据库 |
|---|--------|---------------|
| 1 | 版本覆盖完整性（所有 versions 是否都已合并） | 否 |
| 2 | SQL 语法检查（BEGIN + ROLLBACK 模拟执行） | 是 |
| 3 | 表结构一致性（DDL 定义 vs 实际 schema） | 是 |
| 4 | 种子数据完整性（DML 涉及的表是否有数据） | 是 |

检查 2-4 需通过 `--audit-db` 传入数据库连接串。

## FAQ

**Q: 基线脚本需要执行吗？**

不需要。`*__baseline__*.sql` 仅用于版本追踪/快照。全新部署由 `initdb/` 自动完成。

**Q: 能回滚吗？**

不支持自动回滚。如需回滚，在新版本目录里写一个撤销变更的迁移脚本。

**Q: initdb 和 baseline 内容不一致怎么办？**

以 `initdb/` 为准（它是实际执行的）。如有变更，同步更新 baseline 或写新的增量脚本。
