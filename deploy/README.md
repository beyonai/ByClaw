# Deploy

部署目录，支持三种部署模式：中间件、单体应用（mono）、拆分应用（standalone）。

## 目录结构

```
deploy/
├── compose-detect.sh    # Docker Compose 版本自动检测（V1/V2 兼容）
├── config/              # 共享配置（nginx.conf, application.properties, logback.xml）
│   ├── nginx-mono.conf            # 单体模式 nginx 配置（端口固定）
│   └── nginx-standalone.conf.tpl  # 拆分模式 nginx 模板（端口从 .env 读取）
├── middleware/           # 中间件：Redis、MinIO、OpenGauss、OpenSandbox
├── mono/                # 单体模式：一个镜像包含 fe + be + qa + data
└── standalone/          # 拆分模式：fe、be、qa、data 各自独立镜像
```

## 前置条件

1. 安装 Docker 和 Docker Compose（V1 `docker-compose` 或 V2 `docker compose` 均可）
2. 配置项目根目录的 `.env` 文件（参考 `.env.example`）
3. 登录 GHCR 镜像仓库

## Docker Compose 兼容性

所有脚本通过 `compose-detect.sh` 自动检测 Docker Compose 版本：
- 优先使用 `docker compose`（V2 插件）
- 回退到 `docker-compose`（V1 独立安装）
- 两者都不存在时报错退出

## 1. 中间件部署

```bash
cd middleware

# 拉取镜像
sh pull.sh

# 启动全部中间件
sh start-all.sh

# 或单独启动
sh start-redis.sh
sh start-minio.sh
sh start-opengauss.sh
sh start-opensandbox.sh
```

### 按需启动中间件

在 `.env` 中设置 `MIDDLEWARE_MODULES` 可以只启动指定的中间件：

```bash
# 只启动 opensandbox（不启动 redis/opengauss/minio）
MIDDLEWARE_MODULES=opensandbox-server

# 多个用逗号分隔
MIDDLEWARE_MODULES=redis,opensandbox-server

# 不设置或留空 = 启动全部
# MIDDLEWARE_MODULES=
```

| 服务 | 服务名 | 默认端口 | 环境变量 |
|------|--------|---------|---------|
| Redis | `redis` | 6379 | `REDIS_PORT` |
| MinIO | `minio` | 9000 / 9001 | `FILE_STORAGE_MINIO_API_PORT` / `FILE_STORAGE_MINIO_UI_PORT` |
| OpenGauss | `opengauss` | 5432 | `DB_PORT` |
| OpenSandbox | `opensandbox-server` | 9005 | `BYCLAW_SANDBOX_PORT` |

OpenGauss 首次启动时会自动执行 `initdb/` 下的初始化脚本（建 schema、建表、授权），仅在数据目录为空时执行一次。

## 2. 单体模式（mono）

所有应用模块打包在一个镜像中，通过 supervisord 管理进程。

```bash
cd mono

# 拉取镜像
sh pull.sh

# 启动
sh start-all.sh

# 停止
sh stop-all.sh
```

| 服务 | 默认端口 | 环境变量 |
|------|---------|---------|
| 前端 | 8080 | `NGINX_PORT` |
| 后端 | 8086 / 8082 | `BE_SERVER_PORT` / `BE_WS_PORT` |
| QA | 8090 | `BYCLAW_QA_PORT` |

## 3. 拆分模式（standalone）

每个模块独立镜像，可单独启停。

```bash
cd standalone

# 拉取镜像
sh pull.sh

# 启动全部
sh start-all.sh

# 或单独启停
sh start-be.sh              # 后端
sh start-fe.sh              # 前端（会自动从模板生成 nginx 配置）
sh start-qa-manager.sh      # QA Manager
sh start-qa-worker.sh       # QA Worker（后台进程，无端口）
sh start-data.sh            # DataCloud

sh stop-be.sh
sh stop-fe.sh
sh stop-qa-manager.sh
sh stop-qa-worker.sh
sh stop-data.sh
```

### 按需启动服务

在 `.env` 中设置 `STANDALONE_MODULES` 可以只启动指定的服务：

```bash
# 只启动前端和后端
STANDALONE_MODULES=fe,be

# 不设置或留空 = 启动全部
# STANDALONE_MODULES=
```

| 服务 | 服务名 | 默认端口 | 环境变量 |
|------|--------|---------|---------|
| 前端 (fe) | `fe` | 8080 | `NGINX_PORT` |
| 后端 (be) | `be` | 8086 / 8082 | `BE_SERVER_PORT` / `BE_WS_PORT` |
| QA Manager | `qa-manager` | 8090 | `BYCLAW_QA_PORT` |
| QA Worker | `qa-worker` | 无（后台进程） | - |
| DataCloud | `data` | 8087 | `DATACLOUD_PORT` |

### Nginx 配置模板

拆分模式的 nginx 配置通过模板自动生成：
- 模板文件：`config/nginx-standalone.conf.tpl`
- 生成脚本：`standalone/gen-nginx-conf.sh`
- 输出文件：`config/nginx-standalone.conf`

`start-fe.sh` 和 `start-all.sh` 会自动调用生成脚本，从 `.env` 读取 `BE_SERVER_PORT` 和 `BE_WS_PORT` 替换模板中的占位符。修改 nginx 配置只需编辑 `.tpl` 模板文件。
