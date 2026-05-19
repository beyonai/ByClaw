# Baiying Enhance（`baiying-enhance`）

## 文档

- **中文总览（架构与流程图，推荐）**：[docs/PLUGIN_OVERVIEW.zh-CN.md](docs/PLUGIN_OVERVIEW.zh-CN.md)
- **中文集成说明（历史路径）**：若仓库中未包含 `openclaw-baiying-integration.zh-CN.md`，请以 `PLUGIN_OVERVIEW.zh-CN.md` 与下列专题文档为准。
- **中文旧手册**：若仓库根目录存在 `USER_GUIDE.zh-CN.md`（历史版本，含较多 `baiying_dispatch` 旧叙述），可作参考；本扩展目录内未必附带该文件。
- **English（文档站）**：[Baiying Enhance](https://docs.openclaw.ai/plugins/baiying-enhance)

## 概述

本插件随 OpenClaw 提供，用于：

1. 从 Redis 按授权读取百应数字员工 JSON：`USER:RESOURCES:AUTH:{userId}` 决定当前可见数字员工，插件只读取对应 `DIG_EMPLOYEE_{resourceId}`；授权不存在或为空时不注册任何数字员工。
2. 将条目合并进**当前网关配置文件**中的托管 Agent（`baiying-agent-*`）与 OpenAI 兼容的 `models.providers`（`baiying-m-*`），并保留已有 **`agents.list[].workspace`**；新建托管 Agent 才使用状态目录下的默认路径（托管体为 `<stateDir>/workspace-<agentId>/`；与 OpenClaw 默认一致时，`main` 对应 `<stateDir>/workspace/` 而非 `workspace-main`，见 `src/workspace-paths.ts`）。
3. 可选地在每次同步后初始化工作区（`workspaceAutoSeed`，默认开启）：由 `seedManagedAgentWorkspace`（`src/workspace-seed.ts`）创建目录并按 JSON 写入或更新带托管标记的 `SOUL.md` / `AGENTS.md` / `IDENTITY.md` / `USER.md` / `TOOLS.md`（以及可选的 `BYAI_BUSINESS_EXTENSIONS.md`）。
4. 授权移除时默认把对应托管 workspace 从 `<stateDir>/workspace-baiying-agent-*` 移到状态目录上级的隐藏归档目录（默认 `<dirname(stateDir)>/.baiying-workspaces/`，例如 `/by/.baiying-workspaces/`），避免未授权数字员工数据继续留在 `.openclaw` 下；重新授权时会先恢复目录，再用最新 JSON 更新插件托管的 Markdown。
5. 为每个托管 Agent 动态挂载工具 **`baiying_call`**，把百应关联的知识库、toolkit、MCP、下游 agent 等资源暴露给大模型。

> **说明**：当前代码主链路已经切到 **`baiying_call + 插件内置 TypeScript 执行器（`src/executor/`）**`，历史上的 `~/.openclaw/skills/baiying/executor.py` 仍可保留作参考，但已不再被调用。`USER_GUIDE.zh-CN.md` 中仍保留一些 `baiying_dispatch` 的历史说明，可作为旧方案参考，但不再代表当前推荐实现。

> **配置格式**：OpenClaw 网关从 **`~/.openclaw/openclaw.json`** 读取配置（内容为 **JSON**，亦支持 **JSON5**：注释与尾随逗号）。接入本插件时，请在同一文件中配置 `plugins.entries`，见下文示例。插件同步托管 Agent 时也会通过 `writeConfigFile` 写回**当前生效的配置文件路径**（通常为上述 `openclaw.json`）。

## 依赖与安装

- **正常使用（`npm install -g openclaw` / `pnpm add -g openclaw` 等官方包）**  
  本插件与核心一起发布在 `openclaw` 包内的 `extensions/baiying-enhance/`。其依赖（如 `ioredis`、`@sinclair/typebox`）已由**主包** `dependencies` 安装，模块解析会从安装根向上找到 `node_modules`，**一般不需要**在插件子目录再执行一次 `npm install`。

- **在本仓库里从源码跑网关 / 单独拷贝了插件目录做开发时**  
  需要在 **`extensions/baiying-enhance/`** 下安装该目录自己的依赖，与仓库惯例一致：  
  `pnpm install` 或 `npm install`（仅生产依赖时：`npm install --omit=dev`）。  
  全仓库开发时通常在仓库根执行一次 `pnpm install`，workspace 会包含各 `extensions/*` 包。

启用插件本身用：`openclaw plugins enable baiying-enhance`（或在下文 `openclaw.json` 里写 `enabled: true`），然后**重启 Gateway**（若当前流程要求重启）。

## 配置（JSON）

在 **`~/.openclaw/openclaw.json`** 中增加或合并如下结构（注意插件 id 含连字符，键名需写成 `"baiying-enhance"`）：

```json
{
  "plugins": {
    "entries": {
      "baiying-enhance": {
        "enabled": true,
        "config": {
          "watchDebounceMs": 500,
          "mainParentAgentId": "main",
          "mergeAllowSpawnForMain": true,
          "embedApiKeysFromJson": false,
          "workspaceAutoSeed": true,
          "workspaceArchiveOnUnauthorized": true,
          "workspaceArchiveBackend": "remote",
          "workspaceArchiveDir": ".baiying-workspaces"
        }
      }
    }
  }
}
```

字段含义与默认值以插件清单中的 `configSchema`（`openclaw.plugin.json`）为准。历史上的 `agentConfigDir` / `executorResourcesDir` 仍被配置校验接受，但当前运行时不再用它们读取数字员工或关联资源 JSON；权威来源是 Redis。**`config` 允许额外键**（例如历史遗留的 `watchAgentDir`、`skillDirs`、`pollIntervalMs`），不会因「未知字段」导致插件校验失败；已声明的字段仍会按类型校验，建议仍以文档列出的键为主以免笔误。

### 取消授权 Workspace 归档

`workspaceArchiveOnUnauthorized` 默认开启。默认 `workspaceArchiveBackend: "remote"`，插件会通过后端内部 API 把 workspace 上传到 MinIO，成功后才删除 `.openclaw` 下的 active workspace；上传失败时保留本地目录并输出 warn 日志，避免丢数据。后端地址来自 Redis 服务发现：

- `BE_DOMAINNAME` 默认 `ByaiService`
- Redis key：`byai_gateway:sd:instances:${BE_DOMAINNAME}`（`path_prefix` 为空时默认 `/byaiService`）

远端对象位置固定为：

- 取消授权：`bucket=byclaw-<USER_CODE>`，`objectKey=/openclaw-workspace-archives/workspace-baiying-agent-<resourceId>/cancel_auth_latest.tar.gz`
- 删除广播：`bucket=byclaw-<USER_CODE>`，`objectKey=/openclaw-workspace-archives/workspace-baiying-agent-<resourceId>/del_latest.tar.gz`

重新授权时，如果 active workspace 不存在，会尝试下载 `cancel_auth` 归档恢复；`delete` 归档只用于审计留存，不参与恢复。

如需保留旧本地兼容模式，可显式配置 `workspaceArchiveBackend: "local"`。本地模式下，每次授权视图导致托管数字员工从 `agents.list` 移除后，插件会把该 agent 的 workspace 移出 `.openclaw`：

- 默认 active 路径：`<OPENCLAW_STATE_DIR>/workspace-baiying-agent-<resourceId>`
- 默认 archive 路径：`<dirname(OPENCLAW_STATE_DIR)>/.baiying-workspaces/workspace-baiying-agent-<resourceId>`

若 archive 目标已存在，会先旋转成带时间戳的同级目录，再归档当前 active workspace，确保 `.openclaw` 下不残留已取消授权的数字员工数据。重新授权时，如果 active workspace 不存在且 archive 存在，会先恢复；如果 active 已存在，则保留 active，不覆盖用户当前目录。随后正常种子化流程会用最新 Redis JSON 更新带 `baiying-enhance` 托管标记的 Markdown 文件。

Redis Pub/Sub 默认启用；如需关闭，可设置 `digEmployeeChangeSubscribe: false` 或环境变量 `BAIYING_DIG_EMPLOYEE_CHANGE_SUBSCRIBE=false`。插件会读取现有环境变量，也会尝试从 `BAIYING_ENV_FILE`、当前工作目录向上的 `.env`、以及 OpenClaw 状态目录 `.env` 加载 Redis 默认值（不覆盖已存在环境变量），与 `scripts/listen_dig_employee_redis_pubsub.py` 的本地调试体验保持一致。

### 同步写盘后避免整网关重启（可选）

数字员工同步会 `writeConfigFile`；本插件默认把 `plugins.entries.baiying-enhance` 与 `agents` 注册为热重载前缀，因此托管 Agent 条目、`agents.list[].skills`、`main.subagents.allowAgents` 等变化会走热加载，不需要整网关重启。若 diff 里出现其它插件的 `plugins.entries.*`，OpenClaw 仍可能判定需要**进程级重启**；这种情况下请在 **`plugins.entries.baiying-enhance.config`** 里增加 **`configSyncHotPluginEntriesPrefixes`**（仅当你需要时配置，可省略）：

```json
"config": {
  "configSyncHotPluginEntriesPrefixes": [
    "byai-channel",
    "minimax",
    "memory-core"
  ]
}
```

每项可为插件 id（如上）或完整路径 `plugins.entries.byai-channel`。`byai-channel` 扩展自身也可带 `reload.hotPrefixes`，二者可并存。

也可用 CLI 写入等价配置，例如：

`openclaw config set plugins.entries.baiying-enhance.enabled true`

### API Key

默认情况下，提供方的 `apiKey` 会写成**环境变量引用**：`OPENCLAW_BAIYING_<sourceKey>`，其中 `sourceKey` 为百应数字 id 或 slug。

可通过插件配置项 **`envApiKeyTemplate`** 自定义环境变量名（使用 `{sourceKey}` 占位符）。

### 运行态说明

当前实现中，托管 agent 会自动带上 `baiying_call`。该工具会：

- 使用注册时从 `DIG_EMPLOYEE_{resourceId}` 读取的 `relResourceList / relResourceInfoList`
- 按需从 Redis 读取关联资源 `{BIZTYPE}_{resourceId}`，不扫描本地资源目录
- 在提示词中展开知识库、toolkit、MCP、AGENT 等能力
- 由插件内置的 **TypeScript 执行器**（`src/executor/`，按资源类型拆分为 `toolkit.ts` / `tool.ts` / `agent.ts` / `mcp.ts` / `doc.ts` 等）在进程内统一执行并做参数校验/回填；历史上的 `~/.openclaw/skills/baiying/executor.py` 已废弃不再调用

如需完整运行态说明、架构与流程图，请优先阅读：

- [docs/PLUGIN_OVERVIEW.zh-CN.md](docs/PLUGIN_OVERVIEW.zh-CN.md)
- [docs/AGENT_JSON_WORKSPACE_MD_MAPPING.md](docs/AGENT_JSON_WORKSPACE_MD_MAPPING.md)（JSON → 工作区 Markdown 映射）

## Redis Agent JSON 格式

- **数字员工键**：`DIG_EMPLOYEE_{resourceId}`，值为后端同步的完整数字员工配置 JSON。
- **关联资源键**：`{BIZTYPE}_{resourceId}`，例如 `TOOLKIT_10000050`、`MCP_10001`、`KG_DOC_10002`。
- **兼容格式**：适配器仍支持百应详情、旧 `agent_list` 导出、原生简化 JSON；生产注册路径只按授权 id 从 Redis 读取。

### `relSkills` 与网关里的 `agents.list[].skills`

插件把托管 agent 合并进当前生效配置（通常为 **`openclaw.json`**）时，每个 **`baiying-agent-*`** 列表项都会写出 **`skills`** 字段：

- 默认 **`[]`**（不再省略该字段）。
- 若 JSON **根**上存在非空的 **`relSkills`**（字符串数组，例如 `["dws","clawhub"]`），则写入 **`agents.list[].skills`**（元素会 `trim`，空串丢弃）。
- 若无有效 `relSkills`，则回退读取根级 **`skills`**（兼容旧版原生 JSON）；仍无则为 **`[]`**。
- 若 `workspaceSkillAutoEnable` 未关闭，插件还会自动扫描用户上传的 `skills/<目录>/SKILL.md`，并优先使用 `SKILL.md` frontmatter 里的 `name` 作为 OpenClaw skill filter 名称：默认只把当前 agent workspace 下的 skill 并入该 agent，不读取其它 agent workspace；main workspace (`workspace/skills`) 仅在 `workspaceSkillIncludeMainShared: true` 时作为共享 skill 并入托管子 agent。扫描有 `fs.watch` 与 `workspaceSkillScanIntervalMs` 兜底（默认 `500` ms）；兜底扫描只做 skill diff，不重新读取数字员工 Redis，也不会触发托管 Agent 增删。
- 对 rclone/FUSE 等网盘挂载，`fs.watch` 与目录类型上报可能不可靠；插件会依赖周期扫描，并在 `Dirent` 类型未知时用 `stat()` 兜底识别 skill 目录。

更细的说明见 [docs/AGENT_JSON_WORKSPACE_MD_MAPPING.md](docs/AGENT_JSON_WORKSPACE_MD_MAPPING.md) 与 [docs/PLUGIN_OVERVIEW.zh-CN.md](docs/PLUGIN_OVERVIEW.zh-CN.md)。

### `relTools` 与网关里的 `agents.list[].tools.allow`

对百应详情 / 数字员工格式，插件会读取 JSON **根**上的 **`relTools`**（字符串数组）并写入托管 agent 的 **`agents.list[].tools.allow`**；元素会 `trim`，空串丢弃。配置 `["*"]` 表示允许全部 OpenClaw tools。

该格式的托管 agent 仍会保留 **`baiying_call`**，用于调用百应关联资源桥接工具：当 `relTools` 非空时合并进 `tools.allow`，否则写为 `tools.alsoAllow`。数字员工 JSON 内容变化后，Redis Pub/Sub 或显式 flush 触发重新扫描时，`relTools` 变更会随配置同步写回；插件同时写入一个禁用的内部 `skills.entries.__baiying_enhance_reload` 标记，让 OpenClaw 刷新 skills/tools 快照，无需重启网关。

## HTTP

- `GET /plugins/baiying-enhance/health`（需网关认证）
- `GET /plugins/baiying-enhance/agents`（需网关认证）
- `GET /plugins/baiying-enhance/doc-async/tasks`（需网关认证）
- `POST /plugins/baiying-enhance/doc-async/complete`（需网关认证）
