# Codex 上下文交接

保持 [现有执行路由](CODING-ROUTING.zh.md)。本地实现已完成，云端挂载、真实模型和前后端联调待部署验证；Claude 尚未实现。

```text
Worker → 原执行路由 → 申请 coding 租约
                       ↓
Harness 已有授权模板 / 入站上下文
                       ↓ 确定性转换，不调用 DSH 模型
coding-workspace.py〔在实际 coding 租约中执行〕
  ├─ 镜像默认配置 → 专用 config.toml
  ├─ 员工规范、原 Skill 创建规范 → AGENTS.md + developer_instructions
  ├─ 工具侧查询、下载 agent 关联 Skill + 镜像内置 Skill
  │      → home/skills 软链接 + config 启停
  ├─ 本轮问题、背景、文件引用 → CLI stdin
  └─ 原 cwd + threadId → Codex exec / exec resume
                       ↓
  ├─ 过程、最终答案 → 原对话通道
  ├─ 文件快照 → 原 file_changes / 3016
  └─ 可选群成果请求 → 原 pending-publication → 等待用户确认
```

## 数据与目录

| 内容 | 实际处理 |
|---|---|
| 问题、身份 | 使用原 command 和路由选定员工，不把整个 extraPayload 序列化 |
| 员工规范 | 复用授权模板 persona；每轮刷新，续聊也传入最新规范 |
| 群与任务背景 | 复用入站群快照、任务上下文、groupHistoryPath；长背景由 Codex 按原文件读取 |
| 最近聊天 | 携带请求中的最近 20 条 user/assistant 历史；超限提示；后续原生续聊保留 Codex 自己的历史 |
| 附件、共享文件、云盘 | 传原路径与资源引用，本地直接读，远程由已有 Skill 按需读；不预下载全部资产 |
| Skill | 内置项随 coding 镜像提供；每轮按 employeeId 查询关联资源与版本，工具侧下载完整目录、复用同版本缓存，不复制 Harness 本地缓存、不生成手工索引 |
| 配置与认证 | 复用统一模型解析、本轮模型/思考档位及可信 api_key；连接经执行环境传递，旧 CODEX_* 参数不再覆盖，不将密钥写入提示词、argv 或持久配置 |

```text
/by/.shared/project_{id}/                有项目时的 cwd 与正式产物目录
/by/.sessions/{sessionId}/               无项目时的 cwd；原会话文件
  executors/{agentId}/codex-home/        专用 CODEX_HOME
    config.toml / AGENTS.md
    byclaw-session.json                 身份摘要、threadId、cwd、home
    sessions/...                        Codex 原生历史
/by/.file_changes/{sessionId}/files/     原 v2 文件详情快照
/by/.byclaw/skills/{resourceId}/{code}/  当前用户的关联 Skill 版本缓存
/opt/byclaw/builtin/skills/             镜像内置 Skill
```

同一用户、会话、员工串行执行，并以实例内 OS 文件锁保护配置和原生历史；不同会话/员工使用独立 home。后续请求省略项目字段时沿用已记录项目目录。原生记录缺失或 cwd 改变时明确报告重建。此机制不防止不同员工同时修改同一项目源码。

## 回写

- 在原 cwd 与 sessionRoot 做有界前后扫描，包含 Shell 创建的多层文件；排除 executors、.git、node_modules 等目录。单个文本最多 256 KiB，总文本 16 MiB，最多 10000 个文件；超限显示扫描不完整，不凭缺项推断删除。
- 文件详情写入原 v2 快照目录，再通过 3016 发送摘要；二进制保留路径、大小和存在状态。未在这两个目录中的文件不纳入扫描。
- 安装 `group-task-publication` 且符合原任务绑定条件时，CLI 使用结构化最终输出 `{answer, publication}`。宿主从 publication 取得 `text + sourcePaths`，通过原客户端准备待确认卡片；路径在同一 coding 租约校验，认证在宿主临时读取。
- 未安装可选插件时保持普通最终答复。准备请求失败不自动重试；不会自动上传、发群或完成任务。

## 代码入口

| 文件 | 职责 |
|---|---|
| `src/index.ts` | 组合已有能力、可选扩展、原 3016 发送 |
| `src/coding-context.ts` | 白名单上下文、原目录映射、租约文件查询、执行清单 |
| `src/coding-router.ts` | 原队列内准备、执行、接收文件摘要、调用成果回调 |
| `scripts/coding-workspace.py` | 调用工具侧准备程序、专用配置、Skill 链接、原生续聊、文件快照 |
| `scripts/prepare-agent-skills.mjs`、`src/skill-sync.ts` | 原 HTTP 接口查询 agent 关联资源，复用版本检查、下载与原子缓存 |
| `src/template-runtime.ts` | 无 DSH Agent 的授权模板准备入口；原 SkillRuntime 继续服务 DSH |
| `src/session-extensions.ts` | 通用 `byclaw/coding-setup` 可选扩展事件 |
| `../group-task-publication/src/index.ts` | 复用原任务绑定和客户端 |

Python 脚本随插件包分发，从模块资源路径读取，在工具沙箱执行；无需额外手工上传脚本。

## 部署前提与验证

重新构建 Harness 主镜像与 coding 工具镜像，并更新目标实例。工具镜像设置 `BYCLAW_SKILLS_DIR` 和 `BYCLAW_AGENT_SKILLS_PREPARER`，安装固定版本 YAML 解析器、共享 Python CLI 和 by-framework。用户身份、认证及后端地址沿用原执行环境，无需新增每个 agent 的环境变量。

关联 Skill 在当前工具租约下载，不再依赖 Harness 本地缓存与 coding 挂载同路径。准备失败则停止，不启动 CLI。有效集合为内置项加当前关联项；撤销关联后下一轮移除引用，其他员工未关联的缓存不会进入原生加载目录。缓存准备使用用户级文件锁，配置与续聊仍使用原执行身份锁。云盘等业务命令的服务连接、运行环境和授权仍需单独验证，不能把 Skill 文件可读当成业务请求已通过。

在完整 DSH workspace 中运行：

```sh
pnpm --filter @byclaw/dsh-integration run typecheck
pnpm --filter @byclaw/dsh-integration run build
pnpm --filter @byclaw/dsh-integration run verify:coding-router
pnpm --filter @byclaw/dsh-integration run verify:coding-context
pnpm --filter @byclaw/dsh-integration run verify:agent-skills
pnpm --filter @byclaw/dsh-group-task-publication run verify
```

2026-11-11 本次本地验证：新准备程序 9 项 HTTP/ZIP 测试、路由/上下文 38 项、镜像声明 10 项通过；runner 10 项通过、1 项因 Windows 软链接权限跳过，原 DSH 懒加载源码回归通过。路由测试通过临时加载器直接使用仓库的真实 AgentTeams group-context 源码，不代表完整插件构建。新增 npm/Python 依赖已从国内源实际安装，Python CLI 入口及知识库 CLI 的 `--help` 通过；Windows 的 groksearchcli.exe 启动器受应用控制策略限制，Python 入口验证不代表该启动器通过。

本机缺少完整 DSH workspace，类型检查及完整构建未通过；共享资源检查 6/7 通过，原兼容链接因 Windows 检出为文本而失败，两个原镜像布局检查受 Windows 路径格式阻塞。没有 Docker/可用 Linux 环境，尚未构建新镜像或验证云端 API、Linux 软链接、实际 Skill 业务请求。

补充真实锁定版本检查（只使用隔离临时目录与测试数据）：

```sh
python3 scripts/coding-native-skills-verify.py /path/to/codex
python3 scripts/coding-native-exec-verify.py /path/to/codex
```

2026-11-10 本地：路由/转换 38 项、Python 6 项、两个新增授权/Skill 测试、类型检查、构建、事件回放、延迟 Skill 与可选插件会话检查通过。真实 Windows Codex 0.167.0 的 Skill 扫描、启停、覆盖、撤销及 exec/resume 通过；续聊测试使用本地 Responses 替身，不代表真实网关可用。Windows 使用 NTFS junction 验证共享目录入口；生产 Linux 软链接待验证。

完整 SkillRuntime 测试 30/34 通过；原 HEAD 在同一测试环境为 28/32，通过基线复现同样 4 个失败（未应用业务镜像的中文名称补丁及 Windows 路径差异）。原 session-cwd 检查也有 Windows 路径失败；发布客户端完整检查受到本机文件软链接权限限制。未把这些检查或 Linux、云盘、界面下载、卡片确认联调记作通过。Codex 原生读取 SKILL.md 的名称，不承诺 DSH 对历史名称所做的别名转换完全一致。

## 模型连接边界

普通员工继续使用原 DSH 适配器；Codex 通过同一个模型运行时取得与本轮选择绑定的连接快照，不另查 Redis 或复制默认/回退规则。可信本轮 `api_key` 优先于模型 Token，与普通员工一致。只有 Codex 执行适配负责将连接转换为 CLI 参数。

当前原生边界支持 OpenAI Responses；其他协议、自定义请求头、无法转换的思考档位或不完整连接在启动 Codex 前拒绝。错误复用 `emitByClawTurnFailure`，正文显示固定安全说明和 `CODEX_MODEL_*` 错误码，执行日志记录同一原因；不输出地址、密钥或请求头。普通员工的协议能力和错误文案不变。Codex 的传输重试和采样仍由原生 CLI 管理，本次不移植普通员工逐步 Auto 路由。

运行 `pnpm verify:coding-model` 检查统一选择、连接快照、凭据优先级与轮换、并发隔离、不兼容配置及原错误展示；原生 CLI 的本地 Responses 验证见 `scripts/coding-native-exec-verify.py`。实际云端模型及界面需发布后另行验收。
