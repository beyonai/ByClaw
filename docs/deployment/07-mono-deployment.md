# 单体部署 (Mono)

单体模式将所有应用模块打包在一个镜像中，是最简单的部署方式，适合快速体验和测试环境。

> **注意：** 单体模式需要先部署中间件！请确保已完成 [中间件部署](./06-middleware-deployment.md)。

## 包含的服务

| 服务 | 说明 | 默认端口 |
|------|------|---------|
| 前端 (FE) | Web 界面 | 8080 |
| 后端 (BE) | API 服务 | 8086 (HTTP) / 8082 (WebSocket) |
| QA | 问答服务 | 8090 |
| Nginx | 反向代理 | 8080 |

## 部署步骤

### 步骤 1：确保中间件已启动

在部署应用前，请先确认中间件服务正常运行：

```bash
cd deploy/middleware
docker compose ps
# 或
docker-compose ps
```

所有中间件容器应该处于 `Up` 状态。

### 步骤 2：进入单体部署目录

```bash
cd deploy/mono
```

### 步骤 3：拉取镜像

```bash
sh pull.sh
```

### 步骤 4：启动服务

```bash
sh start-all.sh
```

启动成功后，您会看到：

```
================== 部署完成 ==================
前端: http://localhost:8080
后端: http://localhost:8086
QA:   http://localhost:8000
```

### 步骤 5：验证服务状态

```bash
docker compose ps
# 或
docker-compose ps
```

## 一键启动（中间件 + 单体）

如果您想一键启动中间件和单体应用，可以使用项目根目录的脚本：

```bash
cd deploy
sh start-mono.sh
```

这个脚本会：
1. 先启动中间件
2. 再启动单体应用

## 访问服务

部署完成后，您可以通过以下地址访问：

| 服务 | 访问地址 |
|------|---------|
| 前端 | http://localhost:8080 |
| 后端 API | http://localhost:8086/byaiService |
| QA 服务 | http://localhost:8000 |

## 停止服务

```bash
cd deploy/mono
sh stop-all.sh
```

或使用一键停止脚本：

```bash
cd deploy
sh stop-mono.sh
```

## 查看日志

```bash
# 查看所有日志（V2 / V1）
cd deploy/mono
docker compose logs -f
# 或
docker-compose logs -f

# 查看最近 100 行
docker compose logs --tail=100 -f
# 或
docker-compose logs --tail=100 -f
```

由于是单体模式，所有服务的日志都聚合在一起。您可以通过日志前缀区分：

- `nginx` - Nginx 日志
- `be` - 后端服务日志
- `qa` - QA 服务日志

## 配置修改

如果需要修改配置，编辑 `.env` 文件后重启服务：

```bash
cd deploy/mono
sh stop-all.sh
sh start-all.sh
```

## 端口配置

可以通过 `.env` 文件修改默认端口：

```bash
BE_SERVER_PORT=8086
BE_WS_PORT=8082
BYCLAW_QA_PORT=8090
```

> **注意：** 前端端口 8080 目前是固定的，如需修改需要编辑 `docker-compose.yml`。

## 常见问题

### 服务无法访问

1. 检查容器状态：
```bash
docker compose ps
# 或
docker-compose ps
```

2. 查看容器日志：
```bash
docker compose logs  # 或 docker-compose logs
```

3. 确认中间件是否正常运行：
```bash
cd ../middleware
docker compose ps
```

### 容器不断重启

这通常是因为无法连接中间件。请检查：
1. 中间件是否已启动
2. `.env` 中的连接配置是否正确
3. 网络是否通畅（容器应在 `byclaw-network` 网络中）

---

**下一步：** 阅读 [验证和故障排查](./09-verification.md) 来验证您的部署是否成功。
