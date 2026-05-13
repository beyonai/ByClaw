# 拆分部署 (Standalone)

拆分模式将每个模块独立部署，适合生产环境，支持独立扩缩容和故障隔离。

> **注意：** 拆分模式需要先部署中间件！请确保已完成 [中间件部署](./06-middleware-deployment.md)。

## 包含的服务

| 服务 | 说明 | 默认端口 |
|------|------|---------|
| FE | 前端服务 | 8080 |
| BE | 后端服务 | 8086 (HTTP) / 8082 (WebSocket) |
| QA Manager | QA 管理服务 | 8090 |
| QA Worker | QA 工作进程 | 无端口 |
| Data | DataCloud 服务 | 8087 |

## 部署步骤

### 步骤 1：确保中间件已启动

在部署应用前，请先确认中间件服务正常运行：

```bash
cd deploy/middleware
# Docker Compose V2
docker compose ps
# Docker Compose V1
docker-compose ps
```

所有中间件容器应该处于 `Up` 状态。

### 步骤 2：进入拆分部署目录

```bash
cd deploy/standalone
```

### 步骤 3：拉取镜像

```bash
sh pull.sh
```

这个脚本会拉取以下镜像：
- `byclaw-fe`
- `byclaw-be`
- `byclaw-qa`
- `byclaw-data`

### 步骤 4：启动所有服务

```bash
sh start-all.sh
```

该脚本会：
- 自动检测 Docker Compose 版本（V1/V2 兼容）
- 从 `.env` 读取端口配置，自动生成 nginx 配置
- 启动所有服务容器（或 `STANDALONE_MODULES` 指定的服务）

启动成功后，您会看到：

```
================== 部署完成 ==================
前端: http://localhost:8080
后端: http://localhost:8086
QA:   http://localhost:8000
Data: http://localhost:8087
```

### 步骤 5：验证服务状态

```bash
docker compose ps
# 或
docker-compose ps
```

您应该看到 5 个容器都处于 `Up` 状态。

## 一键启动（中间件 + 拆分模式）

如果您想一键启动中间件和拆分模式应用，可以使用项目根目录的脚本：

```bash
cd deploy
sh start-standalone.sh
```

这个脚本会：
1. 先启动中间件
2. 再启动拆分模式应用

## 按需启动服务

如果不需要全部服务，可以在 `.env` 中配置 `STANDALONE_MODULES`：

```bash
# 只启动前端和后端
STANDALONE_MODULES=fe,be

# 不设置或留空 = 启动全部
# STANDALONE_MODULES=
```

可用的服务名：`fe`、`be`、`qa-manager`、`qa-worker`、`data`

## Nginx 配置模板

拆分模式的 nginx 配置通过模板自动生成，端口从 `.env` 读取：

- 模板文件：`deploy/config/nginx-standalone.conf.tpl`（使用 `{{BE_SERVER_PORT}}` 和 `{{BE_WS_PORT}}` 占位符）
- 生成脚本：`deploy/standalone/gen-nginx-conf.sh`
- 输出文件：`deploy/config/nginx-standalone.conf`（挂载进 fe 容器）

`start-fe.sh` 和 `start-all.sh` 启动前会自动调用生成脚本。如需修改 nginx 配置，只需编辑 `.tpl` 模板文件。

## 单独启停服务

拆分模式的优势之一就是可以单独启停某个服务：

```bash
# 启动单个服务
sh start-fe.sh
sh start-be.sh
sh start-qa-manager.sh
sh start-qa-worker.sh
sh start-data.sh

# 停止单个服务
sh stop-fe.sh
sh stop-be.sh
sh stop-qa-manager.sh
sh stop-qa-worker.sh
sh stop-data.sh

# 停止所有服务
sh stop-all.sh
```

## 访问服务

部署完成后，您可以通过以下地址访问：

| 服务 | 访问地址 |
|------|---------|
| 前端 | http://localhost:8080 |
| 后端 API | http://localhost:8086/byaiService |
| QA Manager | http://localhost:8000 |
| DataCloud | http://localhost:8087 |

## 查看日志

由于每个模块独立部署，您可以单独查看每个服务的日志：

```bash
cd deploy/standalone

# 查看前端日志（V2 / V1）
docker compose logs -f fe
# 或
docker-compose logs -f fe

# 查看后端日志
docker compose logs -f be

# 查看 QA Manager 日志
docker compose logs -f qa-manager

# 查看 QA Worker 日志
docker compose logs -f qa-worker

# 查看 Data 日志
docker compose logs -f data

# 查看所有日志
docker compose logs -f
```

## 停止服务

```bash
cd deploy/standalone
sh stop-all.sh
```

或使用一键停止脚本：

```bash
cd deploy
sh stop-standalone.sh
```

## 扩缩容

拆分模式支持独立扩缩容某个服务。例如，如果需要多个 QA Worker：

```bash
cd deploy/standalone
docker compose up -d --scale qa-worker=3
# 或
docker-compose up -d --scale qa-worker=3
```

## 端口配置

可以通过 `.env` 文件修改默认端口：

```bash
BE_SERVER_PORT=8086
BE_WS_PORT=8082
BYCLAW_QA_PORT=8090
DATACLOUD_PORT=8087
```

## 服务依赖关系

```
前端 (FE)
  │
  ├──> 后端 (BE)
  │       │
  │       ├──> Redis
  │       ├──> OpenGauss
  │       └──> MinIO
  │
  ├──> QA Manager
  │       │
  │       ├──> Redis
  │       ├──> OpenGauss
  │       └──> MinIO
  │
  └──> DataCloud
          │
          ├──> Redis
          ├──> OpenGauss
          └──> MinIO

QA Worker (后台处理，无端口)
  │
  ├──> Redis
  ├──> OpenGauss
  └──> MinIO
```

## 常见问题

### 某个服务无法启动

1. 检查该服务的日志：
```bash
docker compose logs <service-name>
```

2. 确认中间件是否正常运行

3. 检查 `.env` 配置是否正确

### QA Worker 没有端口

QA Worker 是后台工作进程，不需要对外暴露端口，它通过 Redis 与 QA Manager 通信。

### 更新单个服务

如果只需要更新某个服务的镜像：

```bash
cd deploy/standalone

# 停止并删除旧容器
sh stop-xxx.sh

# 拉取新镜像
docker pull ghcr.io/beyonclaw/byclaw-all/byclaw-xxx:main

# 重新启动
sh start-xxx.sh
```

---

**下一步：** 阅读 [验证和故障排查](./09-verification.md) 来验证您的部署是否成功。
