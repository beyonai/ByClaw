# 快速开始

最快速度让项目跑起来的指南。

## 环境要求

| 工具 | 版本 | 用途 |
|------|------|------|
| Docker & Docker Compose V2 | 20.10+ | 中间件运行 |
| Node.js | >= 18.20.0 | 前端开发 |
| pnpm | 9+ | 前端包管理 |
| JDK | 21+ | 后端开发 |
| Maven | 3.3.9+ | 后端构建 |
| Python + uv | 3.12+ | 可选，Python 模块开发 |

## 一键启动（Docker 部署）

```bash
# 克隆仓库
git clone <repo-url>
cd ByClaw

# 配置环境变量
cp .env.example .env
# 编辑 .env 填入必要配置（数据库密码、GHCR 凭证等）

# 启动中间件（Redis、PostgreSQL、MinIO、OpenSandbox）
(cd deploy/middleware && sh start-all.sh)

# 启动应用
(cd deploy/standalone && docker compose up -d)
```

## 本地开发启动

```bash
# 1. 启动中间件
cd deploy/middleware && sh start-all.sh && cd ../..

# 2. 启动后端（新终端）
cd byclaw-be && mvn spring-boot:run

# 3. 启动前端（新终端）
cd byclaw-fe && pnpm install && pnpm dev
```

## 默认端口

| 服务 | 端口 | 地址 |
|------|------|------|
| 前端 | 8080 | http://localhost:8080 |
| 后端 HTTP | 8086 | http://localhost:8086/byaiService |
| 后端 WebSocket | 8082 | ws://localhost:8082 |
| PostgreSQL | 5432 | - |
| Redis | 6379 | - |
| MinIO API | 9000 | - |
| MinIO 控制台 | 9001 | http://localhost:9001 |
| OpenSandbox | 9005 | - |

## 统一启动脚本

```bash
./scripts/start.sh --all     # 启动所有模块
./scripts/start.sh --fe      # 仅前端
./scripts/start.sh --be      # 仅后端
./scripts/start.sh --qa      # QA 服务
./scripts/start.sh --data    # 数据云服务
```

日志输出到 `./logs/<module>.log`。

## 验证

```bash
# 后端健康检查
curl http://localhost:8086/byaiService/actuator/health

# 前端访问
open http://localhost:8080
```

## 下一步

- [详细开发环境搭建](../getting-started/development.md)
- [部署指南](../deployment/)
- [架构概览](../architecture/)
