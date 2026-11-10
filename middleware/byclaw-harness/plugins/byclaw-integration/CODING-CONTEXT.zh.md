# Codex 上下文交接

保持 [现有执行路由](CODING-ROUTING.zh.md)。本地实现已完成，云端挂载、真实模型和前后端联调待部署验证；Claude 尚未实现。

```text
Worker → 原执行路由 → 申请 coding 租约
                       ↓
Harness 已有授权模板 / 入站上下文 / SkillRuntime
                       ↓ 确定性转换，不调用 DSH 模型
coding-workspace.py〔在实际 coding 租约中执行〕
  ├─ 镜像默认配置 → 专用 config.toml
  ├─ 员工规范、原 Skill 创建规范 → AGENTS.md + developer_instructions
  ├─ 有效共享 Skill → home/skills 软链接 + config 启停
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
| Skill | 使用当前员工的有效集合和本地覆盖；共享目录必须已挂载到 coding 实例，不复制、不生成索引 |
| 配置与认证 | 每轮从镜像默认配置生成专用配置；保留 CODEX_AUTH 和原模型/地址参数覆盖，不将密钥写入提示词 |

```text
/by/.shared/project_{id}/                有项目时的 cwd 与正式产物目录
/by/.sessions/{sessionId}/               无项目时的 cwd；原会话文件
  executors/{agentId}/codex-home/        专用 CODEX_HOME
    config.toml / AGENTS.md
    byclaw-session.json                 身份摘要、threadId、cwd、home
    sessions/...                        Codex 原生历史
/by/.file_changes/{sessionId}/files/     原 v2 文件详情快照
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
| `scripts/coding-workspace.py` | 专用配置、Skill 链接、原生续聊、文件快照 |
| `src/template-runtime.ts`、`src/skill-runtime.ts` | 无 DSH Agent 的授权模板及有效 Skill 准备入口 |
| `src/session-extensions.ts` | 通用 `byclaw/coding-setup` 可选扩展事件 |
| `../group-task-publication/src/index.ts` | 复用原任务绑定和客户端 |

Python 脚本随插件包分发，从模块资源路径读取，在工具沙箱执行；无需额外手工上传脚本。

## 部署前提与验证

无需新增必填环境变量。重新构建 Harness 主镜像；coding 镜像已有 Python 3.11+、Codex 0.167.0、共享挂载和 Skill 所需依赖时可复用。Python 使用标准库 `tomllib`，不安装新 Python 包。

特别核对：Harness 本地缓存的关联 Skill 不一定已经出现在 coding 的 `/by/.byclaw/skills`。本实现只映射路径，缺少真实挂载会报 `EXECUTION_SKILL_MOUNT_MISSING`；不能把路径映射当作挂载成功。云盘 Skill 的命令、身份、认证环境与网络也须在 coding 实例可用。

在完整 DSH workspace 中运行：

```sh
pnpm --filter @byclaw/dsh-integration run typecheck
pnpm --filter @byclaw/dsh-integration run build
pnpm --filter @byclaw/dsh-integration run verify:coding-router
pnpm --filter @byclaw/dsh-integration run verify:coding-context
pnpm --filter @byclaw/dsh-group-task-publication run verify
```

补充真实锁定版本检查（只使用隔离临时目录与测试数据）：

```sh
python3 scripts/coding-native-skills-verify.py /path/to/codex
python3 scripts/coding-native-exec-verify.py /path/to/codex
```

2026-11-10 本地：路由/转换 38 项、Python 6 项、两个新增授权/Skill 测试、类型检查、构建、事件回放、延迟 Skill 与可选插件会话检查通过。真实 Windows Codex 0.167.0 的 Skill 扫描、启停、覆盖、撤销及 exec/resume 通过；续聊测试使用本地 Responses 替身，不代表真实网关可用。Windows 使用 NTFS junction 验证共享目录入口；生产 Linux 软链接待验证。

完整 SkillRuntime 测试 30/34 通过；原 HEAD 在同一测试环境为 28/32，通过基线复现同样 4 个失败（未应用业务镜像的中文名称补丁及 Windows 路径差异）。原 session-cwd 检查也有 Windows 路径失败；发布客户端完整检查受到本机文件软链接权限限制。未把这些检查或 Linux、云盘、界面下载、卡片确认联调记作通过。Codex 原生读取 SKILL.md 的名称，不承诺 DSH 对历史名称所做的别名转换完全一致。
