# byclaw-qa

`byclaw-qa` 是 Byclaw 的问答系统模块，负责知识库管理接口和即时问答 worker。

## 目录说明

- `pyproject.toml`: Python 项目定义与依赖
- `start.sh`: 模块统一启动入口
- `worker.py`: 即时问答 worker 启动文件，请求处理时从 Redis 的 `RESOURCE_DIG_EMPLOYEE_{agent_id}` 读取数字员工知识库配置
- `redis_agent_config.py`: Redis 数字员工配置 schema、读取与转换逻辑
- `byclaw_plugin.py`: 历史插件逻辑，保留但不再作为即时问答 worker 的启动依赖

## 启动方式

先进入模块目录：

```bash
cd byclaw-qa
```

启动知识库管理接口服务：

```bash
./start.sh api
```

`api` 模式会使用 `uvicorn` 启动 `by_qa.main:app`。

API 请求会按请求创建模型配置 provider，但默认创建的
`RedisModelConfigProvider` 会复用进程级 Redis 客户端和连接池，避免按请求建立并滞留
Redis 连接。worker 显式注入的 Redis 客户端不受该共享逻辑影响。

知识变更通过 by-qa 的统一 `KnowledgeEventPublisher` 上报到
`/byaiService/devloop/operation/saveOrUpdateObjectFiles`。当前覆盖目录创建、重命名、删除，
文件导入、更新、删除、移动，异步构建终态，以及 `entityDiscovery`、`entityEnrich` 文件终态；
语义处理的 batch 终态只记录日志。只有事件上下文同时包含 `X-User-Code` 和
`X-CHAT-SESSION-ID` 时才调用后端接口。上报前会通过
`SHARE_BFM_USER_CODE_{X-User-Code}` 查询真实用户 ID，再从
`user:{userId}:login:auth` 的 `Beyond-Token` 字段读取登录 token 并放入请求 header；token
不会写入事件或输出到日志。文件按知识库类型上报：`objectType` 固定为
`knowledge`，`objectCode` 使用任务所属知识库编码，`objectName` 从 ByQA 的知识库元数据读取；
`extContent.kb_resource_id` 使用原请求的 `X-BYCLAW-RESOURCE-ID`，Discovery 与 Enrich 仅保留
各自的文件状态映射。成功的 Discovery 文件事件还会读取 `event.payload.result.actions`，把
`CREATED`、`ANCHORED` 中带有效 `filePath` 的实体文件以 `待整理` 状态和源文件一起批量上报；
`DROPPED`、失败任务中的不完整 actions 以及重复路径不会上报。该列表表示本次关联到的实体
文件，不承诺这些文件一定由本次任务实际新建。

KnowledgeEntity 请求进入持久化队列时，ByClaw 适配层会把 `X-User-Code`、
`X-CHAT-SESSION-ID` 和 `X-BYCLAW-RESOURCE-ID` 写入任务与批次的服务器内部上下文；不保存
`Beyond-Token`。后台 worker 领取任务后恢复这些字段，并通过 Redis 重新解析当前登录 token，
用于 RESOURCE 空间文件读写和终态事件上报。该内部上下文不属于 ByKC 的公共请求协议。

启动即时问答 worker：

```bash
./start.sh worker
```

## 环境变量约定

`start.sh` 从仓库根目录 `.env` 读取环境变量。

其中，项目公共基础设施配置建议放在仓库根目录 `.env` 中，例如：

- 数据库连接信息：`DB_URL`、`DB_USER`、`DB_PASS`
- Redis 连接信息：`REDIS_HOST`、`REDIS_PORT`、`REDIS_USERNAME`、`REDIS_PASSWORD`、`REDIS_DATABASE`
- MinIO 连接信息：`FILE_STORAGE_MINIO_HOST`、`FILE_STORAGE_MINIO_API_PORT`、`FILE_STORAGE_MINIO_ACCESS_KEY`、`FILE_STORAGE_MINIO_SECRET_KEY`、`FILE_STORAGE_MINIO_SECURE`
- 通用模型配置：`EMBEDDING_*`、`LLM_BASE_URL`、`LLM_API_KEY`
- 门户地址：`BYCLAW_PORTAL_URL`

问答模块专属配置建议使用 `BYCLAW_QA_` 前缀放在仓库根目录 `.env` 中，例如：

- `BYCLAW_QA_CLASSIFIER_MODEL`
- `BYCLAW_QA_RETRIEVAL_MODEL`
- `BYCLAW_QA_GENERATOR_MODEL`
- `BYCLAW_QA_KB_MINIO_BUCKET`
- `BYCLAW_QA_KB_MINIO_MARKDOWN_BUCKET`
- `BYCLAW_QA_BYAI_WORKER_ID`

启动脚本会把这些公共变量和 `BYCLAW_QA_*` 变量映射成 `by-qa` 运行时实际读取的变量名。

启动 `api` 或 `worker` 前，`start.sh` 会先检查转换前的源环境变量是否齐全。两种启动模式使用同一份必填清单；检查未通过时脚本会列出缺失变量并退出，不会继续启动服务。

## 运行依赖

当前模块依赖：

- `by-qa[all]==0.2.6`
- `by-framework==0.2.2.dev11`

建议使用 `uv` 管理依赖和运行环境。

如果需要从本地 wheel 重新安装 `by-qa`，请使用 `uv pip` 指向当前项目虚拟环境：

```bash
uv pip install --python .venv/bin/python --force-reinstall "./by_qa-0.2.6-py3-none-any.whl[all]"
```

不要使用 `uv run pip install ...`。当前 `.venv` 默认不包含 `pip` 模块，`uv run pip` 可能会命中系统或 Conda 环境里的 `pip`，导致把 `by-qa` 及其依赖安装到已有 `open-webui`、`streamlit` 等工具共用的环境中，从而出现依赖冲突提示。
