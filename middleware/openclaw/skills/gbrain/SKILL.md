---
name: gbrain
description: 使用 gbrain CLI 接管 agent 记忆管理：先查脑、写入/维护第二大脑、导入 Markdown 知识库、向量检索、图谱/时间线、embed/sync/dream/onboard。用户要求记忆、长期上下文、brain-first 查询、知识库维护、gbrain 工作流时使用；不要替代实时网页搜索或其它专用业务 skill（如 dws）。
---

# gbrain Skill（OpenClaw）

gbrain 是本 OpenClaw 镜像内置的长期记忆/第二大脑后端。使用本 skill 后，agent 必须把可沉淀的长期信息交给 gbrain 管理：回答前先查脑，产生新事实/偏好/决策/经验时写入或同步到 brain，维护任务交给 `gbrain onboard` / `dream` / `embed` 等命令。

上游说明以当前安装的 CLI 为准；需要查证时读 `gbrain --help` / `gbrain <command> --help`，不要臆造参数。

## 固定目录与环境

OpenClaw 镜像（`middleware/openclaw/Dockerfile`）在构建阶段已全局安装 Bun 与 gbrain：

- **Bun**：`/root/.bun/bin/bun`（`PATH` 已包含）
- **gbrain CLI**：`bun install -g github:garrytan/gbrain`（全局可执行，通常已在 `PATH` 中）

运行时数据与配置写入持久化 state 目录：

```bash
export OPENCLAW_STATE_DIR="${OPENCLAW_STATE_DIR:-${HOME}/.openclaw}"
export GBRAIN_HOME="${GBRAIN_HOME:-${OPENCLAW_STATE_DIR}/gbrain/data}"
mkdir -p "${GBRAIN_HOME}"
```

| 项 | 路径 / 说明 |
|----|-------------|
| CLI | `command -v gbrain`（镜像全局安装；缺失时见下方兜底） |
| 数据/配置 | `${GBRAIN_HOME}`，默认 `${OPENCLAW_STATE_DIR}/gbrain/data` |
| 沙箱 state 根 | `runtime-bootstrap.sh` 通常为 `/by/.openclaw` |
| CLI 兜底安装 | `${OPENCLAW_SKILL_GBRAIN_DIR:-/app/skills/gbrain}/install/install.sh` |

所有 `init`、配置、PGLite 数据、索引与后续维护状态都必须写入 `GBRAIN_HOME`，禁止落到默认 `~/.gbrain`。

## 每次使用前的准备流程

**每个 shell 会话只判定一次。** 已安装且已初始化时，直接进入业务命令。

```bash
export OPENCLAW_STATE_DIR="${OPENCLAW_STATE_DIR:-${HOME}/.openclaw}"
export GBRAIN_HOME="${GBRAIN_HOME:-${OPENCLAW_STATE_DIR}/gbrain/data}"
mkdir -p "${GBRAIN_HOME}"

# Step A：CLI 是否可用
GBRAIN_INSTALLED=false
if command -v gbrain >/dev/null 2>&1 && gbrain --version >/dev/null 2>&1; then
  GBRAIN_INSTALLED=true
fi

# Step B：是否已初始化（doctor 通过即视为已 init）
GBRAIN_INITIALIZED=false
if [ "${GBRAIN_INSTALLED}" = true ]; then
  if gbrain doctor --json >/dev/null 2>&1; then
    GBRAIN_INITIALIZED=true
  elif [ -s "${GBRAIN_HOME}/config.json" ]; then
    gbrain apply-migrations --yes >/dev/null 2>&1 || true
    gbrain doctor --json >/dev/null 2>&1 && GBRAIN_INITIALIZED=true
  fi
fi

# Step C：按状态分支
if [ "${GBRAIN_INITIALIZED}" = true ]; then
  echo "gbrain ready, skip install & init"
elif [ "${GBRAIN_INSTALLED}" = true ]; then
  export GBRAIN_INIT_MODE="${GBRAIN_INIT_MODE:-balanced}"
  if gbrain init --help 2>/dev/null | grep -q -- '--mode'; then
    gbrain init --mode "${GBRAIN_INIT_MODE}"
  else
    gbrain init
  fi
  gbrain config set search.mode "${GBRAIN_INIT_MODE}" >/dev/null 2>&1 || true
  gbrain apply-migrations --yes >/dev/null 2>&1 || true
  gbrain doctor --json
else
  sh "${OPENCLAW_SKILL_GBRAIN_DIR:-/app/skills/gbrain}/install/install.sh"
  export GBRAIN_INIT_MODE="${GBRAIN_INIT_MODE:-balanced}"
  if gbrain init --help 2>/dev/null | grep -q -- '--mode'; then
    gbrain init --mode "${GBRAIN_INIT_MODE}"
  else
    gbrain init
  fi
  gbrain config set search.mode "${GBRAIN_INIT_MODE}" >/dev/null 2>&1 || true
  gbrain doctor --json
fi
```

| 状态 | 做什么 | 禁止 |
|------|--------|------|
| 已安装 + 已初始化 | 直接 `query` / `get` / `list` / `import` 等 | `install.sh`、`bun install -g`、`gbrain init` |
| 已安装 + 未初始化 | 仅 `gbrain init` + `doctor` | `install.sh`、`bun install -g` |
| 未安装 | 跑 `install/install.sh` + init（仅首次） | — |

## EMBEDDING 与模型密钥

gbrain 可以在无 embedding provider 时做关键词检索，但向量检索、embed、部分 onboard/dream 能力需要模型密钥。执行需要嵌入/检索子系统的命令前：

1. 先检查当前环境是否已有 `DASHSCOPE_API_KEY`、`OPENAI_API_KEY`、`ZEROENTROPY_API_KEY`、`ANTHROPIC_API_KEY`、`GBRAIN_EMBEDDING_MODEL` 等所需变量。
2. 若缺失，且 OpenClaw 运维把模型配置放在 Redis 中，在同一 shell 会话补齐：

```bash
eval "$(python3 "${OPENCLAW_SKILL_GBRAIN_DIR:-/app/skills/gbrain}/scripts/load_embedding.py")"
```

PowerShell：

```powershell
python "$env:OPENCLAW_SKILL_GBRAIN_DIR\scripts\load_embedding.py" --export-powershell | Invoke-Expression
```

`load_embedding.py` 默认读取 Redis HASH `byai:aimodel:typelist` 的 `EMBEDDING` / `LLM` 字段，并映射为 gbrain 识别的变量。加载失败时说明原因并请用户配置密钥，禁止伪造密钥。

## init 与检索模式（仅首次或未初始化时）

Step C 已包含 init 逻辑；**已初始化会话跳过本节**。

默认 `GBRAIN_INIT_MODE=balanced`。若用户尚未明确选择检索模式，说明三档含义并确认：

- `conservative`：更省 token
- `balanced`：默认，质量与成本折中
- `tokenmax`：最大上下文，成本最高

用户选择后：

```bash
gbrain config set search.mode <conservative|balanced|tokenmax>
gbrain search modes
```

## 记忆接管规则

- 回答涉及用户、项目背景、历史决策、长期偏好时，先用 `gbrain query` / `gbrain search` / `gbrain get` 查脑。
- 值得长期保存的信息用 gbrain 写入/导入；命令不确定先 `gbrain --help`。
- 外部 Markdown 知识库：确认路径后 `gbrain import <path>`，必要时 `gbrain embed --stale`。
- 定期维护：`gbrain onboard --check --json`、`gbrain embed --stale`、`gbrain dream`、`gbrain doctor --json`。
- 不把临时推理、敏感密钥、一次性命令输出写入 gbrain，除非用户明确要求。

## 何时使用 / 不用

**使用**：长期记忆、brain-first 查询、知识库维护、导入/索引/巡检 gbrain。

**不用**：实时网页信息（用搜索工具）；已有专用 skill 的业务系统（如钉钉 `dws`）；未确认路径的大批量导入。

## 常用命令

```bash
gbrain --help
gbrain doctor --json
gbrain query "问题"
gbrain search "关键词"
gbrain get <slug>
gbrain list
gbrain import /path/to/brain
gbrain embed --stale
gbrain onboard --check --json
gbrain dream
```
