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

## 配置

在 Harness 主沙箱配置：

```json
{
  "BYCLAW_AGENT_EXECUTION_MAP": "{\"11444401\":\"CODEX_CLI\"}",
  "CODEX_EXEC_TIMEOUT_MS": "300000"
}
```

映射值目前注册为 `CODEX_CLI`、`CLAUDE_CLI`、`UNITY`；当前只有 `CODEX_CLI` 已实现。Codex 工具沙箱继续使用 `serviceKey=byclaw-tools-coding` 和已有 `CODEX_AUTH` 配置，工具镜像无需重做。

## 代码修改点

| 文件 | 修改内容 |
|---|---|
| `src/coding-router.ts` | 解析员工执行映射，选择执行器，申请工具沙箱，运行 Codex，转发 JSONL 事件 |
| `src/index.ts` | 读取 `BYCLAW_AGENT_EXECUTION_MAP`，创建通用执行路由并接入沙箱目录 |
| `src/worker.ts` | Ask 分流、结果返回、取消执行 |
| `src/worker-runtime.ts` | 传递通用执行路由并在关闭时清理 |
| `cordis.patch.yml` | 注入 `agentExecutionMap` 配置 |
| `scripts/coding-router-verify.mjs` | 路由、沙箱、取消、超时和 JSONL 测试 |

## 验证

```powershell
node --experimental-transform-types --test scripts/coding-router-verify.mjs
```

验收时确认：命中员工的执行结果元数据包含 `executor=codex`；未命中员工仍由 DSH 处理；失败、停止、超时均返回明确错误。
