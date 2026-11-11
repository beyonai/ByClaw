# Deploy

部署目录，支持两种部署模式：中间件、拆分应用（standalone）。

## 目录结构

```
deploy/
├── compose-detect.sh    # Docker Compose 版本自动检测（V1/V2 兼容）
├── config/              # 共享配置（nginx.conf, application.properties, logback.xml）
│   └── nginx-standalone.conf.tpl  # 拆分模式 nginx 模板（端口从 .env 读取）
├── middleware/           # 中间件：Redis、MinIO、OpenGauss、OpenSandbox
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

### 一键部署存储模式

项目根目录的 `deploy.sh` 只区分阶段，存储方案全部写在 `.env` 中：

```bash
cd ..
cp .env.example .env

# .env
BYCLAW_DEPLOY_STORAGE=nfs

# 首次部署：拉镜像、可选初始化 NFS、启动服务
sh deploy.sh init

# 增量更新：重建服务，不重复初始化 NFS
sh deploy.sh update
```

可选存储模式写入 `.env`：

```bash
BYCLAW_DEPLOY_STORAGE=nfs        # OpenClaw /by 和 BE 文件 CRUD 都走 /mnt/byclaw-file
BYCLAW_DEPLOY_STORAGE=minio      # 兼容旧 MinIO/rclone 运行态方案
BYCLAW_DEPLOY_STORAGE=nfs-hybrid # OpenClaw /by 走 NFS，上传/下载 API 继续走 MinIO
```

`nfs` 模式会自动设置：

```bash
FILE_STORAGE_TYPE=file
BYCLAW_SANDBOX_VOLUME_BACKEND=file
BYCLAW_SANDBOX_FILE_VOLUME_ROOT=/mnt/byclaw-file
BYCLAW_SANDBOX_FILE_VOLUME_TYPE=nfs
FILE_STORAGE_MINIO_MOUNT_ENABLED=false
```

并在未显式设置 `MIDDLEWARE_MODULES` 时只启动 `redis,opengauss,opensandbox-server`，跳过 MinIO。若 NFS 模式下仍想启动 MinIO，可使用：

```bash
# .env
BYCLAW_DEPLOY_STORAGE=nfs
BYCLAW_DEPLOY_START_MINIO=true
```

若部署机可以 SSH 到 NFS Server 和 Docker/openSandbox 宿主机，可在首次部署阶段自动初始化 NFS：

```bash
# .env
BYCLAW_DEPLOY_INIT_NFS=true
BYCLAW_NFS_SERVER_HOST=10.0.0.10
BYCLAW_NFS_CLIENT_HOSTS=10.0.0.20,10.0.0.21

sh deploy.sh init
```

也可以单独执行：

```bash
sh init-nfs.sh
```

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

## 2. 拆分模式（standalone）

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

sh stop-be.sh
sh stop-fe.sh
sh stop-qa-manager.sh
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
| 前端 (fe) | `fe` | 8080 / 8443 | `NGINX_PORT` / `NGINX_HTTPS_PORT` |
| 后端 (be) | `be` | 8086 / 8082 | `BE_SERVER_PORT` / `BE_WS_PORT` |
| QA Manager | `qa-manager` | 8090 | `BYCLAW_QA_PORT` |

### Nginx 配置模板

拆分模式的 nginx 配置通过模板自动生成：
- 模板文件：`config/nginx-standalone.conf.tpl`
- 生成脚本：`standalone/gen-nginx-conf.sh`
- 输出文件：`config/nginx-standalone.conf`

`start-fe.sh` 和 `start-all.sh` 会自动调用生成脚本，从 `.env` 读取 `BE_SERVER_PORT`、`BE_WS_PORT` 和 `BYCLAW_SANDBOX_PORT` 替换模板中的占位符，并初始化开发环境 `localhost` HTTPS 证书。修改 nginx 配置只需编辑 `.tpl` 模板文件。

应用预览入口默认关闭（`/sandbox-apps/` 返回 404）。需要通过平台入口访问 coding
沙箱应用时，在部署环境配置：

```ini
NGINX_APP_PREVIEW_DOMAIN=cn-beijing.sandbox.aliyuncs.com
NGINX_APP_PREVIEW_PORT=8082
NGINX_APP_PREVIEW_DNS=
```

域名必须是受信任的云网关 DNS 后缀，不带协议、路径、凭证或变量。端口范围为
1024—65535，必须与 coding Spec 的公开端口及 `BYCLAW_APP_PORT` 一致。
DNS 可显式指定 FE 容器能访问的 IPv4 解析服务器；留空使用 Docker 的 127.0.0.11，
或 macOS Podman 网络网关（查询失败时默认 10.89.0.1）。预览 location 自带 resolver，
不依赖普通后端是否采用集群 upstream。非法参数会使生成失败，保留原配置。

云域名和端口只是平台转发目标；coding Spec 另需配置
`BYCLAW_APP_PUBLIC_BASE=https://<平台域名>/sandbox-apps`，用于命令返回浏览器地址。
配置生成、Nginx 配置校验和重载/容器更新是不同步骤，修改 `.env` 不会自动生效。
`nginx-app-preview.conf.tpl` 是可复用的规则片段；通用和环境专用主模板都通过
`{{APP_PREVIEW_BLOCK}}` 引入它。ByClaw 只维护模板，不提交生成的 `.conf`。
若通过 byclaw-middleware 部署，需使用该仓库维护的对应配置源，不能只更新本仓库。
这是匿名应用预览，同源和 Cookie 限制见 coding 的 APP_PREVIEW.md；不改变租约回收。

生成测试：`python3 -m unittest discover -s deploy/tests -p 'test_nginx_app_preview.py'`。
测试使用临时目录，不操作线上 Nginx，也不能代替真实 Nginx/云网关验收。

旧版本升级：需单独停止并删除旧 `qa-worker` 容器，或 K3s 中的旧 Worker Deployment 及专用 ConfigMap；更新部署清单不会自动删除旧实例。QA Manager 及数据卷保留。

## 部署环境检查

Shell 入口 `sh deploy.sh init` / `update` 和 `sh deploy/start-standalone.sh` 启动结束时自动检查环境，启动失败也会输出检查结果。需本机 Python 3；检查默认等待 120 秒，可通过 `DEPLOY_CHECK_TIMEOUT` 设置。单独检查：

```bash
sh deploy.sh check
sh deploy.sh check --deep
```

基础检查验证所选容器、数据库初始化查询、Redis PING、HTTP 就绪、FE 到 BE 代理和沙箱引擎中的 OpenClaw 镜像。检查默认创建 120 秒过期的临时沙箱，验证 execd/启动脚本注入并删除，不启动真实数字员工；使用 `.env` 的 `DB_HOST/DB_PORT/DB_DATABASE/DB_SCHEMA/DB_USER/DB_PASS` 直接读取 OpenGauss 中启用的默认 LLM 和所有启用的 `EMBEDDING` 类型模型（Embedding 不要求默认标签），并解密 Token（不依赖 BE、QA 或 Redis），从执行检查的本机对每个选中模型发起一次请求（LLM 最多 128 输出 token），可能产生少量费用。`--deep` 仅为兼容旧命令，与普通检查行为相同。

检查在启动流程结束后执行，检查失败或 Python 报错不会停止或回滚已启动容器，但启动脚本返回非零退出码。失败返回非零；“未验证”不会被当作业务成功。QA 容器具备 Python/psycopg/redis 时，还会从应用网络检查数据库必要字段、Redis 认证，并核对数据库 OpenClaw 镜像规格。该探测不支持 Redis Cluster；缺少运行环境时显示“未验证”。模型检查支持 OpenAI 兼容接口，验证实际回答及向量维度。检查不会打印 Token 或原始日志，不自动拉镜像、改模型或重启服务。此入口面向本机 Docker/Podman，PowerShell、K3s 和远程引擎暂未接入。
