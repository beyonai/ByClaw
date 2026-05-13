# 数据库迁移

本文档介绍 ByClaw 数据库迁移的管理方式。

## 迁移策略

ByClaw 使用以下策略管理数据库变更：

1. **初始化脚本** - `deploy/middleware/initdb/`
2. **Flyway/Liquibase** - 版本化迁移（可选）
3. **手动 SQL** - 开发和测试环境

## 初始化脚本

### 目录结构

```
deploy/middleware/initdb/
├── 01_init.sql               # 创建用户和数据库
├── 02_ddl.sql                # 创建表结构
├── 03_grant.sql              # 权限设置
└── 04_dml.sql                # 初始数据
```

### 脚本说明

#### 01_init.sql

创建数据库和用户：

```sql
-- 创建数据库
CREATE DATABASE byclaw;

-- 创建用户
CREATE USER byclaw_user WITH PASSWORD 'byclaw_password';

-- 授予权限
GRANT ALL PRIVILEGES ON DATABASE byclaw TO byclaw_user;
```

#### 02_ddl.sql

创建表结构：

```sql
-- 用户表
CREATE TABLE sys_user (
    id BIGSERIAL PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    password VARCHAR(100) NOT NULL,
    email VARCHAR(100),
    phone VARCHAR(20),
    status SMALLINT DEFAULT 1,
    create_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    update_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 创建索引
CREATE INDEX idx_sys_user_username ON sys_user(username);
CREATE INDEX idx_sys_user_status ON sys_user(status);
```

#### 03_grant.sql

权限配置：

```sql
-- 授予表权限
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO byclaw_user;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO byclaw_user;
```

#### 04_dml.sql

初始数据：

```sql
-- 插入管理员账号
INSERT INTO sys_user (username, password, email, status) 
VALUES ('admin', '$2a$10$...', 'admin@byclaw.com', 1);

-- 插入基础配置
INSERT INTO sys_config (config_key, config_value) 
VALUES ('system.name', 'ByClaw');
```

## 增量迁移

### 命名规范

```
V{版本号}__{描述}.sql

例如：
V1.0.1__add_user_avatar.sql
V1.0.2__add_knowledge_base.sql
V1.1.0__refactor_chat_session.sql
```

### 迁移脚本示例

```sql
-- V1.0.1__add_user_avatar.sql
ALTER TABLE sys_user ADD COLUMN avatar_url VARCHAR(500);

-- V1.0.2__add_knowledge_base.sql
CREATE TABLE knowledge_base (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    user_id BIGINT NOT NULL,
    create_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    update_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_kb_user_id ON knowledge_base(user_id);
```

## 使用 Flyway

### 添加依赖

```xml
<dependency>
    <groupId>org.flywaydb</groupId>
    <artifactId>flyway-core</artifactId>
</dependency>
```

### 配置

```yaml
# application.yml
spring:
  flyway:
    enabled: true
    locations: classpath:db/migration
    baseline-on-migrate: true
```

### 迁移目录

```
resources/
└── db/
    └── migration/
        ├── V1.0.0__init.sql
        ├── V1.0.1__add_user_avatar.sql
        └── V1.0.2__add_knowledge_base.sql
```

## 开发环境迁移

### 手动执行 SQL

```bash
# 连接数据库
docker exec -it opengauss gsql -U byclaw_user -d byclaw

# 或执行 SQL 文件
docker exec -i opengauss gsql -U byclaw_user -d byclaw < migration.sql
```

### 使用 MyBatis Plus 代码生成

```java
// 生成实体类、Mapper、Service
AutoGenerator generator = new AutoGenerator(DATA_SOURCE_CONFIG);
generator.strategyConfig(builder -> {
    builder.addInclude("new_table")
           .entityBuilder()
           .enableLombok()
           .enableTableFieldAnnotation();
});
generator.execute();
```

## 生产环境迁移

### 迁移前检查

```sql
-- 检查表是否存在
SELECT * FROM information_schema.tables 
WHERE table_name = 'sys_user';

-- 检查列是否存在
SELECT * FROM information_schema.columns 
WHERE table_name = 'sys_user' AND column_name = 'new_column';

-- 检查索引
SELECT * FROM pg_indexes 
WHERE tablename = 'sys_user';
```

### 安全迁移步骤

1. **备份数据**
   ```bash
   docker exec opengauss gs_dump -U byclaw_user -d byclaw > backup.sql
   ```

2. **测试迁移**
   ```bash
   # 在测试环境执行
   docker exec -i opengauss gsql -U byclaw_user -d byclaw_test < migration.sql
   ```

3. **执行迁移**
   ```bash
   # 维护窗口执行
   docker exec -i opengauss gsql -U byclaw_user -d byclaw < migration.sql
   ```

4. **验证迁移**
   ```sql
   -- 验证表结构
   \d sys_user
   
   -- 验证数据
   SELECT COUNT(*) FROM sys_user;
   ```

## 回滚策略

### 保留回滚脚本

```sql
-- V1.0.1__add_user_avatar.sql
ALTER TABLE sys_user ADD COLUMN avatar_url VARCHAR(500);

-- U1.0.1__rollback_user_avatar.sql (回滚脚本)
ALTER TABLE sys_user DROP COLUMN IF EXISTS avatar_url;
```

### 数据备份回滚

```bash
# 如果迁移失败，恢复备份
docker exec -i opengauss gsql -U byclaw_user -d byclaw < backup.sql
```

## 最佳实践

1. **版本控制** - 所有迁移脚本纳入版本控制
2. **幂等性** - 脚本可重复执行不报错
   ```sql
   -- 好的做法
   ALTER TABLE sys_user ADD COLUMN IF NOT EXISTS avatar_url VARCHAR(500);
   
   -- 避免
   ALTER TABLE sys_user ADD COLUMN avatar_url VARCHAR(500);
   ```

3. **事务控制** - 相关变更放在一个事务
   ```sql
   BEGIN;
   -- 多个 DDL 语句
   COMMIT;
   ```

4. **测试验证** - 在测试环境验证后再上生产

5. **文档记录** - 记录每个迁移的目的和影响
