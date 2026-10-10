# ByClaw Super Docker 部署文档

本文依据当前项目的 Dockerfile、应用配置校验和 standalone Compose 编写，适用于单实例 Docker 部署。Super 使用外部 PostgreSQL/OpenGauss、Redis 和 ByClaw BE，不在本容器中运行这些依赖。

## 1. 部署前准备

- 服务器已安装 Docker 和 Docker Compose。
- 数据库、Redis、BE 已启动，容器网络能够访问这些服务。
- 数据库 Schema 已创建，数据库管理员或独立发布任务已完成与镜像版本对应的 Super 迁移。保持 `DB_MIGRATE_ON_START=false`；本文不执行数据库迁移。
- Redis 与平台及下游 Worker 使用同一套实例、数据库和协议配置。
- Redis 已同步可用模型配置；否则按第 4 节设置环境变量模型兜底。

## 2. 准备镜像

优先使用发布流程提供的版本镜像，将完整镜像名填入下一节的 `IMAGE_SUPER`。也可以在 `byclaw-super` 源码根目录构建本机架构镜像：

```bash
docker build -t byclaw-super:local .
```

部署服务器架构必须与镜像匹配。跨架构构建由发布流程指定目标平台。当前 Dockerfile 使用 Node 22.19.0、pnpm 11.3.0，多阶段构建并裁剪生产依赖，最终以 `node` 用户运行 `node dist/index.js`，容器端口为 3000。

## 3. 独立 Docker Compose 部署

新建部署目录，将 `.env` 和 `compose.yaml` 放在同一目录。以下示例部署一个 Super，依赖地址使用可从容器访问的真实地址。

### 3.1 环境变量文件 `.env`

将所有 `REPLACE_` 占位值替换后再启动。此示例保留常用选项，既包含必填项，也包含有默认值的显式配置。

```dotenv
# 镜像与宿主机暴露端口
IMAGE_SUPER=byclaw-super:local
BYCLAW_SUPER_PORT=3000

# 数据库：DB_HOST/PORT/DATABASE/SCHEMA/USER/PASS 为应用必填项
DB_TYPE=postgresql
DB_HOST=REPLACE_DATABASE_HOST
DB_PORT=5432
DB_DATABASE=REPLACE_DATABASE_NAME
DB_SCHEMA=REPLACE_SCHEMA_NAME
DB_USER=REPLACE_DATABASE_USER
DB_PASS='REPLACE_DATABASE_PASSWORD'

# 由下方 Compose 映射为应用必填的 DB_SSL
BYCLAW_SUPER_DB_SSL=false
# false 表示使用数据库游标轮询；兼容不支持 LISTEN 的 OpenGauss
BYCLAW_SUPER_DB_EVENT_LISTEN_ENABLED=false
# 下方 Compose 同样固定为 false
DB_MIGRATE_ON_START=false

# Redis 单机：以下四项必填
REDIS_MODE=standalone
REDIS_HOST=REPLACE_REDIS_HOST
REDIS_PORT=6379
REDIS_DATABASE=0
# 开启认证时填写；无认证则保持注释
# REDIS_PASSWORD='REPLACE_REDIS_PASSWORD'
# REDIS_USERNAME=REPLACE_REDIS_ACL_USER

# BE 兜底地址，由 Compose 映射为 BYCLAW_BE_BASE_URL
BYCLAW_SUPER_BE_BASE_URL=http://REPLACE_BE_HOST:8086

# 注册给调用方的 Super 地址，不带协议、端口或路径
BYCLAW_SUPER_DISCOVERY_HOST=REPLACE_SUPER_SERVER_HOST
# 经宿主机端口访问时，此值应与 BYCLAW_SUPER_PORT 一致
BYCLAW_SUPER_DISCOVERY_PORT=3000

# Worker：这三项都有默认值，可省略
BYCLAW_WORKER_ENABLED=true
BYCLAW_WORKER_AGENT_TYPE=BY_SUPER
BYCLAW_WORKER_MAX_CONCURRENCY=10

# 模型：Redis 模型配置完整可用时，以下四项均可省略
# PI_PROVIDER=volcengine-ark
# PI_MODEL=deepseek-v4-pro-260425
# ARK_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
# ARK_API_KEY='REPLACE_ARK_API_KEY'

# BE 覆盖了默认登录 JWT 公钥时才需要配置
# LOGIN_JWT_PUBLIC_KEY=REPLACE_BE_LOGIN_PUBLIC_KEY
# Redis 模型 authToken 使用自定义 SM4 密钥加密时配置
# BAIYING_AIMODEL_AUTH_TOKEN_SM4_KEY_HEX=REPLACE_SM4_KEY
```

`.env` 中 URL 直接填写原始地址，不要使用 Markdown 链接语法。密码示例使用单引号，避免 Compose 对 `$` 等内容进行变量插值；实际值含单引号时按 Compose 环境文件语法转义。不要提交填写后的 `.env`。

Redis 集群模式将单机配置替换为：

```dotenv
REDIS_MODE=cluster
REDIS_CLUSTER_NODES=REPLACE_NODE1:6379,REPLACE_NODE2:6379,REPLACE_NODE3:6379
REDIS_DATABASE=0
# REDIS_PASSWORD='REPLACE_REDIS_PASSWORD'
# REDIS_USERNAME=REPLACE_REDIS_ACL_USER
```

也可使用 `REDIS_CLUSTER_HOST` 替代 `REDIS_CLUSTER_NODES`。不要同时配置两个不同的节点列表；代码优先读取 `REDIS_CLUSTER_HOST`。

### 3.2 Compose 文件 `compose.yaml`

```yaml
services:
  super:
    image: ${IMAGE_SUPER:?请设置 IMAGE_SUPER}
    restart: unless-stopped
    ports:
      - "${BYCLAW_SUPER_PORT:-3000}:3000"
    env_file:
      - .env
    environment:
      HOST: "0.0.0.0"
      PORT: "3000"
      DB_SSL: "${BYCLAW_SUPER_DB_SSL:-false}"
      DB_EVENT_LISTEN_ENABLED: "${BYCLAW_SUPER_DB_EVENT_LISTEN_ENABLED:-false}"
      DB_MIGRATE_ON_START: "false"
      BYCLAW_BE_BASE_URL: "${BYCLAW_SUPER_BE_BASE_URL:?请设置 BE 地址}"
      # 本地缓存可从数据库重建，放在容器可写临时目录
      PI_SESSION_CACHE_DIR: "/tmp/byclaw-super-pi"
    healthcheck:
      test:
        - CMD
        - node
        - -e
        - "fetch('http://127.0.0.1:3000/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
      interval: 30s
      timeout: 10s
      retries: 5
      start_period: 30s
```

此 Compose 使用镜像默认用户，不额外覆盖 UID。业务状态和 Pi 检查点在数据库中，本地 Pi 缓存可以重建，不要求持久卷。

容器内的 `127.0.0.1` 指向 Super 容器自身。数据库、Redis、BE 在其他容器时，需要加入共同 Docker 网络并使用可解析的服务名；在其他主机时使用容器可达的 IP/DNS。服务发现地址则必须从调用方网络可达。

### 3.3 启动与验证

在部署目录执行：

```bash
chmod 600 .env
docker compose --env-file .env -f compose.yaml config --quiet
# 使用远程发布镜像时执行；使用本地构建镜像则跳过
docker compose --env-file .env -f compose.yaml pull super
docker compose --env-file .env -f compose.yaml up -d super
docker compose --env-file .env -f compose.yaml ps super
docker compose --env-file .env -f compose.yaml logs --tail 100 super
```

默认宿主机端口为 3000；修改过端口时相应替换：

```bash
curl -fsS http://127.0.0.1:3000/health
curl -fsS http://127.0.0.1:3000/ready
```

- `/health` 表示 HTTP 进程存活。
- `/ready` 聚合数据库、模型初始化、Connector 和 Worker 健康信息，未就绪返回 503。它不能替代一次真实模型请求或下游任务联调。
- `/byclawSuper/health` 和 `/byclawSuper/ready` 也可使用。

## 4. 模型配置是否必须填写

Super 默认优先读取 Redis Hash `byai:aimodel:typelist` 的 `LLM` 字段，优先使用启用的默认模型，否则使用第一个启用模型。模型地址、协议、模型标识及认证信息必须完整且可解析。

Redis 默认模型读取或解析失败时，回退到环境变量配置：

| 变量 | 默认值或要求 |
| --- | --- |
| `PI_PROVIDER` | 默认 `volcengine-ark` |
| `PI_MODEL` | 默认 `deepseek-v4-pro-260425` |
| `ARK_BASE_URL` | 默认 `https://ark.cn-beijing.volces.com/api/v3` |
| `ARK_API_KEY` | 无默认值，使用环境变量兜底时必填 |
| `OPENAI_API_KEY` | 当前 Super 配置链路不使用，不能替代 `ARK_API_KEY` |

`PI_PROVIDER` 和 `PI_MODEL` 必须一起配置或一起省略。沿用默认模型时，只补充 `ARK_API_KEY` 即可建立环境变量兜底配置；实际密钥须有目标模型访问权限。

业务指定模型实例时，从 `byai:aimodel:config` 的对应模型实例字段读取，失败不会回退到默认模型。环境变量兜底只覆盖默认模型解析失败，不是模型请求失败后的自动切换。

## 5. 接入现有 ByClaw standalone 部署

已有 `ByClaw/deploy/standalone/docker-compose.yml` 时，直接使用其中的 `super` 服务，不需要再创建第 3 节的 Compose。

把所需变量加入 **ByClaw 部署根目录 `.env`**。该服务通过 `env_file: ../../.env` 注入配置，并进行以下映射；`environment` 中的值优先于 `env_file` 同名值。

| 部署根 `.env` 参数 | Super 容器中的变量 |
| --- | --- |
| `BYCLAW_SUPER_DB_SSL` | `DB_SSL`，默认 false |
| `BYCLAW_SUPER_DB_EVENT_LISTEN_ENABLED` | `DB_EVENT_LISTEN_ENABLED`，默认 false |
| `BYCLAW_SUPER_BE_BASE_URL` | `BYCLAW_BE_BASE_URL`，默认 `http://be:8086` |
| `BYCLAW_SUPER_PORT` | 宿主机映射端口，容器仍为 3000 |
| `IMAGE_SUPER` | Super 镜像 |
| `DB_MIGRATE_ON_START` | Compose 固定为 false，外层同名变量不能覆盖 |

在 `ByClaw/deploy/standalone` 目录执行：

```bash
docker compose --env-file ../../.env config --quiet
docker compose --env-file ../../.env pull super
docker compose --env-file ../../.env up -d --no-deps --force-recreate super
docker compose --env-file ../../.env ps super
docker compose --env-file ../../.env logs --tail 100 super
```

`--no-deps` 避免单独更新 Super 时连带处理 BE，要求 BE 已运行。现有 Compose 覆盖运行用户为 `1001:1001`；出现本地缓存权限错误时，可在部署根 `.env` 添加 `PI_SESSION_CACHE_DIR=/tmp/byclaw-super-pi`，并重建 Super 容器。

## 6. Worker 与副本数

默认启动顺序：数据库启动和健康检查 → RunService 启动 → Worker 注册并等待在线 → HTTP 监听 → HTTP 服务发现注册。

- `BYCLAW_WORKER_ENABLED=true`：启动时注册，默认开启。
- `BYCLAW_WORKER_AGENT_TYPE=BY_SUPER`：声明逻辑 Agent 类型。
- `BYCLAW_WORKER_MAX_CONCURRENCY=10`：单实例 Worker 并发上限，同时用于本实例 RunService 并发控制，不是注册 10 个 Worker。
- 默认 Worker ID 为 `byclaw-super-${hostname}`；运行中不变，容器重建后 hostname 变化可能导致 ID 变化。
- 心跳默认每 5 秒一次，在线租约 15 秒；正常停止释放租约和成员关系。

`BYCLAW_SUPER_REPLICAS` 是现有 K3s 渲染脚本参数，**当前 standalone Compose 和本文独立 Compose 都不读取它**。填写 `BYCLAW_SUPER_REPLICAS=3` 不会自动运行 3 个 Docker 容器。本文示例为单实例；多实例需另行设计端口、负载均衡及唯一 Worker ID，不能复用固定 Worker ID。

## 7. 更新、停止与回滚

独立 Compose 更新：将 `.env` 的 `IMAGE_SUPER` 改为目标版本，然后执行：

```bash
docker compose --env-file .env -f compose.yaml pull super
docker compose --env-file .env -f compose.yaml up -d --no-deps --force-recreate super
docker compose --env-file .env -f compose.yaml ps super
```

更新环境变量后也要执行 `up -d --force-recreate`，单独 `restart` 不会重新注入配置。停止服务：

```bash
docker compose --env-file .env -f compose.yaml stop super
```

回滚时将 `IMAGE_SUPER` 改回已记录的上一版本，重复更新步骤并检查 `/ready`。镜像回滚不会回滚数据库；必须确认旧镜像与当前数据库 Schema 兼容。

## 8. 常见问题

| 现象 | 检查项 |
| --- | --- |
| 缺少 `DB_SSL` 或其他必填项而启动失败 | 是否使用了 Compose 映射；直接 `docker run --env-file` 需提供应用变量 `DB_SSL`，不会自动转换 `BYCLAW_SUPER_DB_SSL` |
| 数据库连接失败 | 容器内可达地址、端口、账号、SSL 设置 |
| 数据库 Schema 健康检查失败 | 发布版本要求的迁移是否已执行；不要通过临时开启自动迁移绕过发布流程 |
| OpenGauss LISTEN 报错 | 设置 `BYCLAW_SUPER_DB_EVENT_LISTEN_ENABLED=false` 后重建容器 |
| Redis 默认模型不可用且缺少 ARK 密钥 | 修复 Redis 模型配置或提供有效 `ARK_API_KEY` |
| Worker ID 冲突 | 是否多个实例配置了相同 `BYCLAW_WORKER_ID` 或 hostname |
| Beyond-Token 验签失败 | Super 公钥是否与 BE 的 `login.jwt.public-Key` 一致，Token 是否过期 |
| Super 已在线但调用方访问失败 | 检查服务发现注册地址、端口及调用方网络；Worker 在线不等于 HTTP 可达 |
| `/health` 正常但 `/ready` 返回 503 | 查看 `/ready` 响应与容器日志，定位具体依赖 |

## 9. 配置依据

- `app/config/index.ts`：必填项校验、应用变量名。
- `app/config/config-defaults.ts`：默认值。
- `app/llm-provider/redis-llm-provider.ts`：Redis 模型读取和环境变量兜底。
- `app/runtime/index.ts`：启动与关闭顺序。
- `Dockerfile`：构建、运行用户及启动命令。
- `../deploy/standalone/docker-compose.yml`：现有 standalone 变量映射。

本文仅提供部署说明；编写时未执行镜像构建、服务部署或数据库变更。
