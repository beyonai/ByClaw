# 快速开始

本页用于让 ByClaw 尽快跑起来。ByClaw 当前由前端、后端、QA、DataCloud 以及中间件组成；中间件包括 Redis、MinIO、OpenGauss 和 OpenSandbox。

如果只想体验系统，优先使用 Docker 拆分部署；如果要调试代码，使用本地开发启动。

## 1. 环境要求

| 工具 | 版本要求 | 用途 | 验证命令 |
| --- | --- | --- | --- |
| Docker | 20.10+ | 运行中间件和容器化应用 | `docker --version` |
| Docker Compose V2 | 推荐 V2 | 编排服务 | `docker compose version` |
| Node.js | >= 18.20.0 | 前端本地开发 | `node --version` |
| pnpm | >= 9.x | 前端包管理 | `pnpm --version` |
| JDK | 21 | 后端本地开发 | `java -version` |
| Maven | >= 3.8 | 后端构建与启动 | `mvn --version` |
| Python | >= 3.12 | QA/Data 本地开发 | `python3 --version` |
| uv | 最新可用版本 | Python 依赖与运行 | `uv --version` |

> Docker 启动只强依赖 Docker/Compose；本地开发才需要 Node.js、pnpm、JDK、Maven、Python 和 uv。

## 2. 获取代码

```bash
git clone https://github.com/beyonai/ByClaw.git
cd ByClaw
```

如果使用内部代码仓库，请替换为实际仓库地址。

## 3. 配置环境变量

```bash
cp .env.example .env
```

然后编辑 `.env`。至少确认以下配置：

| 配置 | 说明 |
| --- | --- |
| `HOST` | 默认 `127.0.0.1`，远程部署时改成实际主机地址 |
| `BE_SERVER_PORT` / `BE_WS_PORT` | 后端 HTTP 和 WebSocket 端口，默认 `8086` / `8082` |
| `BYCLAW_QA_PORT` | QA Manager 端口，示例配置默认为 `8000` |
| `DATACLOUD_PORT` | DataCloud 端口，以 `.env` 实际值为准 |
| `DB_HOST` / `DB_PORT` / `DB_USER` / `DB_PASS` | OpenGauss 连接配置 |
| `REDIS_HOST` / `REDIS_PORT` / `REDIS_PASSWORD` | Redis 连接配置 |
| `FILE_STORAGE_MINIO_*` | MinIO API、Console、账号、桶和挂载配置 |
| `IMAGE_*` | 中间件和应用镜像地址 |

注意事项：

- 仓库示例配置中数据库协议变量可能写作 `postgresql`，实际中间件服务是 OpenGauss，端口仍使用 `DB_PORT`。
- 如果中间件不是部署在本机，需要把 `.env` 中的 `127.0.0.1` 改成实际中间件地址。
- 不要把真实密码、API Key、Token 提交到 Git。

## 4. Docker 拆分部署

适合快速体验、演示或接近生产的本机部署。

### 4.1 一键启动中间件和应用

```bash
cd deploy
sh start-standalone.sh
```

脚本会先启动 `deploy/middleware`，再启动 `deploy/standalone`。

启动完成后，访问：

```text
http://localhost:${NGINX_PORT:-8080}
```

常见默认地址为：

```text
http://localhost:8080
```

### 4.2 分步启动

如果想分开控制中间件和应用：

```bash
# 1. 拉取并启动中间件
cd deploy/middleware
sh pull.sh
sh start-all.sh

# 2. 拉取并启动应用
cd ../standalone
sh pull.sh
sh start-all.sh
```

### 4.3 按需启动服务

可在 `.env` 中配置要启动的服务。

中间件：

```bash
# 不设置或留空：启动全部中间件
MIDDLEWARE_MODULES=

# 只启动 Redis 和 OpenSandbox
MIDDLEWARE_MODULES=redis,opensandbox-server

# 跳过所有中间件
MIDDLEWARE_MODULES=NONE
```

应用：

```bash
# 不设置或留空：启动全部应用服务
STANDALONE_MODULES=

# 只启动前端和后端
STANDALONE_MODULES=fe,be

# 跳过所有应用服务
STANDALONE_MODULES=NONE
```

## 5. 本地开发启动

适合调试源码。推荐先启动中间件，再用仓库统一脚本启动各模块。

### 5.1 启动中间件

```bash
cd deploy/middleware
sh start-all.sh
cd ../..
```

### 5.2 使用统一脚本启动

```bash
# 启动全部本地模块：fe、be、qa-api、qa-worker、data
./scripts/start.sh --all

# 常用组合：只启动前后端
./scripts/start.sh --fe --be

# 单独启动
./scripts/start.sh --fe
./scripts/start.sh --be
./scripts/start.sh --qa
./scripts/start.sh --data
```

`scripts/start.sh` 会先执行环境预检：

- 检查 `.env`
- 检查 Node.js、pnpm、JDK、Maven、Python、uv
- 前端缺少依赖时自动尝试 `pnpm install`
- 日志输出到 `logs/`

如需临时跳过预检：

```bash
./scripts/start.sh --all --skip-checks
```

停止本地模块：

```bash
./scripts/stop.sh
./scripts/stop.sh --fe
./scripts/stop.sh --be --qa
```

### 5.3 手动启动各模块

统一脚本不可用时，可手动启动：

```bash
# 前端，本地开发端口通常为 8000
cd byclaw-fe
pnpm install
pnpm run dev

# 后端，HTTP 端口默认 8086，WebSocket 端口默认 8082
cd byclaw-be
mvn -B -f pom.xml spring-boot:run \
  -Dspring-boot.run.arguments="config/application --spring.profiles.active=local --logging.config=config/logback.xml" \
  -Dspring-boot.run.jvmArguments="-Denv.file=../.env"

# QA
cd byclaw-qa
./start.sh api
./start.sh worker

# DataCloud
cd byclaw-data
./start.sh
```

## 6. 默认端口

| 服务 | 默认端口 | 访问方式 |
| --- | ---: | --- |
| 前端开发服务 | 8000 | `http://localhost:8000` |
| 前端容器/Nginx | 8080 | `http://localhost:8080` |
| 后端 HTTP | 8086 | `http://localhost:8086/byaiService` |
| 后端 WebSocket | 8082 | `ws://localhost:8082` |
| QA Manager | 以 `.env` 的 `BYCLAW_QA_PORT` 为准，常见为 8000 | `http://localhost:${BYCLAW_QA_PORT}` |
| DataCloud | 以 `.env` 的 `DATACLOUD_PORT` 为准 | `http://localhost:${DATACLOUD_PORT}` |
| Redis | 6379 | 内部服务连接 |
| MinIO API | 以 `FILE_STORAGE_MINIO_API_PORT` 为准 | 内部服务连接 |
| MinIO Console | 以 `FILE_STORAGE_MINIO_UI_PORT` 为准 | `http://localhost:${FILE_STORAGE_MINIO_UI_PORT}` |
| OpenGauss | 5432 | 内部服务连接 |
| OpenSandbox | 9005 | 内部服务连接 |

> 如果端口与本机已有服务冲突，优先在 `.env` 中调整端口，再重启相关服务。

## 7. 验证启动结果

### Docker 部署验证

```bash
cd deploy/middleware
docker compose ps

cd ../standalone
docker compose ps
```

前端访问：

```bash
open http://localhost:8080
```

后端健康检查：

```bash
curl http://localhost:8086/byaiService/actuator/health
```

### 本地开发验证

```bash
# 查看日志
tail -f logs/fe.log
tail -f logs/be.log
tail -f logs/qa-api.log
tail -f logs/qa-worker.log
tail -f logs/data.log

# 前端开发地址
open http://localhost:8000
```

如果实际日志文件名与上面不同，以 `scripts/start.sh` 输出的 `[log]` 路径为准。

## 8. 常见问题

### 8.1 Docker 没有工作

确认 Docker daemon 已启动：

```bash
docker info
docker compose version
```

项目脚本会自动识别 `docker compose`、`podman compose`、`docker-compose` 或 `podman-compose`。

### 8.2 镜像拉取失败

先检查网络和镜像仓库访问：

```bash
docker pull ghcr.io/beyonai/byclaw/byclaw-fe:main
```

如果无法访问 GHCR 或阿里云镜像仓库，需要配置代理、镜像加速或改用内网镜像地址，并更新 `.env` 中的 `IMAGE_*`。

### 8.3 前端能打开，但接口失败

优先检查：

- 后端是否在 `BE_SERVER_PORT` 启动
- `.env` 中 `HOST`、`BE_SERVER_PORT`、`BE_WS_PORT` 是否正确
- 前端代理是否指向正确后端
- 浏览器控制台和 `logs/fe*.log`

### 8.4 登录失败

优先检查：

- 后端日志是否有数据库或 Redis 连接错误
- OpenGauss 初始化脚本是否执行完成
- `.env` 中 `DB_*`、`REDIS_*` 是否与中间件一致
- 当前账号是否存在且状态正常

### 8.5 知识库或文件上传失败

优先检查：

- MinIO 是否启动
- `FILE_STORAGE_MINIO_*` 是否正确
- `BYCLAW_QA_*` 配置是否完整
- QA API 和 QA Worker 是否都已启动

## 9. 功能操作入口

系统启动并完成登录后，建议按实际菜单进入对应操作文档。完整说明见 [ByClaw 操作手册](../guide/operation-manual.md)。

### 9.1 用户指南

| 系统菜单 | 主要功能 | 操作说明 |
| --- | --- | --- |
| 会话 | 与超级助手对话、上传文件、选择数字员工、查看历史会话 | [智能对话](../guide/operation-manual.md#2-智能对话) |
| 员工 | 查看个人助理、数字员工，创建个人助理，发起员工对话 | [数字员工与个人助理](../guide/operation-manual.md#3-数字员工与个人助理) |
| 知识 | 创建、导入、检索和授权个人知识/企业知识 | [知识中心](../guide/operation-manual.md#4-知识中心) |
| 工具 | 查看、导入、授权 MCP 或工具集资源 | [工具中心](../guide/operation-manual.md#5-工具中心) |
| 视图 | 查看、导入、授权个人视图/企业视图 | [视图中心](../guide/operation-manual.md#6-视图中心) |
| 对象 | 查看、导入、维护业务对象和数据语义资产 | [对象中心](../guide/operation-manual.md#7-对象中心) |
| 搜索问询/问数 | 使用问数型数字员工基于视图、对象和工具查询业务数据 | [搜索问询与问数](../guide/operation-manual.md#8-搜索问询与问数) |
| 助手设置 | 查看超级助手记忆、数字员工记忆和常用数字员工 | [助手记忆与个人设置](../guide/operation-manual.md#9-助手记忆与个人设置) |
| 设置 | 修改语言、查看协议、修改密码、退出登录 | [个人设置](../guide/operation-manual.md#个人设置) |
| 管理访问令牌 | 生成、搜索和吊销 API 访问令牌 | [访问令牌与开放接口](../guide/operation-manual.md#10-访问令牌与开放接口) |

### 9.2 管理员指南

| 管理后台菜单 | 主要功能 | 操作说明 |
| --- | --- | --- |
| 组织结构管理 | 维护组织树、部门、组织成员和组织关联资产 | [组织结构管理](../guide/operation-manual.md#111-组织结构管理) |
| 员工岗位管理 | 维护岗位目录、岗位说明、岗位成员和岗位关联资产 | [员工岗位管理](../guide/operation-manual.md#112-员工岗位管理) |
| 角色权限管理 | 管理平台角色、角色成员和权限范围 | [角色权限管理](../guide/operation-manual.md#113-角色权限管理) |
| 资产目录管理 | 管理组织或岗位关联的数字员工、知识、工具、视图、对象等资产 | [管理后台](../guide/operation-manual.md#11-管理后台) |
| 参数配置管理 | 维护平台运行参数和业务配置项 | [管理后台](../guide/operation-manual.md#11-管理后台) |
| 模型配置管理 | 新增模型、筛选模型、调试模型、启用或停用模型 | [模型配置管理](../guide/operation-manual.md#114-模型配置管理) |
| 沙箱配置管理 | 查看沙箱实例、过滤运行状态、刷新实例、维护沙箱策略 | [沙箱配置管理](../guide/operation-manual.md#115-沙箱配置管理) |

## 10. 下一步

- [部署文档](../deployment/)
- [操作手册](../guide/operation-manual.md)
- [API 文档](../api/)
- [架构说明](../architecture/)
