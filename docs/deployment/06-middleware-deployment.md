# 中间件部署

本指南将帮助您部署 ByClaw 的中间件服务，包括 Redis、MinIO、OpenGauss 和 OpenSandbox。

## 中间件服务列表

| 服务 | 说明 | 默认端口 |
|------|------|---------|
| Redis | 缓存和会话存储 | 6379 |
| MinIO | 对象存储 | 9000 (API) / 9001 (Console) |
| OpenGauss | 关系型数据库 | 5432 |
| OpenSandbox | 代码沙箱服务 | 9005 |

## 部署步骤

### 步骤 1：进入中间件目录

```bash
cd deploy/middleware
```

### 步骤 2：拉取镜像

```bash
sh pull.sh
```

该脚本会自动：
- 从 `.env` 读取 GHCR 凭证
- 登录 GHCR
- 拉取所有中间件镜像

### 步骤 3：启动所有中间件

```bash
sh start-all.sh
```

该脚本会：
- 自动检测 Docker Compose 版本（V1/V2 兼容）
- 自动创建数据目录并设置权限
- 生成 OpenSandbox 配置
- 启动所有中间件容器（或 `MIDDLEWARE_MODULES` 指定的服务）
- 显示运行状态

### 按需启动（可选）

如果不需要全部中间件，可以在 `.env` 中配置 `MIDDLEWARE_MODULES`：

```bash
# 只启动 opensandbox
MIDDLEWARE_MODULES=opensandbox-server

# 启动 redis 和 opensandbox
MIDDLEWARE_MODULES=redis,opensandbox-server

# 不设置或留空 = 启动全部
# MIDDLEWARE_MODULES=
```

可用的服务名：`redis`、`minio`、`opengauss`、`opensandbox-server`

### 步骤 4：验证部署

```bash
# Docker Compose V2
docker compose ps

# Docker Compose V1
docker-compose ps
```

您应该看到所有容器状态为 `Up`。

## 单独启停服务

如果您只需要启动某个特定的中间件，可以使用对应的脚本：

```bash
# 只启动 Redis
sh start-redis.sh

# 只启动 MinIO
sh start-minio.sh

# 只启动 OpenGauss
sh start-opengauss.sh

# 只启动 OpenSandbox
sh start-opensandbox.sh

# 停止所有中间件
sh stop-all.sh

# 停止单个服务
sh stop-redis.sh
sh stop-minio.sh
sh stop-opengauss.sh
sh stop-opensandbox.sh
```

## 服务访问和验证

### Redis

**连接测试：**
```bash
docker exec -it byclaw-redis redis-cli -a admin123 ping
# 应该返回 PONG
```

### MinIO

**Web Console：** http://localhost:9001

- Access Key: 在 `.env` 中配置的 `FILE_STORAGE_MINIO_ACCESS_KEY`
- Secret Key: 在 `.env` 中配置的 `FILE_STORAGE_MINIO_SECRET_KEY`

登录后您可以：
- 创建和管理 Buckets
- 上传和下载文件
- 查看存储使用情况

### OpenGauss

**连接信息：**
- Host: localhost
- Port: 5432
- Database: postgres
- Schema: byai
- Username: gaussdb
- Password: 在 `.env` 中配置的 `DB_PASS`

**使用 psql 连接：**
```bash
docker exec -it byclaw-opengauss gosu omm psql -d postgres -U gaussdb
```

**初始化脚本：**
OpenGauss 首次启动时会自动执行 `initdb/` 目录下的 SQL 脚本：
- `01_init.sql` - 初始化
- `02_ddl.sql` - 表结构
- `03_grant.sql` - 权限
- `04_dml.sql` - 初始数据

### OpenSandbox

**健康检查：**
```bash
curl http://localhost:9005/health
```

## 数据持久化

所有中间件的数据都持久化在 Docker volumes 中：

| 服务 | 数据位置 |
|------|---------|
| OpenGauss | `deploy/middleware/data/` |
| MinIO | Docker volume |
| Redis | Docker volume |

> **注意：** 删除容器不会丢失数据，但删除 volumes 会。

## 常见问题

### OpenGauss 权限问题

如果看到 OpenGauss 容器启动失败，可能是数据目录权限问题：

```bash
cd deploy/middleware
sudo chown -R 70:70 data
sudo chmod -R 755 data
```

### 端口冲突

如果默认端口被占用，可以在 `.env` 中修改：

```bash
REDIS_PORT=6380
DB_PORT=5433
FILE_STORAGE_MINIO_API_PORT=9002
FILE_STORAGE_MINIO_UI_PORT=9003
BYCLAW_SANDBOX_PORT=9006
```

### 查看日志

```bash
# 查看所有服务日志（V2 / V1）
docker compose logs -f
# 或
docker-compose logs -f

# 查看特定服务日志
docker compose logs -f redis
docker compose logs -f minio
docker compose logs -f opengauss
docker compose logs -f opensandbox-server
```

---

**下一步：** 如果需要部署应用服务，请继续阅读：
- [拆分部署](./08-standalone-deployment.md)

或者查看 [验证和故障排查](./09-verification.md) 了解更多排障技巧。
