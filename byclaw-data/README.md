# byclaw-data

`byclaw-data` 负责把已经发布到 PyPI 的 DataCloud 能力接到 `byclaw-all`，并在本仓库里补一层 byclaw 定制的 MCP 启动逻辑。

当前涉及的四个核心模块是：

- `datacloud_analysis`
- `datacloud_data_sdk`
- `datacloud_data_service`
- `datacloud_knowledge`

- 启动 `byclaw_data.mcp`，运行时优先加载兄弟仓库 `by-datacloud/packages/*/src` 中的 `datacloud_data_service` / `datacloud_data_sdk`，提供 `/api/v1/mcp` 和 REST 查询接口
- 启动 `byclaw_data.main`，作为 by-framework Gateway worker

## 安装

在 `byclaw-data/` 目录执行：

```bash
uv sync
```

这会直接从 PyPI 安装 `by-datacloud` 总包。

对应关系：

- `by-datacloud` -> `datacloud_analysis`
- `by-datacloud` -> `datacloud_data_sdk`
- `by-datacloud` -> `datacloud_data_service`
- `by-datacloud` -> `datacloud_knowledge`

## 环境配置

按启动方式选择对应的样例文件生成本地配置：

```bash
# 通过 ./scripts/start-data.sh 或 byclaw-data/start.sh 启动
cp byclaw-data/.env.start.sh.example byclaw-data/.env

# 不通过 start.sh，直接执行 uv run byclaw-data-mcp / uv run byclaw-data-worker
cp byclaw-data/.env.example byclaw-data/.env
```

两个样例文件里已经按章节写好了变量说明。一般只需要按样例文件注释修改这几类配置：

- 数据库配置
- Gateway / Worker / Redis 配置
- 模型配置
- 资源路径配置

其他 Agent、Data Service、日志等配置通常保持默认即可。

### 通过 start.sh 启动

使用 `byclaw-data/.env.start.sh.example`。这个样例使用 `DB_*`、`REDIS_*`、`FILE_STORAGE_MINIO_*` 等变量名，`start.sh` 会自动转换为运行时需要的 `DATACLOUD_*` / `DC_*` / `OPENAI_*` 变量。

`start.sh` 启动时会先读取仓库根目录 `.env`，再读取 `byclaw-data/.env`，后读取的值会覆盖先读取的值。因此既可以在根目录统一管理公共配置，也可以在 `byclaw-data/.env` 里覆盖本模块配置。

### 不通过 start.sh 启动

使用 `byclaw-data/.env.example`。这个样例使用运行时直接读取的 `DATACLOUD_*` 变量名，适合直接执行 `uv run byclaw-data-mcp`、`uv run byclaw-data-worker`，或在 IDE / 容器 / 进程管理器里显式注入环境变量。

直接启动时不要只配置 `DB_*`、`REDIS_*`、`LLM_*`、`EMBEDDING_*` 这些脚本兼容变量；请按 `byclaw-data/.env.example` 中的 `DATACLOUD_*` 变量修改。

## 本地启动

在仓库根目录执行：

```bash
./scripts/start-data.sh
```

等价于：

```bash
cd byclaw-data
bash start.sh
```

常用模式：

```bash
./scripts/start-data.sh --service-only
./scripts/start-data.sh --worker-only
```

也可以直接只起 MCP 服务：

```bash
cd byclaw-data
uv run byclaw-data-mcp
```

VS Code / Cursor 里可以直接使用调试配置：

- monorepo 工作区：`DataCloud MCP (byclaw-data)`
- 仅打开 `byclaw-data/`：`DataCloud MCP (byclaw-data)`

`byclaw_data.mcp` 会优先查找兄弟目录里的 `by-datacloud` 仓库；找不到时会报清晰错误，提示配置 `BY_DATACLOUD_REPO_DIR`。
其中结果文件存储会在 loader 初始化时绑定 `byclaw-data` 自己的 `ByclawResultFileStorage` 子类：
优先走 `DATACLOUD_RESULT_FILE_API_BASE_URL`
未配置时回退到 `BE_DOMAINNAME` / `DATACLOUD_RESULT_FILE_SERVICE_NAME` 通过 discovery 调后端。

## Docker

`byclaw-data/Dockerfile` 会优先安装 `byclaw-data/packages/by_datacloud-*.whl`。
如果本地 wheel 不存在，则回退为从 PyPI 安装 `by-datacloud`。

镜像启动示例：

```bash
docker build -f byclaw-data/Dockerfile -t byclaw-data:local .
docker run --rm \
  --env-file byclaw-data/.env \
  -p 8087:8080 \
  -v "$(pwd)/byclaw-data/resource:/workspace/byclaw-data/resource" \
  -v "$(pwd)/byclaw-data/logs:/workspace/byclaw-data/logs" \
  byclaw-data:local
```

默认会读取 `--env-file` 注入的配置，并在容器内同时拉起：

- `byclaw_data.mcp`
- `byclaw_data.main`
