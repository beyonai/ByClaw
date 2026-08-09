# ByClaw Super 构建与部署指导

本文总结 `byclaw-super` 接入现有 ByClaw standalone 部署体系所需的代码改动、配置项、构建发布和服务器操作。适用于当前 `ByClaw + byclaw-middleware + Docker Compose` 的部署方式。

> 约束：数据库建表/迁移由人工或独立 migration job 执行，应用启动时不自动建表。

## 1. 整体流程

```text
ByClaw/byclaw-super 源码
        ↓
byclaw-middleware/build/build-super.sh
        ↓ 构建 linux/amd64 镜像并推送
私有镜像仓库/byclaw/byclaw-super:<tag>
        ↓
服务器根目录 .env + deploy/standalone/docker-compose.yml
        ↓
byclaw-super-standalone 容器
```

Super 复用现有外部 PostgreSQL/OpenGauss、Redis 和 ByClaw BE，不在容器内启动独立数据库或 Redis。

## 2. 需要改动或新增的内容

### 2.1 `byclaw-super` 自身

| 文件 | 改动目的 |
| --- | --- |
| `Dockerfile` | 增加生产多阶段构建、国内 npm/pnpm 镜像源、生产依赖裁剪和非 root 运行 |
| `package.json` | 增加 `files: ["dist"]`，确保 `pnpm deploy` 带上入口产物；固定 `pino-pretty` 为 `13.1.3` |
| `pnpm-lock.yaml` | 与 `package.json` 中固定的 `pino-pretty` 版本保持一致 |
| `app/config/index.ts` | `DB_TYPE` 同时接受 `postgresql`、`opengauss`；Redis 集群接受 `REDIS_CLUSTER_HOST` 或 `REDIS_CLUSTER_NODES` |
| `app/server/app.ts` | 同时注册根路径和业务前缀健康检查，兼容容器探针 |
| `app/test/config.test.ts` | 增加 OpenGauss 配置解析测试 |
| `app/test/http.test.ts` | 增加根路径 `/ready` 行为测试 |
| `.env.example` | 只保留变量说明和空值示例，不提交真实账号、密码和密钥 |

生产镜像入口必须是：

```text
/app/dist/index.js
```

`package.json` 必须包含：

```json
{
  "files": ["dist"]
}
```

否则 `pnpm --filter @byclaw/byclaw-super deploy --prod --legacy /opt/byclaw-super` 不会复制根项目的 `dist/`，运行时会报：

```text
Cannot find module '/app/dist/index.js'
```

### 2.2 ByClaw standalone 部署目录

需要在 `deploy/standalone/` 中加入以下内容：

| 文件 | 改动目的 |
| --- | --- |
| `docker-compose.yml` | 新增 `super` service，配置镜像、端口、外置 env、健康检查、网络和 BE 依赖 |
| `start-super.sh` | 只重建 Super，必须使用 `--no-deps` |
| `stop-super.sh` | 停止并删除 Super 容器 |
| `start-all.sh` / `stop-all.sh` | 如需统一启停，将 Super 纳入服务清单 |
| `pull.sh` | 如需统一拉取，将 Super 镜像纳入拉取清单 |
| 根目录 `.env.example` | 增加 `IMAGE_SUPER`、`BYCLAW_SUPER_*` 示例项 |

Super Compose 的关键配置应保持如下语义：

```yaml
super:
  image: ${IMAGE_SUPER:-ghcr.io/beyonai/byclaw/byclaw-super:main}
  ports:
    - "${BYCLAW_SUPER_PORT:-3000}:3000"
  env_file:
    - ../../.env
  environment:
    - HOST=0.0.0.0
    - PORT=3000
    - DB_SSL=${BYCLAW_SUPER_DB_SSL:-false}
    - DB_EVENT_LISTEN_ENABLED=${BYCLAW_SUPER_DB_EVENT_LISTEN_ENABLED:-false}
    - DB_MIGRATE_ON_START=false
    - BYCLAW_BE_BASE_URL=${BYCLAW_SUPER_BE_BASE_URL:-http://be:8086}
  healthcheck:
    test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:3000/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
  depends_on:
    - be
```

单独启动 Super 时必须使用：

```bash
docker compose --env-file ../../.env \
  up -d --force-recreate --no-deps super
```

`--no-deps` 用于防止启动或重建 Super 时连带重建 BE。

### 2.3 `byclaw-middleware/build`

需要加入：

| 文件 | 改动目的 |
| --- | --- |
| `build/build-super.sh` | 构建 `linux/amd64` 单架构镜像并推送到配置的仓库 |
| `build/build-super-arm.sh` | 可选的 amd64/arm64 多架构构建脚本 |
| `build/build-all.sh` | 在全量构建中调用 `build-super.sh` |

构建脚本应向 Dockerfile传入：

```text
NPM_REGISTRY
NPM_REPLACE_REGISTRY_HOST
BUILD_VERSION
BUILD_BRANCH
BUILD_COMMIT
BUILD_COMMIT_FULL
BUILD_TIME
BUILD_MODULE=byclaw-super
BUILD_COMMIT_MSG
```

正式部署到 203 时应构建 `linux/amd64`。不要直接把 Apple Silicon 本机生成的 arm64 镜像作为正式服务器镜像，否则会出现平台不匹配告警，并依赖服务器 QEMU 模拟运行。

### 2.4 环境配置

不要在生产环境直接使用 `byclaw-super/.env`。应将 Super 所需变量合并到部署根目录的 `.env`，环境模板则维护在 `byclaw-middleware/envs/<环境>/.env`。

203 至少需要以下变量。真实密码和密钥不要写入本文或提交 Git：

```dotenv
# Super 镜像与端口
IMAGE_SUPER=10.10.168.203:9080/byclaw/byclaw-super:develop
BYCLAW_SUPER_PORT=8090
BYCLAW_SUPER_DB_SSL=false
BYCLAW_SUPER_DB_EVENT_LISTEN_ENABLED=false
BYCLAW_SUPER_BE_BASE_URL=http://be:8086

# PostgreSQL/OpenGauss
DB_TYPE=opengauss
DB_HOST=<database-host>
DB_PORT=5432
DB_DATABASE=<database-name>
DB_SCHEMA=<schema-name>
DB_USER=<database-user>
DB_PASS=<database-password>

# Redis Cluster
REDIS_MODE=cluster
REDIS_CLUSTER_HOST=<host1:port1,host2:port2,...>
REDIS_DATABASE=0
REDIS_USERNAME=<optional>
REDIS_PASSWORD=<optional>

# Pi/LLM
PI_PROVIDER=<provider>
PI_MODEL=<model>
ARK_BASE_URL=<optional>
ARK_API_KEY=<secret-if-required>
```

说明：

- Super 的数据库和 Redis 变量沿用部署根 `.env` 中的 `DB_*`、`REDIS_*` 命名，不再单独复制一套连接配置。
- `DB_TYPE=opengauss` 使用 PostgreSQL 协议驱动。
- OpenGauss 不支持当前事件监听方式时，设置 `BYCLAW_SUPER_DB_EVENT_LISTEN_ENABLED=false`。
- 生产固定 `DB_MIGRATE_ON_START=false`，避免应用启动时擅自修改数据库结构。

## 3. 数据库准备

### 3.1 执行原则

本部署流程不自动执行建表。首次部署或 schema 版本升级时，由数据库管理员人工执行 `packages/storage-postgres/src/migrations.ts` 中尚未应用的迁移 SQL。

表名前缀固定为：

```text
byai_super_
```

### 3.2 表用途

| 表 | 用途 |
| --- | --- |
| `byai_super_sessions` | Super 会话主体、所属用户和会话上下文 |
| `byai_super_runs` | 每次用户请求对应的执行任务、状态、结果和错误信息 |
| `byai_super_delegations` | Super 向子 Agent/Connector 发出的委派任务及结果 |
| `byai_super_run_events` | Run 的增量事件流，用于恢复、推送和审计 |
| `byai_super_pi_sessions` | Pi SDK 会话快照及版本信息 |
| `byai_super_pi_session_entries` | Pi 会话内的逐条记录和提交状态 |
| `byai_super_ingress_session_bindings` | 外部会话 ID 与 Super 内部 session ID 的映射 |
| `byai_super_session_execution_leases` | 多实例场景下的会话执行租约和 fencing token |
| `byai_super_run_execution_credentials` | Run 执行期间使用的短期凭证及过期时间 |

执行迁移前需要确认：

1. `DB_SCHEMA` 已存在且账号有建表、建索引和 ALTER 权限。
2. 已核对数据库当前迁移版本，避免重复执行 `ALTER TABLE`。
3. 先备份或在测试环境演练。
4. 完成迁移后再启动 Super。

## 4. 构建与发布

### 4.1 Dockerfile要求

Dockerfile 使用国内 npm/pnpm 镜像源：

```text
https://registry.npmmirror.com
```

pnpm 不固定版本，通过 npm 安装当前可用版本；依赖安装仍必须使用：

```bash
pnpm install --frozen-lockfile
```

因此每次修改 `package.json` 后必须同步更新 `pnpm-lock.yaml`。例如 `pino-pretty` 必须在两处都为精确版本 `13.1.3`，否则构建会报 `ERR_PNPM_OUTDATED_LOCKFILE`。

### 4.2 构建单个 Super 镜像

在 `byclaw-middleware` 的构建目录执行：

```bash
cd build
./build-super.sh --tag develop
```

脚本完成以下动作：

1. 读取私有仓库与网络镜像配置。
2. 在 `ByClaw/byclaw-super` 中构建 `linux/amd64` 镜像。
3. 生成构建元数据 `/app/build-info.json`。
4. 标记并推送 `<registry>/byclaw/byclaw-super:develop`。

### 4.3 全量构建

```bash
cd build
./build-all.sh --tag develop
```

`build-all.sh` 应依次构建 BE、Super、FE、Data 和 QA。

## 5. 部署到 203

以下示例假定部署根目录为：

```text
/data/byai/byaiAllInOne
```

### 5.1 部署前检查

```bash
cd /data/byai/byaiAllInOne

grep -E '^(IMAGE_SUPER|BYCLAW_SUPER_PORT|DB_TYPE|DB_HOST|DB_PORT|DB_DATABASE|DB_SCHEMA|REDIS_MODE|REDIS_CLUSTER_HOST|PI_PROVIDER|PI_MODEL)=' .env
```

不要输出或复制 `DB_PASS`、`REDIS_PASSWORD`、`ARK_API_KEY` 等敏感值。

### 5.2 拉取并只重建 Super

```bash
cd /data/byai/byaiAllInOne/deploy/standalone

docker compose --env-file ../../.env pull super

docker compose --env-file ../../.env \
  up -d --no-deps --force-recreate super
```

也可以使用部署脚本：

```bash
cd /data/byai/byaiAllInOne/deploy/standalone
sh start-super.sh
```

### 5.3 检查状态

```bash
docker ps -a --filter name=byclaw-super-standalone
docker logs --tail 200 byclaw-super-standalone
```

健康检查：

```bash
curl -fsS http://127.0.0.1:8090/health
curl -fsS http://127.0.0.1:8090/ready
```

业务前缀健康接口仍保留：

```text
/byclawSuper/health
/byclawSuper/ready
```

## 6. 回滚

生产发布建议同时保留不可变版本 tag 或 digest，不应只依赖会移动的 `develop` 标签。

回滚时只重建 Super：

```bash
cd /data/byai/byaiAllInOne/deploy/standalone

IMAGE_SUPER=<registry>/byclaw/byclaw-super:<previous-tag> \
docker compose --env-file ../../.env \
  up -d --no-deps --force-recreate --pull never super
```

该命令不会修改 `.env`，属于一次性回滚。需要长期保持回滚版本时，再经过审批修改 `.env` 中的 `IMAGE_SUPER`。

## 7. 常见故障

### 7.1 `ERR_PNPM_OUTDATED_LOCKFILE`

原因：`package.json` 与 `pnpm-lock.yaml` 的依赖版本不一致。

处理：在 Super 源码目录重新生成 lockfile，并确保 `pino-pretty` 两处均为精确版本 `13.1.3`。不要用 `--no-frozen-lockfile` 掩盖生产构建问题。

### 7.2 pnpm global bin directory 不在 PATH

原因：执行 `pnpm config set ... --global` 时，pnpm 全局 bin 目录未加入 PATH。

处理：镜像内使用项目级配置：

```bash
pnpm config set registry "${NPM_REGISTRY}" --location=project
```

### 7.3 `/app/dist/index.js` 不存在

原因：`pnpm deploy` 未包含根项目构建产物。

处理：确认 `package.json` 有 `files: ["dist"]`，并在 deploy 前执行完整 build。

### 7.4 `DB_TYPE must be postgresql`

原因：部署环境使用 `DB_TYPE=opengauss`，旧版 Super 只允许 `postgresql`。

处理：使用已兼容 `postgresql`、`opengauss` 的版本。

### 7.5 容器一直 `health: starting` 或 `unhealthy`

原因之一：Compose 探针访问 `/ready`，旧版 Super 只暴露 `/byclawSuper/ready`。

处理：确保当前版本同时暴露根路径 `/ready` 和带前缀路径；再根据 `/ready` 响应检查数据库、Redis、Pi 和 Worker 的具体健康项。

### 7.6 启动 Super 时 BE 被重建

原因：Compose 根据 `depends_on` 连带处理 BE。

处理：单独启动 Super 时必须加 `--no-deps`。不要对全套服务执行 `--force-recreate`。

### 7.7 BE 连接 `localhost:6379`

该问题不是 Super 引起，而是 ByClaw 镜像分支与外置部署配置分支不一致：

```text
develop 的 BE 镜像 + main 的 deploy/config/application.properties
```

旧配置缺少：

```properties
spring.redis.cluster.nodes=${REDIS_CLUSTER_HOST:}
```

且把 standalone host 默认成 `localhost`。部署脚本同步 ByClaw 配置时，应显式保证：

```bash
BYCLAW_BRANCH=develop
```

镜像分支、源码分支和 `deploy/config` 分支必须一致，不能只更新镜像而保留旧外置配置。

## 8. 发布检查清单

- [ ] `package.json` 包含 `files: ["dist"]`。
- [ ] `package.json` 与 `pnpm-lock.yaml` 完全一致。
- [ ] `pino-pretty` 固定为 `13.1.3`。
- [ ] Dockerfile 使用国内 npm/pnpm registry。
- [ ] 正式镜像平台为 `linux/amd64`。
- [ ] 镜像已推送到目标仓库并记录 tag/digest。
- [ ] 根 `.env` 已加入 Super 配置，未提交真实秘密。
- [ ] `DB_TYPE=opengauss` 或 `postgresql` 与实际数据库一致。
- [ ] Redis standalone/cluster 配置与 `REDIS_MODE` 一致。
- [ ] 数据库 schema 与迁移由人工完成。
- [ ] Compose 中存在 `super` service 和根路径 `/ready` 探针。
- [ ] 启动 Super 使用 `--no-deps`。
- [ ] ByClaw 镜像分支与 `deploy/config` 分支一致。
- [ ] `/health`、`/ready` 和容器日志检查通过。
- [ ] 已记录上一版本镜像 tag/digest，具备单服务回滚能力。
