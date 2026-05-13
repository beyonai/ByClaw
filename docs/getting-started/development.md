# 本地开发环境搭建

本文档指导开发者搭建完整的本地开发环境。

## 前置条件

确保已安装以下软件：

- Git
- Docker & Docker Compose V2
- Node.js >= 18.20.0（推荐通过 Volta 管理）
- pnpm 9+
- JDK 21+
- Maven 3.3.9+
- Python 3.12+、uv（可选，用于 byclaw-data / byclaw-qa 开发）

## 步骤概览

```
1. 克隆仓库 → 2. 配置环境变量 → 3. 启动中间件 → 4. 启动后端 → 5. 启动前端 → 6. 验证
```

## 详细步骤

### 1. 克隆仓库

```bash
git clone <repo-url>
cd byclaw-all
```

### 2. 配置环境变量

```bash
cp .env.example .env
```

开发环境通常使用默认配置即可，主要检查：

```bash
# 数据库（使用 Docker 部署的 PostgreSQL/OpenGauss）
DB_HOST=localhost
DB_PORT=5432
DB_DATABASE=byai
DB_SCHEMA=byai
DB_USER=gaussdb
DB_PASS=<your-password>

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# MinIO
MINIO_HOST=localhost
MINIO_API_PORT=9000
MINIO_UI_PORT=9001
```

### 3. 启动中间件

```bash
cd deploy/middleware
sh start-all.sh
```

这会启动：
- **Redis** (6379) - 缓存和会话
- **MinIO** (9009/9019) - 对象存储
- **OpenGauss/PostgreSQL** (5432) - 关系数据库
- **OpenSandbox** (9005) - 代码沙箱

验证中间件状态：

```bash
# 检查容器运行状态
docker ps

# 测试 Redis
docker exec -it redis redis-cli ping

# 测试数据库
docker exec -it opengauss gsql -d byai -U gaussdb -c "SELECT 1"
```

### 4. 启动后端服务

```bash
cd byclaw-be

# 方式一：Maven 直接运行（推荐开发）
mvn spring-boot:run

# 方式二：打包后运行
mvn -B package -DskipTests
java -jar target/ByaiServer-1.0.jar
```

后端默认启动在：
- HTTP: http://localhost:8086/byaiService
- WebSocket: ws://localhost:8082

验证后端启动：

```bash
curl http://localhost:8086/byaiService/actuator/health
```

### 5. 启动前端开发服务器

```bash
cd byclaw-fe

# 安装依赖
pnpm install

# 启动开发服务器
pnpm dev
```

前端默认启动在：http://localhost:8080（通过 Nginx 代理）

本地开发模式下 Umi dev server 运行在 8000 端口，但部署时统一使用 8080。

开发代理配置会自动将 `/byaiService` 请求转发到后端 `localhost:8086`，WebSocket 请求转发到 `localhost:8082`。

### 6. 使用统一启动脚本（可选）

```bash
# 启动所有模块
./scripts/start.sh --all

# 仅启动前端
./scripts/start.sh --fe

# 仅启动后端
./scripts/start.sh --be

# 启动 QA 服务
./scripts/start.sh --qa

# 启动数据云服务
./scripts/start.sh --data
```

日志输出到 `./logs/<module>.log`。

## 开发工作流

### 常用命令

#### 前端

```bash
cd byclaw-fe

pnpm dev          # 开发服务器
pnpm build        # 生产构建
pnpm lint         # 代码检查（ESLint + Stylelint + Prettier）
pnpm lint:fix     # 自动修复
pnpm test         # 运行测试
```

#### 后端

```bash
cd byclaw-be

mvn spring-boot:run           # 运行
mvn -B test                   # 测试
mvn -B verify                 # 完整验证
mvn -B package -DskipTests    # 打包
```

#### Python（byclaw-data）

```bash
cd byclaw-data

uv sync --frozen --dev    # 安装依赖
uv run ruff check .       # 代码检查
uv run python -m pytest   # 测试
```

### 调试配置

#### 前端调试

使用浏览器开发者工具，配合 React DevTools 扩展。

#### 后端调试

使用 IDE（如 IntelliJ IDEA）配置远程调试：

1. 以调试模式启动：
```bash
mvn spring-boot:run -Dspring-boot.run.jvmArguments="-agentlib:jdwp=transport=dt_socket,server=y,suspend=n,address=5005"
```

2. IDE 中配置 Remote JVM Debug，端口 5005

## 常见问题

### 前端热更新不生效

尝试清除缓存后重启：

```bash
cd byclaw-fe
rm -rf node_modules/.cache
pnpm dev
```

### 后端启动报错数据库连接失败

检查：
1. 数据库容器是否运行：`docker ps | grep opengauss`
2. `.env` 中的数据库配置是否正确
3. 数据库 schema 是否已初始化

### 端口冲突

修改 `.env` 中对应的端口配置：

- 后端 HTTP：`BE_SERVER_PORT`（默认 8086）
- 后端 WebSocket：`BE_WS_PORT`（默认 8082）
- 前端：修改 `byclaw-fe/.umirc.ts` 中的 port

## 下一步

- [前端开发指南](../development/frontend/)
- [后端开发指南](../development/backend/)
- [Python 开发指南](../development/python/)
- [API 文档](../api/)
