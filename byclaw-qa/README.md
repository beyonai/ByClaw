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

- `by-qa[all]==0.1.4`
- `by-framework==0.1.8`

建议使用 `uv` 管理依赖和运行环境。

如果需要从本地 wheel 重新安装 `by-qa`，请使用 `uv pip` 指向当前项目虚拟环境：

```bash
uv pip install --python .venv/bin/python --force-reinstall "../by_qa-0.1.4-py3-none-any.whl[all]"
```

不要使用 `uv run pip install ...`。当前 `.venv` 默认不包含 `pip` 模块，`uv run pip` 可能会命中系统或 Conda 环境里的 `pip`，导致把 `by-qa` 及其依赖安装到已有 `open-webui`、`streamlit` 等工具共用的环境中，从而出现依赖冲突提示。
