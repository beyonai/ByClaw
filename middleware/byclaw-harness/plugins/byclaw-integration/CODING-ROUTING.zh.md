# 配置驱动员工执行路由

## 链路

```text
用户提问 → ByClaw Worker → 解析 agent_id
                         │
              BYCLAW_AGENT_EXECUTION_MAP
                         │
       ┌─────────────────┼─────────────────┐
       │未命中           │CODEX_CLI         │其它已注册类型
       ↓                 ↓                  ↓
      DSH       templateKey=coding       明确返回未实现
                         ↓
              byclaw-tools-coding
                         ↓
                    Codex CLI
                         ↓
           JSONL 事件/最终答案回原界面
```

路由由 Harness 主沙箱执行。命中后直接申请工具沙箱并运行 CLI，不再让 DSH 模型决定是否调用工具；执行失败也不会回退为 DSH 答案。

上下文、共享 Skill、专用 CODEX_HOME、原生续聊及文件回写见 [上下文交接](CODING-CONTEXT.zh.md)。

## 配置

在 Harness 主沙箱配置：

```json
{
  "BYCLAW_AGENT_EXECUTION_MAP": "{\"11444401\":\"CODEX_CLI\"}"
}
```

映射值目前注册为 `CODEX_CLI`、`CLAUDE_CLI`、`UNITY`；当前只有 `CODEX_CLI` 已实现。Codex 工具沙箱继续使用 `serviceKey=byclaw-tools-coding` 和已有 `CODEX_AUTH` 配置，工具镜像无需重做。

## 代码修改点

| 文件 | 修改内容 |
|---|---|
| `src/coding-router.ts` | 解析员工执行映射，选择执行器，申请工具沙箱，运行 Codex，转发 JSONL 事件 |
| `src/cli-event-adapter.ts` | 区分公开摘要、过程说明、命令、文件修改、计划和最终答案，处理更新与去重 |
| `src/coding-presentation.ts` | 绑定员工、会话与父消息；工具卡 ID 稳定，每次更新的事件序号独立 |
| `src/coding-diagnostics.ts` | 展示文本脱敏、限长；认证、网络等错误只记录分类 |
| `src/byclaw-presentation.ts` | 复用平台 `1001` / `3015` 投影，标明 `event_source=codex` |
| `src/index.ts` | 读取 `BYCLAW_AGENT_EXECUTION_MAP`，创建通用执行路由并接入沙箱目录 |
| `src/worker.ts` | Ask 分流、结果返回、取消执行 |
| `src/worker-runtime.ts` | 传递通用执行路由并在关闭时清理 |
| `cordis.patch.yml` | 注入 `agentExecutionMap` 配置 |
| `scripts/coding-router-verify.mjs` | 路由、沙箱、取消、超时和 JSONL 测试 |
| `scripts/emitter-metadata-verify.mjs` | 使用真实 SDK 回放投影，检查卡片更新和元数据；Redis、CLI 使用测试替身 |

## 执行过程与结果

```text
Codex CLI --json → 增量 JSONL 解析 → 原 ByClaw 事件通道
                  ├─ 公开摘要、步骤说明 → 1001 思考区
                  ├─ 命令、文件、工具、计划 → 3015 同一张卡更新
                  └─ 完整最终答案 → Worker 统一返回一次
Harness 运行阶段 → 申请沙箱 / 执行任务 / 归还租约，每 10 秒更新耗时
```

只展示 CLI 实际返回的公开文本。没有公开摘要时只显示实际操作和阶段耗时，不生成思考内容。文件卡显示路径和修改类型，命令卡显示命令和退出码；不转发完整 diff、命令输出或 MCP 原始参数/结果。

有 `phase` 的消息区分 `commentary` / `final_answer`；旧 CLI 无 `phase` 时保留最后一条候选消息，后续活动出现后才把前一条转为过程说明。只有进程成功退出且收到 `turn.completed`、工具已结束、租约清理完成，才返回最终答案。失败、停止、超时会结束仍在运行的卡片；回传或清理失败不报成功。

## 耗时排查

在实际处理用户请求的 Harness Worker 日志中搜索 `execution.lifecycle`，按 `sessionId`、`messageId` 或 `traceId` 关联。

| stage | 含义 |
|---|---|
| `queue` | 同员工同会话的排队耗时 |
| `sandbox` | 申请工具沙箱，包括启动、连接与握手 |
| `first_stdout` | 从调用执行通道到收到首段 stdout；可能只是线程启动事件 |
| `first_activity` | 从调用执行通道到收到首个 item 事件；不等于纯模型推理耗时 |
| `exec` | 从执行通道调用到 CLI 退出并排空解析 |
| `cleanup` | 归还租约耗时 |
| `request` | 含排队和清理的总耗时及最终状态 |
| `stderr` | 错误分类、可识别的 HTTP 状态码和重试消息条数 |

`elapsedMs` 是该阶段耗时，`totalElapsedMs` 是从入队起的累计耗时。日志不记录提示词、完整命令、stdout、stderr 或认证值；只能辅助定位阶段，不能单凭一段长耗时断定模型慢。

## 验证

```powershell
node --experimental-transform-types --test scripts/coding-router-verify.mjs
# 在完整 DSH workspace 编译后回放真实 SDK 序列化
pnpm run typecheck
pnpm run build
node scripts/emitter-metadata-verify.mjs
```

部署验收：命中员工出现实际 Codex 操作卡；同一操作完成后就地更新；长任务每 10 秒更新阶段耗时；最终答案出现一次；停止、失败、超时后卡片结束；未命中员工仍由 DSH 处理。

本次只更新 Harness 主镜像，沿用工具镜像与已有配置，无需新增环境变量。本地测试不代替真实 CLI、Redis、前后端和刷新恢复的部署联调。
