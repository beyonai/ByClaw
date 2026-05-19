# byclaw-data

`byclaw-data` 负责把已经发布到 PyPI 的 DataCloud 能力接到 ByClaw 平台，并在本仓库里补一层 byclaw 定制的 MCP 启动逻辑。

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

## 关键环境变量

建议在仓库根目录 `.env` 中配置：

```bash
DATACLOUD_DATA_SERVICE_PORT=8080
DATACLOUD_DATA_SERVICE_URL=http://127.0.0.1:8080
DATACLOUD_GATEWAY_WORKER_ID=datacloud
DATACLOUD_AI_FACTORY_URL=http://127.0.0.1:8569
DATACLOUD_AI_FACTORY_TOKEN=replace-me
DATACLOUD_AI_FACTORY_AGENT_IDS=["10000587"]
```

`start.sh` 会自动做两层归一化：

- 先把旧变量回填到 `DATACLOUD_*`：
  `DB_*` -> `DATACLOUD_DB_*`
  `REDIS_*` -> `DATACLOUD_GATEWAY_REDIS_*`
  `LLM_*` -> `DATACLOUD_LLM_*`
  `EMBEDDING_*` -> `DATACLOUD_EMBEDDING_*`
- `BE_DOMAINNAME_URL` 缺省时由 `HOST` + `BE_SERVER_PORT` 拼接
- `DATACLOUD_API_BASE_URL` 缺省时回退到 `HOST` + `DATACLOUD_DATA_SERVICE_PORT`，再回退到兼容旧变量 `DATACLOUD_PORT` 或 `DATACLOUD_DATA_SERVICE_URL`
- 结果文件存储支持两种模式：
  `DATACLOUD_RESULT_FILE_STORAGE_TYPE=local` 时写本地目录
  `DATACLOUD_RESULT_FILE_STORAGE_TYPE=api` 时通过 HTTP API 写远端文件服务
- 再从 `DATACLOUD_*` 派生运行时别名：
  `DC_LLM_*` <- `DATACLOUD_LLM_*`
  `DC_API_BASE_URL` <- `DATACLOUD_API_BASE_URL`
  `DC_ONTOLOGY_PATH` <- `DATACLOUD_ONTOLOGY_PATH`，未配置时回退到 `byclaw-data/resource/import_package_owl_onto`
  `DC_SCENE_PATH` <- `DATACLOUD_SCENE_PATH`
  `OPENAI_*` <- `DATACLOUD_LLM_REASONING_*`，再回退到 `DATACLOUD_LLM_*`

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
