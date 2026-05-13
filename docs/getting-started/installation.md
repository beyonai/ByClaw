# 安装指南

本文档详细介绍 ByClaw 的安装步骤和配置说明。

## 环境要求

### 最小配置

| 资源 | 要求 |
|------|------|
| CPU | 4 核 |
| 内存 | 8 GB |
| 磁盘 | 50 GB SSD |
| 网络 | 可访问互联网 |

### 推荐配置

| 资源 | 要求 |
|------|------|
| CPU | 8 核 |
| 内存 | 16 GB |
| 磁盘 | 100 GB SSD |
| 网络 | 可访问互联网 |

## 依赖软件

### Docker 部署

- Docker >= 20.10
- Docker Compose >= 2.0

### 本地开发

| 软件 | 版本 | 用途 |
|------|------|------|
| Git | 任意 | 代码版本管理 |
| Node.js | >= 18.20.0 | 前端开发 |
| pnpm | 9+ | 前端包管理 |
| JDK | 21+ | 后端开发 |
| Maven | >= 3.3.9 | Java 构建 |
| Python | >= 3.12 | 数据云/QA 模块开发 |
| uv | 最新 | Python 包管理 |

## 安装步骤

### 1. 获取代码

```bash
git clone https://github.com/beyondAI/byclaw.git
cd byclaw
```

### 2. 环境配置

复制示例配置文件：

```bash
cp .env.example .env
```

编辑 `.env` 文件，根据你的环境修改以下关键配置：

```bash
# 数据库配置
DB_HOST=localhost
DB_PORT=5432
DB_DATABASE=byai
DB_SCHEMA=byai
DB_USER=gaussdb
DB_PASS=your_password

# Redis 配置
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# MinIO 配置
MINIO_HOST=localhost
MINIO_API_PORT=9000
MINIO_UI_PORT=9001
MINIO_ACCESS_KEY=your_access_key
MINIO_SECRET_KEY=your_secret_key
MINIO_BUCKET=byclaw
```

### 3. 部署方式选择

#### 方式一：Docker Compose（推荐）

适合快速体验或生产部署。

```bash
# 启动中间件（Redis, MinIO, OpenGauss）
cd deploy/middleware
sh start-all.sh

# 启动应用（单体模式）
cd ../mono
sh start-all.sh
```

详细说明请参考 [部署文档](../deployment/)。

#### 方式二：本地开发环境

适合开发调试。

```bash
# 1. 启动中间件
cd deploy/middleware
sh start-all.sh

# 2. 启动后端
cd ../../byclaw-be
mvn spring-boot:run

# 3. 启动前端（新终端）
cd ../byclaw-fe
pnpm install
pnpm dev
```

详细说明请参考 [开发文档](../development/)。

### 4. 验证安装

#### 检查服务状态

| 服务 | 地址 | 说明 |
|------|------|------|
| 前端 | http://localhost:8080 | Web 界面 |
| 后端 API | http://localhost:8086/byaiService | REST API |
| MinIO 控制台 | http://localhost:9001 | 对象存储管理 |

#### 健康检查

```bash
# 检查后端健康状态
curl http://localhost:8086/byaiService/actuator/health

# 预期返回
{"status":"UP"}
```

## 常见问题

### 端口冲突

如果默认端口被占用，可在 `.env` 中修改：

```bash
# 修改前端端口（需同步修改 nginx 配置）
# 修改后端端口
BE_SERVER_PORT=8086
BE_WS_PORT=8082
```

### 数据库初始化失败

检查 OpenGauss 日志：

```bash
docker logs opengauss
```

确保 `initdb/` 目录下的 SQL 文件已正确执行。

更多问题请参考 [FAQ](./faq.md)。
