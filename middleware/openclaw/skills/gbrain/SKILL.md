---
name: gbrain
description: 使用 gbrain CLI 接管 agent 记忆管理：先查脑、写入/维护第二大脑、导入 Markdown 知识库、向量检索、图谱/时间线、embed/sync/dream/onboard。用户要求记忆、长期上下文、brain-first 查询、知识库维护、gbrain 工作流时使用；不要替代实时网页搜索或其它专用业务 skill（如 dws）。
---

# gbrain Skill（OpenClaw）

gbrain 是本 OpenClaw 镜像内置的长期记忆/第二大脑后端。使用本 skill 后，agent 必须把可沉淀的长期信息交给 gbrain 管理：回答前先查脑，产生新事实/偏好/决策/经验时写入或同步到 brain，维护任务交给 `gbrain onboard` / `dream` / `embed` 等命令。

上游说明以当前安装的 CLI 为准；需要查证时读 `gbrain --help` / `gbrain <command> --help`，不要臆造参数。

## 固定目录与环境

OpenClaw 镜像中 gbrain 按以下约定安装和运行：

```bash
export OPENCLAW_STATE_DIR="${OPENCLAW_STATE_DIR:-${HOME}/.openclaw}"
export GBRAIN_BIN_DIR="${OPENCLAW_STATE_DIR}/gbrain/bin"
export BUN_INSTALL_GLOBAL_DIR="${OPENCLAW_STATE_DIR}/gbrain/install/global"
export BUN_INSTALL_BIN="${GBRAIN_BIN_DIR}"
export GBRAIN_HOME="${OPENCLAW_STATE_DIR}/gbrain/data"
export PATH="${GBRAIN_BIN_DIR}:${PATH}"
```

- 全局可执行文件：`${OPENCLAW_STATE_DIR}/gbrain/bin/gbrain`
- 数据/配置目录：`${OPENCLAW_STATE_DIR}/gbrain/data`（通过 `GBRAIN_HOME` 控制）
- 兜底全局入口：`/usr/local/bin/gbrain`，会在运行时按当前 `OPENCLAW_STATE_DIR` 补齐安装。

所有 `init`、配置、PGLite 数据、索引与后续维护状态都必须写入 `GBRAIN_HOME`，禁止落到默认 `~/.gbrain`。

## 每次使用前的准备流程

在执行任何 gbrain 业务命令前，先在同一 shell 会话执行：

```bash
export OPENCLAW_STATE_DIR="${OPENCLAW_STATE_DIR:-${HOME}/.openclaw}"
export GBRAIN_BIN_DIR="${OPENCLAW_STATE_DIR}/gbrain/bin"
export BUN_INSTALL_GLOBAL_DIR="${OPENCLAW_STATE_DIR}/gbrain/install/global"
export BUN_INSTALL_BIN="${GBRAIN_BIN_DIR}"
export GBRAIN_HOME="${OPENCLAW_STATE_DIR}/gbrain/data"
export PATH="${GBRAIN_BIN_DIR}:${PATH}"
mkdir -p "${GBRAIN_BIN_DIR}" "${BUN_INSTALL_GLOBAL_DIR}" "${GBRAIN_HOME}"
command -v gbrain >/dev/null 2>&1 || bun install -g github:garrytan/gbrain
gbrain --version
```

如果 `gbrain --version` 失败，先运行 `/usr/local/bin/gbrain --version` 触发兜底安装；仍失败时报告完整错误。

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

`load_embedding.py` 默认读取 Redis HASH `byai:aimodel:typelist` 的 `EMBEDDING` / `LLM` 字段，并映射为 gbrain 识别的变量。Redis 连接使用 `REDIS_URL`，或 `REDIS_HOST` / `REDIS_PORT` / `REDIS_USERNAME` / `REDIS_PASSWORD` / `REDIS_DATABASE` / `REDIS_SSL`。加载失败时说明原因并请用户配置密钥，禁止伪造密钥。

## init 指导流程

首次接管记忆或发现尚未初始化时，必须执行这个流程。

### 1. 检查是否已经 init

先确认 `GBRAIN_HOME` 下是否已有配置/数据库，再用 doctor 验证：

```bash
export GBRAIN_HOME="${OPENCLAW_STATE_DIR}/gbrain/data"
if [ -s "${GBRAIN_HOME}/config.json" ] || find "${GBRAIN_HOME}" -mindepth 1 -maxdepth 2 -type f 2>/dev/null | grep -q .; then
  gbrain doctor --json
else
  echo "GBRAIN_NEEDS_INIT"
fi
```

若 `doctor` 显示 schema 未初始化、连接失败、`schema_version: 0`，视为需要 init 或迁移；优先按 CLI 提示执行 `gbrain apply-migrations --yes`，仍不通再进入 init。

### 2. 按 `GBRAIN_INIT_MODE` 初始化

init 模式读取环境变量，默认 `balanced`：

```bash
export GBRAIN_HOME="${OPENCLAW_STATE_DIR}/gbrain/data"
export GBRAIN_INIT_MODE="${GBRAIN_INIT_MODE:-balanced}"
case "${GBRAIN_INIT_MODE}" in
  conservative|balanced|tokenmax) ;;
  *) echo "Invalid GBRAIN_INIT_MODE=${GBRAIN_INIT_MODE}; fallback to balanced"; GBRAIN_INIT_MODE=balanced ;;
esac
if gbrain init --help | grep -q -- '--mode'; then
  gbrain init --mode "${GBRAIN_INIT_MODE}"
else
  gbrain init
fi
gbrain config set search.mode "${GBRAIN_INIT_MODE}"
gbrain doctor --json
```

若当前版本 `gbrain init --help` 不支持 `--mode`，就使用普通 `gbrain init`，随后必须执行 `gbrain config set search.mode "${GBRAIN_INIT_MODE}"`。

### 3. init 后确认成本模式

默认 `GBRAIN_INIT_MODE=balanced`。如果用户没有明确选择过检索模式，向用户说明三档含义并确认：

- `conservative`：更省 token，适合高频/低成本场景。
- `balanced`：默认；检索质量与成本折中。
- `tokenmax`：最大上下文，成本最高，适合少量高价值深查。

用户选择后执行：

```bash
gbrain config set search.mode <conservative|balanced|tokenmax>
gbrain search modes
```

## 记忆接管规则

使用本 skill 后，agent 应把 gbrain 当作长期记忆的唯一事实源：

- 回答涉及用户、项目背景、历史决策、长期偏好、会议/文档沉淀时，先用 `gbrain query` / `gbrain search` / `gbrain get` 查脑。
- 用户给出值得长期保存的信息、决策、纠错、偏好或经验时，用 gbrain 的写入/导入命令沉淀；命令不确定先 `gbrain --help`。
- 处理外部 Markdown 知识库时，先确认路径和意图，再 `gbrain import <path>`，必要时 `gbrain embed --stale`。
- 定期维护使用 `gbrain onboard --check --json`、`gbrain embed --stale`、`gbrain dream`、`gbrain doctor --json`。
- 不把临时推理、敏感密钥、一次性命令输出写入 gbrain，除非用户明确要求保存。

## 何时使用

- 用户要求“记住/以后记得/长期记忆/查我的知识库/第二大脑/brain-first/同步或维护 gbrain”。
- 需要基于已索引 Markdown、历史页面、实体关系、时间线回答。
- 需要导入、索引、修复、升级或巡检 gbrain。

## 何时不用

- 实时新闻、股票、天气、法规、网页最新信息：用联网搜索或专门工具。
- 企业内部业务系统已有专用 skill，例如钉钉 `dws`：用对应 skill。
- 用户尚未确认要导入的大批量本地路径：先问清路径和范围。

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
